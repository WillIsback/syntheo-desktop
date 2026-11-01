//! Mesures du banc : ERLE, préservation de la voix locale, fidélité entre deux sorties, retard.

use realfft::RealFftPlanner;

/// Trame d'analyse de l'ERLE : 16 ms.
const FRAME: usize = 256;
/// Seuil d'activité de la référence (−45 dBFS en RMS) pour l'ERLE « référence active ».
const REFERENCE_ACTIVE_RMS: f32 = 5.6e-3;
/// Voix locale considérée muette sous −55 dBFS (le bruit de fond de l'enregistrement est vers −66).
const VOICE_SILENT_RMS: f32 = 1.8e-3;

fn energy(x: &[f32]) -> f64 {
    x.iter().map(|&v| (v as f64) * (v as f64)).sum()
}

fn db(ratio: f64) -> f64 {
    10.0 * ratio.max(1e-20).log10()
}

/// ERLE en dB : énergie du micro sur énergie de la sortie, sur les trames où la référence
/// joue, à partir de `skip` échantillons (convergence). `output` est déjà recalé sur `mic`.
/// Si la voix locale `clean` est fournie, seulement les trames où elle se tait : l'écho
/// résiduel pendant une double parole, sans compter la voix elle-même.
pub fn erle_during_pauses(
    mic: &[f32],
    reference: &[f32],
    output: &[f32],
    clean: Option<&[f32]>,
    skip: usize,
) -> f64 {
    let len = mic.len().min(reference.len()).min(output.len());
    let rms = |x: &[f32]| (energy(x) / FRAME as f64).sqrt() as f32;
    let (mut num, mut den) = (0.0, 0.0);
    let mut start = skip;
    while start + FRAME <= len {
        let r = &reference[start..start + FRAME];
        let voice_silent = clean.is_none_or(|c| {
            c.len() >= start + FRAME && rms(&c[start..start + FRAME]) < VOICE_SILENT_RMS
        });
        if rms(r) >= REFERENCE_ACTIVE_RMS && voice_silent {
            num += energy(&mic[start..start + FRAME]);
            den += energy(&output[start..start + FRAME]);
        }
        start += FRAME;
    }
    if num == 0.0 { f64::NAN } else { db(num / den) }
}

/// Sortie recalée : `output[latency..]`, complétée de zéros à la longueur d'origine.
pub fn compensate(output: &[f32], latency: usize, len: usize) -> Vec<f32> {
    let mut aligned: Vec<f32> = output.iter().skip(latency).copied().take(len).collect();
    aligned.resize(len, 0.0);
    aligned
}

/// Préservation d'une voix propre connue : SNR (dB) de la sortie par rapport à `clean`, après
/// gain optimal (SI-SNR), et corrélation de Pearson.
pub fn preservation(clean: &[f32], output: &[f32]) -> (f64, f64) {
    let len = clean.len().min(output.len());
    let (c, o) = (&clean[..len], &output[..len]);
    let dot: f64 = c.iter().zip(o).map(|(&a, &b)| a as f64 * b as f64).sum();
    let ec = energy(c);
    let eo = energy(o);
    let alpha = dot / ec.max(1e-20);
    let noise: f64 = c
        .iter()
        .zip(o)
        .map(|(&a, &b)| {
            let d = b as f64 - alpha * a as f64;
            d * d
        })
        .sum();
    let si_snr = db(alpha * alpha * ec / noise.max(1e-20));
    let mean_c = c.iter().map(|&v| v as f64).sum::<f64>() / len as f64;
    let mean_o = o.iter().map(|&v| v as f64).sum::<f64>() / len as f64;
    let cov = dot - len as f64 * mean_c * mean_o;
    let var_c = ec - len as f64 * mean_c * mean_c;
    let var_o = eo - len as f64 * mean_o * mean_o;
    (si_snr, cov / (var_c * var_o).sqrt().max(1e-20))
}

/// Écart entre deux signaux censés être identiques : erreur max et SNR (dB).
pub fn fidelity(reference: &[f32], candidate: &[f32]) -> (f32, f64) {
    let len = reference.len().min(candidate.len());
    let mut max_err = 0.0f32;
    let mut err = 0.0f64;
    for (&a, &b) in reference[..len].iter().zip(&candidate[..len]) {
        let d = a - b;
        max_err = max_err.max(d.abs());
        err += (d as f64) * (d as f64);
    }
    (max_err, db(energy(&reference[..len]) / err.max(1e-30)))
}

/// Retard du micro sur la référence (échantillons, positif si le micro est en retard), par
/// GCC-PHAT sur tout le fichier, dans ±`max_lag`.
pub fn estimate_lag(reference: &[f32], mic: &[f32], max_lag: usize) -> isize {
    let len = reference.len().min(mic.len());
    let n = (2 * len).next_power_of_two();
    let mut planner = RealFftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);
    let spectrum = |x: &[f32]| {
        let mut buf: Vec<f64> = x[..len].iter().map(|&v| v as f64).collect();
        buf.resize(n, 0.0);
        let mut out = fft.make_output_vec();
        let _ = fft.process(&mut buf, &mut out);
        out
    };
    let (r, m) = (spectrum(reference), spectrum(mic));
    let mut cross: Vec<_> = m
        .iter()
        .zip(&r)
        .map(|(a, b)| {
            let c = a * b.conj();
            c / (c.norm() + 1e-12)
        })
        .collect();
    cross[0].im = 0.0;
    if let Some(last) = cross.last_mut() {
        last.im = 0.0;
    }
    let mut corr = ifft.make_output_vec();
    let _ = ifft.process(&mut cross, &mut corr);
    let mut best = (0isize, f64::MIN);
    for lag in -(max_lag as isize)..=(max_lag as isize) {
        let idx = if lag >= 0 {
            lag as usize
        } else {
            n - lag.unsigned_abs()
        };
        if corr[idx] > best.1 {
            best = (lag, corr[idx]);
        }
    }
    best.0
}

/// Retarde `x` de `delay` échantillons (zéros devant), longueur conservée.
pub fn delay(x: &[f32], delay: usize) -> Vec<f32> {
    let mut out = vec![0.0; delay.min(x.len())];
    out.extend_from_slice(&x[..x.len() - out.len()]);
    out
}
