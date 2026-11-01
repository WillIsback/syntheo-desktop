// cargo test -p aec --features localvqe
use dasp::sample::Sample;

use super::*;

const THEO_MIC: &[u8] = include_bytes!("../../data/inputs/theo_mic.wav");
const THEO_LPB: &[u8] = include_bytes!("../../data/inputs/theo_lpb.wav");
const VOICE: &[u8] = include_bytes!("../../data/inputs/syntheo_mic.wav");

fn decode(bytes: &'static [u8]) -> Vec<f32> {
    rodio::Decoder::new(std::io::BufReader::new(std::io::Cursor::new(bytes)))
        .unwrap()
        .map(|s| s.to_sample())
        .collect()
}

fn run(engine: &mut LocalVqe, mic: &[f32], reference: &[f32], chunk: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(mic.len());
    for (m, r) in mic.chunks(chunk).zip(reference.chunks(chunk)) {
        let processed = engine.process_streaming(m, r).unwrap();
        assert_eq!(processed.len(), m.len());
        out.extend(processed);
    }
    out
}

fn energy(x: &[f32]) -> f64 {
    x.iter().map(|&v| (v as f64) * (v as f64)).sum()
}

#[test]
fn frontend_weights_match_the_released_layout() {
    let config = weights::FrontendConfig::parse(weights::FRONTEND_JSON).unwrap();
    let c = &config.controller;
    let count = [&c.glob, &c.bins, &c.part]
        .iter()
        .map(|g| g.w_ih.len() + g.w_hh.len() + g.b_ih.len() + g.b_hh.len())
        .sum::<usize>()
        + c.glob_ln_w.len() * 2
        + c.bins_ln_w.len() * 2
        + c.part_ln_w.len() * 2
        + c.head_w.len()
        + c.part_head_w.len()
        + 2;
    assert_eq!(count, 2742);
    // Fenêtre racine de Hann décalée d'un demi-échantillon (rapport technique, § 2.1).
    for (n, &w) in config.analysis_window.iter().enumerate() {
        let expected = (std::f32::consts::PI * (n as f32 + 0.5) / FFT_SIZE as f32).sin();
        assert!(
            (w - expected).abs() < 1e-5,
            "fenêtre[{n}] = {w}, attendu {expected}"
        );
    }
}

#[test]
fn codec_reconstructs_a_band_limited_signal() {
    let config = weights::FrontendConfig::parse(weights::FRONTEND_JSON).unwrap();
    let mut codec = codec::Codec::new(config.analysis_window);
    let signal: Vec<f32> = (0..16 * HOP_SIZE)
        .map(|i| 0.3 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16_000.0).sin())
        .collect();
    let mut previous = vec![0.0; HOP_SIZE];
    let (mut spectrum, mut frame) = (vec![0.0; 2 * N_BINS], vec![0.0; FFT_SIZE]);
    let mut ola = vec![0.0; FFT_SIZE];
    let mut out = Vec::new();
    for hop in signal.chunks(HOP_SIZE) {
        codec.analysis(&previous, hop, &mut spectrum);
        previous.copy_from_slice(hop);
        codec.synthesis(&spectrum, &mut frame);
        for (acc, &s) in ola.iter_mut().zip(&frame) {
            *acc += s;
        }
        out.extend_from_slice(&ola[..HOP_SIZE]);
        ola.copy_within(HOP_SIZE.., 0);
        ola[FFT_SIZE - HOP_SIZE..].fill(0.0);
    }
    // Un pas de latence ; le premier pas n'est pas encore complet. Le codec jette le bin DC :
    // la fuite spectrale de la fenêtre y laisse un petit écart, d'où un seuil en SNR.
    let target = &signal[HOP_SIZE..signal.len() - HOP_SIZE];
    let rebuilt = &out[2 * HOP_SIZE..];
    let error: Vec<f32> = rebuilt.iter().zip(target).map(|(a, b)| a - b).collect();
    let snr = 10.0 * (energy(target) / energy(&error)).log10();
    assert!(snr > 40.0, "SNR de reconstruction {snr:.1} dB");
}

#[test]
fn output_does_not_depend_on_chunk_size() {
    let mic = decode(THEO_MIC);
    let reference = decode(THEO_LPB);
    let len = 3 * 16_000;
    let (mic, reference) = (&mic[..len], &reference[..len]);
    for variant in [LocalVqeVariant::Aec200K, LocalVqeVariant::Frontend2_7K] {
        let mut engine = LocalVqe::with_variant(variant).unwrap();
        let by_hop = run(&mut engine, mic, reference, HOP_SIZE);
        engine.reset();
        let by_app_chunk = run(&mut engine, mic, reference, 1920);
        engine.reset();
        let by_odd_chunk = run(&mut engine, mic, reference, 100);
        assert_eq!(by_hop, by_app_chunk, "{variant:?}");
        assert_eq!(by_hop, by_odd_chunk, "{variant:?}");
        assert!(by_hop.iter().all(|v| v.is_finite()));
    }
}

#[test]
fn silent_reference_leaves_the_voice_untouched() {
    let voice = decode(VOICE);
    let silence = vec![0.0; voice.len()];
    let mut frontend = LocalVqe::frontend_only().unwrap();
    let out = run(&mut frontend, &voice, &silence, 1920);
    let latency = frontend.latency_samples();
    assert_eq!(&out[latency..], &voice[..voice.len() - latency]);

    let mut full = LocalVqe::new().unwrap();
    let out = run(&mut full, &voice, &silence, 1920);
    let latency = full.latency_samples();
    let aligned = &out[latency..];
    let target = &voice[..aligned.len()];
    let error: Vec<f32> = aligned.iter().zip(target).map(|(a, b)| a - b).collect();
    let snr = 10.0 * (energy(target) / energy(&error)).log10();
    assert!(snr > 30.0, "SNR voix {snr:.1} dB");
}

#[test]
fn removes_echo_and_resume_keeps_the_learned_path() {
    let mic = decode(THEO_MIC);
    let reference = decode(THEO_LPB);
    let len = 10 * 16_000;
    let (mic, reference) = (&mic[..len], &reference[..len]);
    let mut engine = LocalVqe::new().unwrap();
    let out = run(&mut engine, mic, reference, 1920);
    let latency = engine.latency_samples();
    let (from, to) = (6 * 16_000, len - latency);
    let erle = 10.0 * (energy(&mic[from..to]) / energy(&out[from + latency..to + latency])).log10();
    assert!(erle > 20.0, "ERLE {erle:.1} dB");

    let delay = engine.reference_delay();
    assert!(delay.1, "retard GCC figé après 10 s");
    engine.resume();
    assert_eq!(engine.reference_delay(), delay);
    engine.reset();
    assert_eq!(engine.reference_delay(), (0, false));
}
