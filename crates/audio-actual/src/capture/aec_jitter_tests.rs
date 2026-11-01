//! Mesure de qualité (#322) : gigue d'alignement de ±2 échantillons toutes les 2 s sur les
//! enregistrements de `crates/aec/data`, avec le vrai modèle DTLN et la chaîne de `stream.rs`
//! (lignes de retard, mise en veille, gain d'écho linéaire).
//!
//! `cargo test --release -p audio-actual --lib aec_jitter -- --ignored --nocapture`

use dasp::sample::Sample;

use super::*;

const RATE: u32 = 16_000;
const FRAME: usize = 1_920;
/// Retard du chemin d'écho simulé : celui du journal de #322.
const BASE_LAG: usize = 904;
const JITTER_PERIOD: usize = 2 * RATE as usize;
/// Écart de la mesure à `BASE_LAG`, une valeur par période de 2 s.
const JITTER: [isize; 8] = [0, 2, -1, 1, -2, 2, -2, 1];
/// Fenêtre de reconvergence observée après chaque nouvelle mesure.
const AFTER_CHANGE: usize = RATE as usize / 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Strategy {
    /// Témoin : alignement exact, sans gigue.
    Ideal,
    /// Comportement d'avant #322 : chaque écart est appliqué et réinitialise l'annulation.
    ResetOnEveryChange,
    /// Correctif retenu, option (a) : hystérésis sous 1 ms (`commit_alignment`).
    Hysteresis,
    /// Option (b), pour comparaison : écart appliqué à la ligne de retard, sans remise à zéro.
    ShiftWithoutReset,
}

struct Run {
    /// Micro d'entrée (avec le retard du chemin d'écho) et sortie recalée de la latence du modèle.
    mic: Vec<f32>,
    output: Vec<f32>,
    resets: usize,
    change_starts: Vec<usize>,
}

