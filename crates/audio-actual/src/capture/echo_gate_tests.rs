use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use super::*;

const RATE: u32 = 16_000;
const FRAME: usize = 1_920;

/// Faux modèle : sortie = micro retardé de `latency` et multiplié par `gain`, appels et remises
/// à zéro comptés.
pub(crate) struct CountingCanceller {
    pub(crate) calls: Arc<AtomicUsize>,
    pub(crate) resets: Arc<AtomicUsize>,
    gain: f32,
    latency: usize,
    line: VecDeque<f32>,
}

impl CountingCanceller {
    pub(crate) fn new(gain: f32, latency: usize) -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            resets: Arc::new(AtomicUsize::new(0)),
            gain,
            latency,
            line: std::iter::repeat_n(0.0, latency).collect(),
        }
    }
}

impl EchoCanceller for CountingCanceller {
    type Error = std::convert::Infallible;

    fn process_streaming(
        &mut self,
        mic: &[f32],
        _reference: &[f32],
    ) -> Result<Vec<f32>, Self::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(mic
            .iter()
            .map(|&sample| {
                self.line.push_back(sample);
                self.line.pop_front().unwrap_or(0.0) * self.gain
            })
            .collect())
    }

    fn reset(&mut self) {
        self.resets.fetch_add(1, Ordering::SeqCst);
        self.line = std::iter::repeat_n(0.0, self.latency).collect();
    }

    fn latency_samples(&self) -> usize {
        self.latency
    }

    fn hop_samples(&self) -> usize {
        128
    }
}

fn sine(len: usize, offset: usize, amplitude: f32, freq: f32) -> Vec<f32> {
    (offset..offset + len)
        .map(|idx| amplitude * (2.0 * std::f32::consts::PI * freq * idx as f32 / RATE as f32).sin())
        .collect()
}

fn max_step(signal: &[f32]) -> f32 {
    signal
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .fold(0.0, f32::max)
}

#[test]
fn detector_threshold_is_minus_sixty_dbfs() {
    let mut detector = ReferenceActivityDetector::new(RATE);
    // Sinus d'amplitude 0,001 : RMS ≈ −63 dBFS.
    assert!(!detector.observe(&sine(FRAME, 0, 0.001, 440.0)));
    assert!(!detector.observe(&vec![0.0; FRAME]));
    // Amplitude 0,002 : RMS ≈ −57 dBFS.
    assert!(detector.observe(&sine(FRAME, 0, 0.002, 440.0)));
}

#[test]
fn detector_wakes_on_a_brief_sound_inside_a_long_frame() {
    let mut detector = ReferenceActivityDetector::new(RATE);
    let mut frame = vec![0.0; FRAME];
    frame[800..960].copy_from_slice(&sine(160, 0, 0.01, 1_000.0));
    assert!(detector.observe(&frame));
}

#[test]
fn detector_holds_for_the_full_hangover() {
    let hop = 160; // 10 ms
    let mut detector = ReferenceActivityDetector::new(RATE);
    assert!(detector.observe(&sine(hop, 0, 0.1, 440.0)));
    let silence = vec![0.0; hop];
    let active_frames = (0..100).take_while(|_| detector.observe(&silence)).count();
    // 49 trames de 10 ms encore actives (< 500 ms), la 50e (500 ms) éteint le modèle.
    assert_eq!(active_frames, 49);
    assert!(active_frames * hop >= ms_to_samples(RATE, REFERENCE_HANGOVER_MS) - hop);
}

