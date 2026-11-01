//! Banc d'essai DTLN-aec 128 contre LocalVQE v1.4-AEC (200K et 2.7K) — #293.
//!
//! ```sh
//! cargo run --release -p aec --features localvqe --example localvqe_bench -- \
//!     [--wav-out DIR] [--official DIR] [--pair nom=micro.wav,reference.wav ...]
//! ```
//!
//! - scènes intégrées (`crates/aec/data/inputs`) : écho seul, voix locale seule, double parole
//!   synthétique (écho réel + voix réelle enregistrée à part, donc voix propre connue) ;
//! - `--pair` : enregistrements supplémentaires (micro et référence séparés, n'importe quel
//!   format lisible, rééchantillonnés en 16 kHz mono), plus une prise de voix seule en option
//!   pour recomposer une double parole dont la voix propre est connue ;
//! - `--wav-out` : écrit entrées et sorties recalées en WAV pour l'écoute ;
//! - `--official` : dossier des sorties de l'inférence officielle GGML (`{scène}_200K.f32`,
//!   `{scène}_2.7K.f32`, flottants bruts) pour la fidélité, voir `crates/aec/tools/localvqe_ref`.
//!
//! Tout tourne sur un seul fil (onnxruntime est réglé ainsi par `syntheo-onnx`).

mod metrics;
mod studies;

use std::error::Error;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::Instant;

use aec::{AEC, BLOCK_SHIFT, BLOCK_SIZE, LocalVqe, LocalVqeVariant};
use clap::Parser;
use hound::{SampleFormat, WavSpec, WavWriter};
use syntheo_audio_utils::{audio_file_metadata, resample_audio, source_from_path};

pub const SR: usize = 16_000;
/// Les mesures « après convergence » ignorent les 4 premières secondes (le retard GCC de
/// LocalVQE se fige après 3,5 s).
pub const STEADY_SKIP: usize = 4 * SR;

#[derive(Parser)]
pub struct Args {
    #[arg(long, default_value = concat!(env!("CARGO_MANIFEST_DIR"), "/data/inputs"))]
    data_dir: PathBuf,
    #[arg(long)]
    wav_out: Option<PathBuf>,
    #[arg(long)]
    official: Option<PathBuf>,
    /// N'exécute que la comparaison avec l'inférence officielle.
    #[arg(long)]
    fidelity_only: bool,
    /// Enregistrement supplémentaire : `nom=micro.wav,reference.wav` (répétable), ou
    /// `nom=echo_micro.wav,echo_reference.wav,voix.wav` pour une double parole recomposée.
    #[arg(long = "pair")]
    pairs: Vec<String>,
    /// Taille des morceaux passés au modèle (120 ms, comme l'application).
    #[arg(long, default_value_t = 1920)]
    pub chunk: usize,
    /// Répétitions de la mesure CPU (on garde la plus rapide).
    #[arg(long, default_value_t = 3)]
    reps: usize,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Model {
    Dtln,
    Lvqe200,
    Lvqe27,
}

impl Model {
    pub const ALL: [Model; 3] = [Model::Dtln, Model::Lvqe200, Model::Lvqe27];
    pub fn name(self) -> &'static str {
        match self {
            Model::Dtln => "DTLN 128",
            Model::Lvqe200 => "LocalVQE 200K",
            Model::Lvqe27 => "LocalVQE 2.7K",
        }
    }
    fn slug(self) -> &'static str {
        match self {
            Model::Dtln => "dtln128",
            Model::Lvqe200 => "localvqe200k",
            Model::Lvqe27 => "localvqe2k7",
        }
    }
}

pub enum Engine {
    Dtln(Box<AEC>),
    Lvqe(Box<LocalVqe>),
}

impl Engine {
    pub fn new(model: Model, prealign: bool) -> Result<Self, Box<dyn Error>> {
        Ok(match model {
            Model::Dtln => Engine::Dtln(Box::new(AEC::new()?)),
            Model::Lvqe200 | Model::Lvqe27 => {
                let variant = if model == Model::Lvqe200 {
                    LocalVqeVariant::Aec200K
                } else {
                    LocalVqeVariant::Frontend2_7K
                };
                let mut engine = LocalVqe::with_variant(variant)?;
                engine.set_prealign(prealign);
                Engine::Lvqe(Box::new(engine))
            }
        })
    }

    pub fn latency(&self) -> usize {
        match self {
            Engine::Dtln(_) => BLOCK_SIZE - BLOCK_SHIFT,
            Engine::Lvqe(e) => e.latency_samples(),
        }
    }

