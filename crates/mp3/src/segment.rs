use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anlg_audio_utils::Source;

use crate::encoder::f32_to_i16;
use crate::{Error, MonoStreamEncoder};

const ENCODE_FRAMES: usize = 4096;

/// Decodes any supported audio file, downmixes it to mono, and writes it back out
/// as MP3 segments of at most `segment_duration`. Providers that cap upload size
/// or time out on long audio get one request per segment.
pub fn encode_mono_segments(
    source_path: &Path,
    output_dir: &Path,
    segment_duration: Duration,
) -> Result<Vec<PathBuf>, Error> {
    let source = anlg_audio_utils::source_from_path(source_path)?;
    let mut paths: Vec<PathBuf> = Vec::new();

    let writers = drive(source, segment_duration, |index| {
        let path = output_dir.join(format!("segment-{:04}.mp3", index));
        paths.push(path.clone());
        Ok(BufWriter::new(File::create(path)?))
    })?;

    for writer in &writers {
        writer.get_ref().sync_all()?;
    }

    Ok(paths)
}

/// Same segmentation, but every segment stays in memory. Used where audio must
/// not touch the disk: dictation, and imports streamed from their source.
pub fn encode_mono_segments_in_memory(
    source: impl Source<Item = f32>,
    segment_duration: Duration,
) -> Result<Vec<Vec<u8>>, Error> {
    drive(source, segment_duration, |_index| Ok(Vec::new()))
}

fn drive<W, F>(
    source: impl Source<Item = f32>,
    segment_duration: Duration,
    mut open: F,
) -> Result<Vec<W>, Error>
where
    W: Write,
    F: FnMut(usize) -> Result<W, Error>,
{
    let sample_rate: u32 = source.sample_rate().into();
    let channels = usize::from(u16::from(source.channels())).max(1);
    let frames_per_segment = frames_per_segment(sample_rate, segment_duration)?;

    let mut outputs: Vec<W> = Vec::new();
    let mut current: Option<SegmentEncoder<W>> = None;

    for sample in anlg_audio_utils::mono_frames(source, channels) {
        if current
            .as_ref()
            .is_some_and(|segment| segment.frames >= frames_per_segment)
        {
            let finished = current.take().expect("segment was just observed");
            outputs.push(finished.finish()?);
        }

        if current.is_none() {
            current = Some(SegmentEncoder::create(open(outputs.len())?, sample_rate)?);
        }

        current
            .as_mut()
            .expect("segment was just created")
            .push(sample)?;
    }

    if let Some(segment) = current {
        outputs.push(segment.finish()?);
    }

    Ok(outputs)
}

fn frames_per_segment(sample_rate: u32, segment_duration: Duration) -> Result<usize, Error> {
    let frames = (u128::from(sample_rate) * segment_duration.as_millis()) / 1000;
    usize::try_from(frames)
        .ok()
        .filter(|frames| *frames > 0)
        .ok_or(Error::InvalidSegmentDuration(segment_duration))
}

struct SegmentEncoder<W: Write> {
    encoder: MonoStreamEncoder,
    writer: W,
    pcm: Vec<i16>,
    encoded: Vec<u8>,
    frames: usize,
}

impl<W: Write> SegmentEncoder<W> {
    fn create(writer: W, sample_rate: u32) -> Result<Self, Error> {
        Ok(Self {
            encoder: MonoStreamEncoder::new(sample_rate)?,
            writer,
            pcm: Vec::with_capacity(ENCODE_FRAMES),
            encoded: Vec::new(),
            frames: 0,
        })
    }

    fn push(&mut self, sample: f32) -> Result<(), Error> {
        self.pcm.push(f32_to_i16(sample));
        self.frames += 1;

        if self.pcm.len() >= ENCODE_FRAMES {
            self.drain()?;
        }
        Ok(())
    }

    fn drain(&mut self) -> Result<(), Error> {
        self.encoded.clear();
        self.encoder.encode_i16(&self.pcm, &mut self.encoded)?;
        self.writer.write_all(&self.encoded)?;
        self.pcm.clear();
        Ok(())
    }

    fn finish(mut self) -> Result<W, Error> {
        self.drain()?;
        self.encoded.clear();
        self.encoder.flush(&mut self.encoded)?;
        self.writer.write_all(&self.encoded)?;
        self.writer.flush()?;
        Ok(self.writer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_per_segment_scales_with_sample_rate() {
        assert_eq!(
            frames_per_segment(16_000, Duration::from_secs(10)).unwrap(),
            160_000
        );
        assert!(frames_per_segment(16_000, Duration::ZERO).is_err());
    }

    /// Minimal 16-bit mono PCM WAV, so the in-memory path can be exercised
    /// without writing an audio file to disk.
    fn sine_wav(seconds: u32, sample_rate: u32) -> Vec<u8> {
        let frames = sample_rate * seconds;
        let data_len = frames * 2;
        let mut wav = Vec::with_capacity(44 + data_len as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_len).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_len.to_le_bytes());
        for index in 0..frames {
            let phase = (index as f32 / sample_rate as f32) * 440.0 * std::f32::consts::TAU;
            let sample = (phase.sin() * 0.5 * i16::MAX as f32) as i16;
            wav.extend_from_slice(&sample.to_le_bytes());
        }
        wav
    }

    #[test]
    fn in_memory_segments_are_encoded_without_a_file() {
        let wav: std::sync::Arc<[u8]> = sine_wav(3, 16_000).into();
        let source = anlg_audio_utils::source_from_bytes(wav).unwrap();

        let segments = encode_mono_segments_in_memory(source, Duration::from_secs(1)).unwrap();

        assert!(segments.len() >= 3, "got {} segments", segments.len());
        for segment in &segments {
            assert!(!segment.is_empty());
        }
        // An MP3 frame starts with the 11-bit frame sync; an ID3-less stream
        // begins with 0xFF then a byte whose top 3 bits are set.
        assert_eq!(segments[0][0], 0xFF);
        assert_eq!(segments[0][1] & 0xE0, 0xE0);
    }
}
