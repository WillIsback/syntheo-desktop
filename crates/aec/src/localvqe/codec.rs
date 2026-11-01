//! Banc de filtres « STFT-256 » de LocalVQE : trame de 512, pas de 256, fenêtre racine de Hann
//! `w[n] = sin(π(n + ½)/512)` à l'analyse comme à la synthèse, bins 1 à 256 (DC retiré, Nyquist
//! gardé avec le même poids que les autres). Équivaut aux matrices `encoder.conv.weight` et
//! `decoder.linear.weight` du GGUF officiel (rapport technique, § 2.1), calculé ici par FFT.

use std::sync::Arc;

use realfft::{ComplexToReal, RealFftPlanner, RealToComplex, num_complex::Complex};

use super::{FFT_SIZE, HOP_SIZE, N_BINS};

pub(crate) struct Codec {
    window: Vec<f32>,
    forward: Arc<dyn RealToComplex<f32>>,
    inverse: Arc<dyn ComplexToReal<f32>>,
    time: Vec<f32>,
    freq: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
}

impl Codec {
    pub(crate) fn new(window: Vec<f32>) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let forward = planner.plan_fft_forward(FFT_SIZE);
        let inverse = planner.plan_fft_inverse(FFT_SIZE);
        let scratch_len = forward.get_scratch_len().max(inverse.get_scratch_len());
        Self {
            window,
            forward,
            inverse,
            time: vec![0.0; FFT_SIZE],
            freq: vec![Complex::new(0.0, 0.0); FFT_SIZE / 2 + 1],
            scratch: vec![Complex::new(0.0, 0.0); scratch_len],
        }
    }

    /// `previous` puis `current` (256 chacun) forment la trame ; `out` reçoit `[re(256) | im(256)]`,
    /// la disposition `[1, 2, 1, 256]` attendue par le masque.
    pub(crate) fn analysis(&mut self, previous: &[f32], current: &[f32], out: &mut [f32]) {
        for (i, t) in self.time.iter_mut().enumerate() {
            let sample = if i < HOP_SIZE {
                previous[i]
            } else {
                current[i - HOP_SIZE]
            };
            *t = sample * self.window[i];
        }
        let _ =
            self.forward
                .process_with_scratch(&mut self.time, &mut self.freq, &mut self.scratch);
        let (re, im) = out.split_at_mut(N_BINS);
        for k in 0..N_BINS {
            re[k] = self.freq[k + 1].re;
            im[k] = self.freq[k + 1].im;
        }
    }

    /// Spectre `[re | im]` -> trame de 512 fenêtrée, à additionner en recouvrement.
    pub(crate) fn synthesis(&mut self, spectrum: &[f32], frame: &mut [f32]) {
        let (re, im) = spectrum.split_at(N_BINS);
        self.freq[0] = Complex::new(0.0, 0.0);
        for k in 1..N_BINS {
            self.freq[k] = Complex::new(re[k - 1], im[k - 1]);
        }
        // Nyquist : poids 2/K comme les autres bins (une iFFT standard lui donnerait 1/K).
        self.freq[N_BINS] = Complex::new(2.0 * re[N_BINS - 1], 0.0);
        let _ =
            self.inverse
                .process_with_scratch(&mut self.freq, &mut self.time, &mut self.scratch);
        let scale = 1.0 / FFT_SIZE as f32;
        for ((o, &t), &w) in frame
            .iter_mut()
            .zip(self.time.iter())
            .zip(self.window.iter())
        {
            *o = t * scale * w;
        }
    }
}