    /// Reprise après veille : remise à zéro (DTLN, ou `soft = false`) ou reprise douce (LocalVQE).
    pub fn restart(&mut self, soft: bool) {
        match self {
            Engine::Dtln(e) => e.reset(),
            Engine::Lvqe(e) if soft => e.resume(),
            Engine::Lvqe(e) => e.reset(),
        }
    }

    fn feed(
        &mut self,
        mic: &[f32],
        reference: &[f32],
        chunk: usize,
        out: &mut Vec<f32>,
    ) -> Result<(), Box<dyn Error>> {
        for offset in (0..mic.len()).step_by(chunk) {
            let end = (offset + chunk).min(mic.len());
            let (m, r) = (&mic[offset..end], &reference[offset..end]);
            out.extend(match self {
                Engine::Dtln(e) => e.process_streaming(m, r)?,
                Engine::Lvqe(e) => e.process_streaming(m, r)?,
            });
        }
        Ok(())
    }

    /// Flux complet par morceaux, depuis un état neuf ; renvoie la sortie et le temps de calcul.
    /// `restart_at` : remise en route (veille puis reprise) à cet échantillon.
    pub fn run(
        &mut self,
        mic: &[f32],
        reference: &[f32],
        chunk: usize,
        restart_at: Option<(usize, bool)>,
    ) -> Result<(Vec<f32>, f64), Box<dyn Error>> {
        self.restart(false);
        let len = mic.len().min(reference.len());
        let mut out = Vec::with_capacity(len);
        let start = Instant::now();
        match restart_at {
            None => self.feed(&mic[..len], &reference[..len], chunk, &mut out)?,
            Some((at, soft)) => {
                self.feed(&mic[..at], &reference[..at], chunk, &mut out)?;
                self.restart(soft);
                let mut tail = Vec::new();
                self.feed(&mic[at..len], &reference[at..len], chunk, &mut tail)?;
                out.extend(tail);
            }
        }
        Ok((out, start.elapsed().as_secs_f64()))
    }
}

pub struct Scene {
    pub name: String,
    pub mic: Vec<f32>,
    pub reference: Vec<f32>,
    /// Voix locale propre, quand elle est connue.
    pub clean: Option<Vec<f32>>,
    /// Plage où la voix locale parle (mesure de préservation).
    pub voice_window: Option<Range<usize>>,
    /// Faux pour les scènes destinées à l'écoute seulement.
    pub scored: bool,
}

pub fn load(path: &Path) -> Result<Vec<f32>, Box<dyn Error>> {
    let metadata = audio_file_metadata(path)?;
    let channels = (metadata.channels as usize).max(1);
    let source = source_from_path(path)?;
    let samples: Vec<f32> = if metadata.sample_rate as usize == SR {
        source.collect()
    } else {
        resample_audio(source, SR as u32)?
    };
    Ok(samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect())
}

fn write_wav(path: &Path, samples: &[f32]) -> Result<(), Box<dyn Error>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: SR as u32,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };
    let mut writer = WavWriter::create(path, spec)?;
    for &s in samples {
        writer.write_sample(s)?;
    }
    writer.finalize()?;
    Ok(())
}