fn load(name: &str) -> Vec<f32> {
    let path = format!("{}/../aec/data/inputs/{name}", env!("CARGO_MANIFEST_DIR"));
    let file = std::fs::File::open(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    rodio::Decoder::new(std::io::BufReader::new(file))
        .unwrap()
        .map(|sample| sample.to_sample::<f32>())
        .collect()
}

fn energy(signal: &[f32]) -> f64 {
    signal.iter().map(|&sample| f64::from(sample).powi(2)).sum()
}

fn ratio_db(numerator: f64, denominator: f64) -> f64 {
    10.0 * (numerator / denominator.max(1e-12)).log10()
}

fn run(mic: &[f32], lpb: &[f32], strategy: Strategy) -> Option<Run> {
    // Le micro entend la référence `BASE_LAG` échantillons plus tard : l'alignement vrai est
    // `DelaySpeaker(BASE_LAG)`.
    let len = mic.len().min(lpb.len());
    let mic_in: Vec<f32> = std::iter::repeat_n(0.0, BASE_LAG)
        .chain(mic[..len].iter().copied())
        .collect();
    let speaker_in: Vec<f32> = lpb[..len]
        .iter()
        .copied()
        .chain(std::iter::repeat_n(0.0, BASE_LAG))
        .collect();

    let mut aec = build_aec(RATE);
    aec.as_ref()?;
    let latency = syntheo_aec::BLOCK_SIZE - syntheo_aec::BLOCK_SHIFT;
    let mut linear_echo_gain = None;
    let mut aligner = AecReferenceAligner::new(RATE);
    let mut current = AecAlignment::None;
    let mut mic_line = SampleDelayLine::new(BASE_LAG * 2);
    let mut speaker_line = SampleDelayLine::new(BASE_LAG * 2);
    let mut output = Vec::with_capacity(mic_in.len());
    let mut resets = 0;
    let mut change_starts = Vec::new();
    let mut last_period = None;

    for (index, (mic_frame, speaker_frame)) in mic_in
        .chunks(FRAME)
        .zip(speaker_in.chunks(FRAME))
        .enumerate()
    {
        let start = index * FRAME;
        let period = start / JITTER_PERIOD;
        if last_period != Some(period) {
            last_period = Some(period);
            let jitter = if strategy == Strategy::Ideal {
                0
            } else {
                JITTER[period % JITTER.len()]
            };
            let measured = AecAlignment::DelaySpeaker(BASE_LAG.saturating_add_signed(jitter));
            let changed = match strategy {
                Strategy::Ideal | Strategy::ResetOnEveryChange => {
                    let changed = measured != current;
                    current = measured;
                    changed
                }
                Strategy::Hysteresis => {
                    let changed = aligner.commit_alignment(measured);
                    current = aligner.applied_alignment;
                    changed
                }
                Strategy::ShiftWithoutReset => {
                    let first = current == AecAlignment::None;
                    current = measured;
                    first
                }
            };
            if changed {
                resets += 1;
                reset_echo_cancellation(&mut aec, &mut linear_echo_gain);
            }
            if period > 0 {
                change_starts.push(start);
            }
        }
        let aligned_mic = mic_line.process(mic_frame, current.mic_delay_samples());
        let aligned_speaker = speaker_line.process(speaker_frame, current.speaker_delay_samples());
        let processed = process_aec(
            &mut aec,
            &mut linear_echo_gain,
            &aligned_mic,
            &aligned_speaker,
        )?;
        output.extend_from_slice(&processed);
    }

    // La sortie retarde le micro de la latence du modèle : on les recale.
    let usable = mic_in.len() - latency;
    Some(Run {
        mic: mic_in[..usable].to_vec(),
        output: output[latency..latency + usable].to_vec(),
        resets,
        change_starts,
    })
}

#[test]
#[ignore = "mesure longue avec le modèle DTLN réel"]
fn aec_jitter_erle_on_recordings() {
    println!(
        "| Fichier | Stratégie | Réinit. | ERLE global (dB) | ERLE 500 ms après mesure (dB) \
         | Écart à la sortie idéale, SDR (dB) |"
    );
    println!("|---|---|---|---|---|---|");
    // `syntheo_lpb.wav` est un silence numérique : pas d'écho, l'annulation reste en veille.
    for (name, lpb, mic) in [
        ("theo (écho)", "theo_lpb.wav", "theo_mic.wav"),
        (
            "doubletalk",
            "doubletalk_lpb_sample.wav",
            "doubletalk_mic_sample.wav",
        ),
    ] {
        let (lpb, mic) = (load(lpb), load(mic));
        let Some(ideal) = run(&mic, &lpb, Strategy::Ideal) else {
            println!("modèle indisponible, mesure ignorée");
            return;
        };
        let mut erle = Vec::new();
        for strategy in [
            Strategy::Ideal,
            Strategy::ResetOnEveryChange,
            Strategy::Hysteresis,
            Strategy::ShiftWithoutReset,
        ] {
            let result = run(&mic, &lpb, strategy).unwrap();
            let window = |from: usize, to: usize, signal: &[f32]| {
                energy(&signal[from.min(signal.len())..to.min(signal.len())])
            };
            let total = ratio_db(
                window(JITTER_PERIOD, usize::MAX, &result.mic),
                window(JITTER_PERIOD, usize::MAX, &result.output),
            );
            let (mic_after, out_after) =
                result
                    .change_starts
                    .iter()
                    .fold((0.0, 0.0), |(mic_after, out_after), &start| {
                        (
                            mic_after + window(start, start + AFTER_CHANGE, &result.mic),
                            out_after + window(start, start + AFTER_CHANGE, &result.output),
                        )
                    });
            let deviation: Vec<f32> = result
                .output
                .iter()
                .zip(&ideal.output)
                .map(|(out, reference)| out - reference)
                .collect();
            let sdr = ratio_db(
                window(JITTER_PERIOD, usize::MAX, &ideal.output),
                window(JITTER_PERIOD, usize::MAX, &deviation),
            );
            // Au-delà de 90 dB, l'écart n'est que le bruit numérique de l'inférence.
            let sdr = if sdr > 90.0 {
                "identique".to_string()
            } else {
                format!("{sdr:.1}")
            };
            println!(
                "| {name} | {strategy:?} | {} | {total:.2} | {:.2} | {sdr} |",
                result.resets,
                ratio_db(mic_after, out_after),
            );
            erle.push(total);
        }
        if name.starts_with("theo") {
            // Écho seul : un ERLE plus élevé est un meilleur résultat sans ambiguïté.
            assert!(
                erle[2] > erle[1],
                "{name} : l'hystérésis doit améliorer l'ERLE"
            );
        }
    }
}