#[test]
fn silent_reference_bypasses_the_model_and_passes_the_mic_through() {
    let fake = CountingCanceller::new(0.2, 0);
    let calls = Arc::clone(&fake.calls);
    let mut gate = GatedEchoCanceller::new(fake, RATE);
    let silence = vec![0.0; FRAME];
    for idx in 0..10 {
        let mic = sine(FRAME, idx * FRAME, 0.3, 440.0);
        let output = gate.process(&mic, &silence, |wet| wet).unwrap();
        assert_eq!(output, mic);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn bypass_stays_in_phase_with_the_model_latency() {
    let latency = 384;
    let mut gate = GatedEchoCanceller::new(CountingCanceller::new(0.2, latency), RATE);
    let silence = vec![0.0; FRAME];
    let mic: Vec<f32> = sine(FRAME * 2, 0, 0.3, 440.0);
    let mut output = gate.process(&mic[..FRAME], &silence, |wet| wet).unwrap();
    output.extend(gate.process(&mic[FRAME..], &silence, |wet| wet).unwrap());
    assert!(output[..latency].iter().all(|sample| *sample == 0.0));
    assert_eq!(&output[latency..], &mic[..FRAME * 2 - latency]);
}

#[test]
fn active_reference_resumes_the_model_within_the_frame() {
    let latency = 384;
    let fake = CountingCanceller::new(0.2, latency);
    let calls = Arc::clone(&fake.calls);
    let mut gate = GatedEchoCanceller::new(fake, RATE);
    let mic = sine(FRAME * 2, 0, 0.3, 440.0);
    gate.process(&mic[..FRAME], &vec![0.0; FRAME], |wet| wet)
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let reference = sine(FRAME, 0, 0.1, 300.0);
    let output = gate.process(&mic[FRAME..], &reference, |wet| wet).unwrap();
    // Reprise : historique rejoué, puis la trame courante.
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    // Après le fondu (10 ms), toute la trame vient du modèle, réchauffé par l'historique :
    // pas de zéros de démarrage, même dans les `latency` premiers échantillons.
    let fade = ms_to_samples(RATE, CROSSFADE_MS);
    for idx in fade..FRAME {
        let expected = mic[FRAME + idx - latency] * 0.2;
        assert!((output[idx] - expected).abs() < 1e-6, "échantillon {idx}");
    }
}

#[test]
fn model_keeps_running_through_the_hangover() {
    let fake = CountingCanceller::new(0.2, 0);
    let calls = Arc::clone(&fake.calls);
    let mut gate = GatedEchoCanceller::new(fake, RATE);
    let mic = sine(FRAME, 0, 0.3, 440.0);
    gate.process(&mic, &sine(FRAME, 0, 0.1, 300.0), |wet| wet)
        .unwrap();
    let silence = vec![0.0; FRAME];
    let mut called = Vec::new();
    for _ in 0..8 {
        let before = calls.load(Ordering::SeqCst);
        gate.process(&mic, &silence, |wet| wet).unwrap();
        called.push(calls.load(Ordering::SeqCst) > before);
    }
    // 4 trames de 120 ms dans la traîne (480 ms), une 5e pour le fondu de sortie, puis veille.
    assert_eq!(called, [true, true, true, true, true, false, false, false]);
}

#[test]
fn transitions_have_no_discontinuity() {
    let latency = 384;
    let mut gate = GatedEchoCanceller::new(CountingCanceller::new(0.2, latency), RATE);
    let reference_on = sine(FRAME, 0, 0.1, 300.0);
    let reference_off = vec![0.0; FRAME];
    let schedule = [
        false, false, true, true, false, false, false, false, false, false, true,
    ];
    let mut output = Vec::new();
    let mut mic = Vec::new();
    for (idx, active) in schedule.iter().enumerate() {
        let frame = sine(FRAME, idx * FRAME, 0.5, 440.0);
        let reference = if *active {
            &reference_on
        } else {
            &reference_off
        };
        output.extend(gate.process(&frame, reference, |wet| wet).unwrap());
        mic.extend(frame);
    }
    let natural = max_step(&mic);
    let step = max_step(&output[latency + 1..]);
    // Un basculement sec entre micro (×1) et modèle (×0,2) sauterait jusqu'à 0,4.
    assert!(
        step <= natural * 1.1,
        "saut {step} > borne {} (pente naturelle {natural})",
        natural * 1.1
    );
}

#[test]
fn dtln_latency_matches_the_declared_value() {
    let Ok(mut aec) = syntheo_aec::AEC::new() else {
        return;
    };
    // Impulsions sur un fond tonal, référence muette : le modèle laisse passer le micro.
    let mic: Vec<f32> = (0..FRAME * 4)
        .map(|idx| if idx % 1_000 < 40 { 0.4 } else { 0.0 } + 0.05 * (idx as f32 * 0.37).sin())
        .collect();
    let reference = vec![0.0; FRAME];
    let mut output = Vec::new();
    for chunk in mic.chunks(FRAME) {
        output.extend(EchoCanceller::process_streaming(&mut aec, chunk, &reference).unwrap());
    }
    let correlation = |lag: usize| -> f32 {
        mic.iter()
            .zip(&output[lag..])
            .map(|(left, right)| left * right)
            .sum()
    };
    let best_lag = (0..1_000)
        .max_by(|&left, &right| correlation(left).total_cmp(&correlation(right)))
        .unwrap();
    assert_eq!(best_lag, aec.latency_samples());
}

fn load_wav(name: &str) -> Vec<f32> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../aec/data/inputs")
        .join(name);
    hound::WavReader::open(path)
        .unwrap()
        .into_samples::<i16>()
        .map(|sample| sample.unwrap() as f32 / 32_768.0)
        .collect()
}

fn time_frames(mic: &[f32], reference: &[f32], mut process: impl FnMut(&[f32], &[f32])) -> f64 {
    let start = std::time::Instant::now();
    for (mic, reference) in mic.chunks(FRAME).zip(reference.chunks(FRAME)) {
        process(mic, reference);
    }
    start.elapsed().as_secs_f64()
}

/// Micro-bench : `cargo test -p audio-actual --release echo_gate_bench -- --ignored --nocapture`.
/// 60 s de signal réel, la référence alternant son et silence numérique à parts égales.
#[test]
#[ignore = "micro-bench, lancé à la main"]
fn echo_gate_bench_half_silent_reference() {
    let total = RATE as usize * 60;
    let mic: Vec<f32> = load_wav("doubletalk_mic_sample.wav")
        .into_iter()
        .cycle()
        .take(total)
        .collect();
    let reference_full: Vec<f32> = load_wav("doubletalk_lpb_sample.wav")
        .into_iter()
        .cycle()
        .take(total)
        .collect();

    for period_s in [2usize, 5, 10, 30] {
        let period = RATE as usize * period_s;
        let reference: Vec<f32> = reference_full
            .iter()
            .enumerate()
            .map(|(idx, sample)| {
                if (idx / period).is_multiple_of(2) {
                    *sample
                } else {
                    0.0
                }
            })
            .collect();
        let mut always = syntheo_aec::AEC::new().unwrap();
        let always = time_frames(&mic, &reference, |mic, reference| {
            std::hint::black_box(
                EchoCanceller::process_streaming(&mut always, mic, reference).unwrap(),
            );
        });
        let mut gate = GatedEchoCanceller::new(syntheo_aec::AEC::new().unwrap(), RATE);
        let gated = time_frames(&mic, &reference, |mic, reference| {
            std::hint::black_box(gate.process(mic, reference, |wet| wet).unwrap());
        });
        println!(
            "alternance {period_s} s : toujours actif {always:.3} s, en veille {gated:.3} s \
             pour 60 s d'audio, gain {:.0} %",
            100.0 * (1.0 - gated / always)
        );
    }
}