fn builtin_scenes(dir: &Path) -> Result<Vec<Scene>, Box<dyn Error>> {
    let echo_mic = load(&dir.join("theo_mic.wav"))?;
    let echo_ref = load(&dir.join("theo_lpb.wav"))?;
    let voice = load(&dir.join("syntheo_mic.wav"))?;
    let silent_ref = load(&dir.join("syntheo_lpb.wav"))?;
    let dt_mic = load(&dir.join("doubletalk_mic_sample.wav"))?;
    let dt_ref = load(&dir.join("doubletalk_lpb_sample.wav"))?;

    // Double parole : la voix (enregistrée seule) entre à 12 s dans l'écho seul, filtre convergé.
    let len = echo_mic.len().min(echo_ref.len());
    let at = 12 * SR;
    let voice_len = voice.len().min(len - at);
    let mut clean = vec![0.0; len];
    clean[at..at + voice_len].copy_from_slice(&voice[..voice_len]);
    let mixed: Vec<f32> = (0..len).map(|i| echo_mic[i] + clean[i]).collect();

    // Les 4 premières secondes de l'extrait Microsoft sont de l'écho seul : répétées 3 fois
    // pour laisser converger les modèles adaptatifs.
    let head = 4 * SR;
    let repeat = |x: &[f32]| x[..head].repeat(3);

    Ok(vec![
        Scene {
            name: "echo_seul_theo".into(),
            mic: echo_mic[..len].to_vec(),
            reference: echo_ref[..len].to_vec(),
            clean: None,
            voice_window: None,
            scored: true,
        },
        Scene {
            name: "echo_seul_ms_x3".into(),
            mic: repeat(&dt_mic),
            reference: repeat(&dt_ref),
            clean: None,
            voice_window: None,
            scored: true,
        },
        Scene {
            name: "voix_locale_seule".into(),
            mic: voice.clone(),
            reference: silent_ref,
            clean: Some(voice.clone()),
            voice_window: None,
            scored: true,
        },
        Scene {
            name: "double_parole_synth".into(),
            mic: mixed,
            reference: echo_ref[..len].to_vec(),
            clean: Some(clean),
            voice_window: Some(at..at + voice_len),
            scored: true,
        },
        Scene {
            name: "double_parole_ms".into(),
            mic: dt_mic,
            reference: dt_ref,
            clean: None,
            voice_window: None,
            scored: false,
        },
    ])
}

/// `nom=micro,reference` : enregistrement tel quel. `nom=micro,reference,voix` : le micro et la
/// référence sont une prise d'écho seul, `voix` une prise de voix seule (sans son de l'ordinateur)
/// mêlée à l'écho à partir de 12 s (ou de la moitié si l'écho est plus court) : double parole
/// réaliste dont la voix propre est connue.
fn pair_scene(spec: &str) -> Result<Scene, Box<dyn Error>> {
    const USAGE: &str = "--pair attend nom=micro,reference[,voix]";
    let (name, files) = spec.split_once('=').ok_or(USAGE)?;
    let files: Vec<&str> = files.split(',').collect();
    let (mic, reference) = match files.as_slice() {
        [mic, reference] | [mic, reference, _] => {
            (load(Path::new(mic))?, load(Path::new(reference))?)
        }
        _ => return Err(USAGE.into()),
    };
    let len = mic.len().min(reference.len());
    let Some(voice_path) = files.get(2) else {
        return Ok(Scene {
            name: name.to_string(),
            mic,
            reference,
            clean: None,
            voice_window: None,
            scored: true,
        });
    };
    let voice = load(Path::new(voice_path))?;
    let at = (12 * SR).min(len / 2);
    let voice_len = voice.len().min(len - at);
    let mut clean = vec![0.0; len];
    clean[at..at + voice_len].copy_from_slice(&voice[..voice_len]);
    Ok(Scene {
        name: name.to_string(),
        mic: (0..len).map(|i| mic[i] + clean[i]).collect(),
        reference: reference[..len].to_vec(),
        clean: Some(clean),
        voice_window: Some(at..at + voice_len),
        scored: true,
    })
}

/// ERLE (tout le fichier, puis après convergence) et préservation de la voix (SI-SNR, corrélation).
pub struct Scores {
    pub erle_all: f64,
    pub erle_steady: f64,
    pub voice: Option<(f64, f64)>,
}

pub fn score(
    scene: &Scene,
    mic: &[f32],
    reference: &[f32],
    clean: Option<&[f32]>,
    out: &[f32],
    latency: usize,
) -> Scores {
    let aligned = metrics::compensate(out, latency, mic.len());
    let window = scene.voice_window.clone().unwrap_or(0..mic.len());
    Scores {
        erle_all: metrics::erle_during_pauses(mic, reference, &aligned, clean, 0),
        erle_steady: metrics::erle_during_pauses(mic, reference, &aligned, clean, STEADY_SKIP),
        voice: clean.map(|c| metrics::preservation(&c[window.clone()], &aligned[window.clone()])),
    }
}

