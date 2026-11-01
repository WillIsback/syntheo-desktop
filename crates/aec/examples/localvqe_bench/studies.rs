//! Études complémentaires du banc : reprise après veille, alignement amont, fidélité.

use std::error::Error;
use std::path::Path;

use aec::{LocalVqe, LocalVqeVariant};

use crate::{Args, Engine, Model, SR, Scene, fmt_db, load, metrics, score};

/// La porte de veille (#291) remet le modèle en route à chaque retour du son de l'ordinateur.
/// Remise à zéro complète contre reprise douce (`LocalVqe::resume`, trajet d'écho conservé).
pub fn resume_study(scene: &Scene, args: &Args) -> Result<(), Box<dyn Error>> {
    let len = scene.mic.len().min(scene.reference.len());
    let at = 11 * SR;
    let window = at..(at + 3 * SR).min(len);
    println!(
        "\n## Reprise après veille ({} : remise en route à 11 s, ERLE sur les 3 s suivantes)\n",
        scene.name
    );
    println!("| Modèle | Reprise | ERLE 11–14 s (dB) |");
    println!("|---|---|--:|");
    let runs: [(Model, bool, &str); 5] = [
        (Model::Dtln, false, "remise à zéro"),
        (Model::Lvqe200, false, "remise à zéro"),
        (Model::Lvqe200, true, "reprise douce"),
        (Model::Lvqe27, false, "remise à zéro"),
        (Model::Lvqe27, true, "reprise douce"),
    ];
    for (model, soft, label) in runs {
        let mut engine = Engine::new(model, true)?;
        let (out, _) = engine.run(
            &scene.mic[..len],
            &scene.reference[..len],
            args.chunk,
            Some((at, soft)),
        )?;
        let aligned = metrics::compensate(&out, engine.latency(), len);
        let erle = metrics::erle_during_pauses(
            &scene.mic[window.clone()],
            &scene.reference[window.clone()],
            &aligned[window.clone()],
            None,
            0,
        );
        println!("| {} | {label} | {} |", model.name(), fmt_db(erle));
    }
    Ok(())
}

/// Alignement amont, comme `aec_reference` une fois verrouillé : retard estimé sur tout le
/// fichier (GCC-PHAT), puis référence (ou micro) retardée. `offset` > 0 retarde la référence de
/// trop (erreur d'estimation qui rend l'écho « non causal ») ; `offset` < 0 laisse à la référence
/// une avance de |offset| échantillons.
#[allow(clippy::type_complexity)]
fn align(
    mic: &[f32],
    reference: &[f32],
    clean: Option<&[f32]>,
    offset: isize,
) -> (Vec<f32>, Vec<f32>, Option<Vec<f32>>) {
    let lag = metrics::estimate_lag(reference, mic, SR) + offset;
    if lag >= 0 {
        (
            mic.to_vec(),
            metrics::delay(reference, lag as usize),
            clean.map(<[f32]>::to_vec),
        )
    } else {
        let d = lag.unsigned_abs();
        (
            metrics::delay(mic, d),
            reference.to_vec(),
            clean.map(|c| metrics::delay(c, d)),
        )
    }
}