pub fn fmt_db(v: f64) -> String {
    if v.is_nan() {
        "—".into()
    } else {
        format!("{v:.1}")
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();
    if args.fidelity_only {
        let dir = args
            .official
            .as_ref()
            .ok_or("--fidelity-only exige --official")?;
        return studies::fidelity_table(&args.data_dir, dir);
    }
    let mut scenes = builtin_scenes(&args.data_dir)?;
    for spec in &args.pairs {
        scenes.push(pair_scene(spec)?);
    }
    if let Some(dir) = &args.wav_out {
        std::fs::create_dir_all(dir)?;
    }

    println!("## Qualité (morceaux de {} échantillons)\n", args.chunk);
    println!(
        "ERLE : trames où la référence joue ; quand la voix locale propre est connue, seulement celles où elle se tait (écho résiduel pendant la double parole). « Après convergence » : sans les 4 premières secondes. SI-SNR et corrélation : sortie contre voix locale propre, là où elle parle.\n"
    );
    println!(
        "| Scène | Modèle | ERLE (dB) | ERLE après convergence (dB) | SI-SNR voix (dB) | Corrélation voix |"
    );
    println!("|---|---|--:|--:|--:|--:|");
    for scene in &scenes {
        let len = scene.mic.len().min(scene.reference.len());
        let (mic, reference) = (&scene.mic[..len], &scene.reference[..len]);
        if let Some(dir) = &args.wav_out {
            write_wav(&dir.join(format!("{}_micro.wav", scene.name)), mic)?;
            write_wav(
                &dir.join(format!("{}_reference.wav", scene.name)),
                reference,
            )?;
        }
        if let (true, Some(clean)) = (scene.scored, &scene.clean) {
            let s = score(scene, mic, reference, Some(clean), mic, 0);
            let (snr, corr) = s.voice.unwrap_or_default();
            println!(
                "| {} | (micro brut) | 0.0 | 0.0 | {snr:.1} | {corr:.3} |",
                scene.name
            );
        }
        for model in Model::ALL {
            let mut engine = Engine::new(model, true)?;
            let (out, _) = engine.run(mic, reference, args.chunk, None)?;
            if scene.scored {
                let s = score(
                    scene,
                    mic,
                    reference,
                    scene.clean.as_deref(),
                    &out,
                    engine.latency(),
                );
                let (snr, corr) = s
                    .voice
                    .map(|(a, b)| (format!("{a:.1}"), format!("{b:.3}")))
                    .unwrap_or(("—".into(), "—".into()));
                println!(
                    "| {} | {} | {} | {} | {snr} | {corr} |",
                    scene.name,
                    model.name(),
                    fmt_db(s.erle_all),
                    fmt_db(s.erle_steady)
                );
            }
            if let Some(dir) = &args.wav_out {
                let aligned = metrics::compensate(&out, engine.latency(), len);
                write_wav(
                    &dir.join(format!("{}_{}.wav", scene.name, model.slug())),
                    &aligned,
                )?;
            }
        }
    }

    println!("\n## Retard de l'écho sur la référence (GCC-PHAT, fichier entier)\n");
    println!(
        "Négatif : la référence arrive après l'écho ; aucun modèle ne peut alors l'annuler sans recalage amont.\n"
    );
    println!("| Scène | Retard (ms) |");
    println!("|---|--:|");
    for scene in scenes
        .iter()
        .filter(|s| s.scored && s.name != "voix_locale_seule")
    {
        let lag = metrics::estimate_lag(&scene.reference, &scene.mic, SR);
        println!(
            "| {} | {:.1} |",
            scene.name,
            lag as f64 * 1000.0 / SR as f64
        );
    }

    cpu_table(&scenes[0], &args)?;
    studies::resume_study(&scenes[0], &args)?;
    studies::delay_study(&scenes, &args)?;
    if let Some(dir) = &args.official {
        studies::fidelity_table(&args.data_dir, dir)?;
    }
    Ok(())
}

fn cpu_table(scene: &Scene, args: &Args) -> Result<(), Box<dyn Error>> {
    let len = scene.mic.len().min(scene.reference.len());
    let audio_s = len as f64 / SR as f64;
    println!(
        "\n## CPU, 1 fil, release ({} : {audio_s:.1} s d'audio, meilleure de {} passes)\n",
        scene.name, args.reps
    );
    println!("| Modèle | ms de calcul par s d'audio | % d'un cœur | ms par pas de 16 ms |");
    println!("|---|--:|--:|--:|");
    for model in Model::ALL {
        let mut engine = Engine::new(model, true)?;
        let mut best = f64::MAX;
        for _ in 0..args.reps.max(1) {
            let (_, secs) =
                engine.run(&scene.mic[..len], &scene.reference[..len], args.chunk, None)?;
            best = best.min(secs);
        }
        let per_s = best / audio_s;
        println!(
            "| {} | {:.1} | {:.1} % | {:.3} |",
            model.name(),
            per_s * 1000.0,
            per_s * 100.0,
            per_s * 16.0
        );
    }
    Ok(())
}