pub fn delay_study(scenes: &[Scene], args: &Args) -> Result<(), Box<dyn Error>> {
    println!("\n## Estimation de retard : retard ajouté au micro, avec ou sans alignement amont\n");
    println!(
        "Retard positif : l'écho arrive après la référence, cas physique (≈ 180 ms mesurés chez l'utilisateur). Négatif : la référence arrive après l'écho (capture système plus lente que le micro). « exact » : référence recalée sur le pic GCC-PHAT du fichier entier, comme `aec_reference` verrouillé ; « marge de 32 ms » : recalage qui laisse 32 ms d'avance à la référence ; « 10 ms de trop » : référence recalée 10 ms trop tard.\n"
    );
    println!(
        "| Scène | Retard ajouté | Alignement amont | Modèle | ERLE après convergence (dB) | SI-SNR voix (dB) |"
    );
    println!("|---|--:|---|---|--:|--:|");
    let configs: [(&str, Model, bool); 5] = [
        ("DTLN 128", Model::Dtln, true),
        ("LocalVQE 200K", Model::Lvqe200, true),
        ("LocalVQE 200K sans GCC", Model::Lvqe200, false),
        ("LocalVQE 2.7K", Model::Lvqe27, true),
        ("LocalVQE 2.7K sans GCC", Model::Lvqe27, false),
    ];
    for scene in scenes
        .iter()
        .filter(|s| s.name == "echo_seul_theo" || s.name == "double_parole_synth")
    {
        let len = scene.mic.len().min(scene.reference.len());
        for extra_ms in [0isize, 180, -40] {
            let extra = (extra_ms.unsigned_abs() * SR) / 1000;
            let (mic, reference, clean) = if extra_ms >= 0 {
                (
                    metrics::delay(&scene.mic[..len], extra),
                    scene.reference[..len].to_vec(),
                    scene.clean.as_ref().map(|c| metrics::delay(c, extra)),
                )
            } else {
                (
                    scene.mic[..len].to_vec(),
                    metrics::delay(&scene.reference[..len], extra),
                    scene.clean.clone(),
                )
            };
            for (mode, overshoot) in [
                ("aucun", None),
                ("exact", Some(0)),
                ("marge de 32 ms", Some(-512)),
                ("10 ms de trop", Some(160)),
            ] {
                let (m, r, c) = match overshoot {
                    None => (mic.clone(), reference.clone(), clean.clone()),
                    Some(o) => align(&mic, &reference, clean.as_deref(), o),
                };
                for (label, model, prealign) in configs {
                    let mut engine = Engine::new(model, prealign)?;
                    let (out, _) = engine.run(&m, &r, args.chunk, None)?;
                    let s = score(scene, &m, &r, c.as_deref(), &out, engine.latency());
                    let voice = s
                        .voice
                        .map(|(v, _)| format!("{v:.1}"))
                        .unwrap_or("—".into());
                    println!(
                        "| {} | {extra_ms} ms | {mode} | {label} | {} | {voice} |",
                        scene.name,
                        fmt_db(s.erle_steady)
                    );
                }
            }
        }
    }
    Ok(())
}

fn read_f32(path: &Path) -> Result<Vec<f32>, Box<dyn Error>> {
    Ok(std::fs::read(path)?
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// Sorties Rust contre l'inférence officielle GGML (même entrée, flux par pas de 256).
pub fn fidelity_table(data_dir: &Path, official: &Path) -> Result<(), Box<dyn Error>> {
    println!("\n## Fidélité Rust contre l'inférence officielle (GGML, flux)\n");
    println!(
        "| Fichier | Modèle | Erreur max | Crête du signal | SNR Rust/officiel (dB) | Retard GCC (échantillons) |"
    );
    println!("|---|---|--:|--:|--:|--:|");
    let files = [
        (
            "doubletalk",
            "doubletalk_mic_sample",
            "doubletalk_lpb_sample",
        ),
        ("syntheo", "syntheo_mic", "syntheo_lpb"),
        ("theo", "theo_mic", "theo_lpb"),
    ];
    for (name, mic, lpb) in files {
        let mic = load(&data_dir.join(format!("{mic}.wav")))?;
        let reference = load(&data_dir.join(format!("{lpb}.wav")))?;
        for (variant, tag) in [
            (LocalVqeVariant::Aec200K, "200K"),
            (LocalVqeVariant::Frontend2_7K, "2.7K"),
        ] {
            let path = official.join(format!("{name}_{tag}.f32"));
            if !path.exists() {
                continue;
            }
            let expected = read_f32(&path)?;
            let mut engine = LocalVqe::with_variant(variant)?;
            let len = mic.len().min(reference.len());
            let out = engine.process_streaming(&mic[..len], &reference[..len])?;
            // L'officiel rend chaque pas sans file d'attente : on retire le pas de file, et la
            // fin encore dans la file n'est pas comparée.
            let valid = expected.len().min(out.len() - engine.hop_samples());
            let ours = metrics::compensate(&out, engine.hop_samples(), valid);
            let (max_err, snr) = metrics::fidelity(&expected[..valid], &ours);
            let peak = expected.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            let (shift, locked) = engine.reference_delay();
            println!(
                "| {name} | {tag} | {max_err:.2e} | {peak:.3} | {snr:.1} | {shift}{} |",
                if locked { " (figé)" } else { "" }
            );
        }
    }
    Ok(())
}
