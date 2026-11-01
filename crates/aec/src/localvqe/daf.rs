//! Frontal adaptatif de LocalVQE v1.4-AEC (« DAF ») : préalignement GCC-PHAT, filtre de Kalman
//! par blocs partitionnés dans le domaine fréquentiel (M = 128, N = 128 partitions, soit 1,024 s
//! d'écho modélisé, 2 itérations par bloc) piloté par un contrôleur appris de 2 742 poids.
//!
//! Portage en Rust de `ggml/daf_frontend.cpp` (LocalVQE, Apache-2.0, © les auteurs de LocalVQE).
//! L'ordre des opérations flottantes suit le C++ pour rester au plus près de la référence ; seules
//! les FFT diffèrent (realfft au lieu de la FFT radix-2 maison).
//!
//! Sortie : `e = micro − ŷ` (écho linéaire retiré) et `ŷ` (écho estimé), entrées du masque.

// Boucles indicées comme dans le C++, pour la relecture côte à côte avec la référence.
#![allow(clippy::needless_range_loop)]

use std::sync::Arc;

use realfft::{ComplexToReal, RealFftPlanner, RealToComplex, num_complex::Complex};

use super::controller::Controller;
use super::weights::ControllerWeights;

pub(crate) const M: usize = 128;
pub(crate) const N: usize = 128;
pub(crate) const K_ITER: usize = 2;
const NFFT: usize = 256;
const NB: usize = NFFT / 2 + 1;
const A_DECAY: f32 = 0.999;
const P_INIT: f32 = 1e3;

const G_WIN: usize = 16384;
const G_HOP: i64 = 8000;
const G_NFFT: usize = 32768;
const G_MAXLAG: usize = 16384;
const G_GATE_DB: f32 = 26.0;
const G_CONF_THR: f32 = 8.0;
/// Le décalage GCC se fige au premier estimé confiant après 3,5 s.
const LOCK_AFTER: i64 = 56000;
const DELAY_LINE: usize = G_MAXLAG + M;

/// FFT réelle avec les conventions du C++ : directe non normalisée, inverse divisée par n et
/// parties imaginaires de DC et Nyquist ignorées.
struct RealFft {
    n: usize,
    forward: Arc<dyn RealToComplex<f32>>,
    inverse: Arc<dyn ComplexToReal<f32>>,
    time: Vec<f32>,
    freq: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
}

impl RealFft {
    fn new(planner: &mut RealFftPlanner<f32>, n: usize) -> Self {
        let forward = planner.plan_fft_forward(n);
        let inverse = planner.plan_fft_inverse(n);
        let scratch_len = forward.get_scratch_len().max(inverse.get_scratch_len());
        Self {
            n,
            forward,
            inverse,
            time: vec![0.0; n],
            freq: vec![Complex::new(0.0, 0.0); n / 2 + 1],
            scratch: vec![Complex::new(0.0, 0.0); scratch_len],
        }
    }

    fn rfft(&mut self, x: &[f32], out_re: &mut [f32], out_im: &mut [f32]) {
        self.time.copy_from_slice(&x[..self.n]);
        // Tailles valides par construction : l'erreur de realfft est impossible ici.
        let _ =
            self.forward
                .process_with_scratch(&mut self.time, &mut self.freq, &mut self.scratch);
        for (k, c) in self.freq.iter().enumerate() {
            out_re[k] = c.re;
            out_im[k] = c.im;
        }
    }

    fn irfft(&mut self, re: &[f32], im: &[f32], out: &mut [f32]) {
        let nb = self.n / 2;
        for (k, c) in self.freq.iter_mut().enumerate() {
            *c = Complex::new(re[k], if k == 0 || k == nb { 0.0 } else { im[k] });
        }
        let _ =
            self.inverse
                .process_with_scratch(&mut self.freq, &mut self.time, &mut self.scratch);
        let scale = 1.0 / self.n as f32;
        for (o, &t) in out.iter_mut().zip(self.time.iter()) {
            *o = t * scale;
        }
    }
}

struct Scratch {
    xn: Vec<f32>,
    x_re: Vec<f32>,
    x_im: Vec<f32>,
    y_re: Vec<f32>,
    y_im: Vec<f32>,
    e_re: Vec<f32>,
    e_im: Vec<f32>,
    e2_re: Vec<f32>,
    e2_im: Vec<f32>,
    d_re: Vec<f32>,
    d_im: Vec<f32>,
    x2: Vec<f32>,
    mean_p: Vec<f32>,
    buf: Vec<f32>,
    mu: Vec<f32>,
    // GCC
    g_pad: Vec<f32>,
    g_xr: Vec<f32>,
    g_xi: Vec<f32>,
    g_dr: Vec<f32>,
    g_di: Vec<f32>,
    g_c: Vec<f32>,
}

pub(crate) struct Daf {
    controller: Controller,
    fft: RealFft,
    gcc_fft: RealFft,
    scratch: Scratch,
    pub(crate) enable_prealign: bool,
    // Filtre : (N, NB), partition 0 = la plus récente.
    h_re: Vec<f32>,
    h_im: Vec<f32>,
    x_re: Vec<f32>,
    x_im: Vec<f32>,
    p: Vec<f32>,
    x_old: Vec<f32>,
    p_idx: usize,
    // GCC-PHAT
    gcc_sr: Vec<f32>,
    gcc_si: Vec<f32>,
    mic_ring: Vec<f32>,
    ref_ring: Vec<f32>,
    n_seen: i64,
    gcc_maxrms: f32,
    gcc_conf: f32,
    cur_shift: usize,
    gcc_locked: bool,
    ref_dline: Vec<f32>,
    ref_dpos: usize,
}

impl Daf {
    pub(crate) fn new(weights: ControllerWeights) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let fft = RealFft::new(&mut planner, NFFT);
        let gcc_fft = RealFft::new(&mut planner, G_NFFT);
        let gb = G_NFFT / 2 + 1;
        let mut daf = Self {
            controller: Controller::new(weights, NB, N),
            fft,
            gcc_fft,
            scratch: Scratch {
                xn: vec![0.0; NFFT],
                x_re: vec![0.0; NB],
                x_im: vec![0.0; NB],
                y_re: vec![0.0; NB],
                y_im: vec![0.0; NB],
                e_re: vec![0.0; NB],
                e_im: vec![0.0; NB],
                e2_re: vec![0.0; NB],
                e2_im: vec![0.0; NB],
                d_re: vec![0.0; NB],
                d_im: vec![0.0; NB],
                x2: vec![0.0; NB],
                mean_p: vec![0.0; NB],
                buf: vec![0.0; NFFT],
                mu: vec![0.0; N * NB],
                g_pad: vec![0.0; G_NFFT],
                g_xr: vec![0.0; gb],
                g_xi: vec![0.0; gb],
                g_dr: vec![0.0; gb],
                g_di: vec![0.0; gb],
                g_c: vec![0.0; G_NFFT],
            },
            enable_prealign: true,
            h_re: Vec::new(),
            h_im: Vec::new(),
            x_re: Vec::new(),
            x_im: Vec::new(),
            p: Vec::new(),
            x_old: Vec::new(),
            p_idx: 0,
            gcc_sr: Vec::new(),
            gcc_si: Vec::new(),
            mic_ring: Vec::new(),
            ref_ring: Vec::new(),
            n_seen: 0,
            gcc_maxrms: 1e-12,
            gcc_conf: 0.0,
            cur_shift: 0,
            gcc_locked: false,
            ref_dline: Vec::new(),
            ref_dpos: 0,
        };
        daf.reset();
        daf
    }

    /// Remise à zéro complète (nouveau flux).
    pub(crate) fn reset(&mut self) {
        self.h_re = vec![0.0; N * NB];
        self.h_im = vec![0.0; N * NB];
        self.p = vec![P_INIT; N * NB];
        self.p_idx = 0;
        self.controller.reset();
        self.gcc_sr = vec![0.0; G_NFFT / 2 + 1];
        self.gcc_si = vec![0.0; G_NFFT / 2 + 1];
        self.mic_ring = vec![0.0; G_WIN];
        self.n_seen = 0;
        self.gcc_maxrms = 1e-12;
        self.gcc_conf = 0.0;
        self.cur_shift = 0;
        self.gcc_locked = false;
        self.clear_signal_history();
    }

    /// Oublie les signaux passés mais garde ce qui a été appris du trajet d'écho : filtre, covariance,
    /// états du contrôleur et retard GCC. Sert à la reprise après une veille (référence silencieuse
    /// depuis plus que la traîne) : l'historique réel serait alors quasi nul de toute façon.
    pub(crate) fn clear_signal_history(&mut self) {
        self.x_re = vec![0.0; N * NB];
        self.x_im = vec![0.0; N * NB];
        self.x_old = vec![0.0; M];
        self.ref_ring = vec![0.0; G_WIN];
        self.ref_dline = vec![0.0; DELAY_LINE];
        self.ref_dpos = 0;
        if !self.gcc_locked {
            // Le cumul GCC reste valable ; seule la fenêtre micro repart de zéro, comme la référence.
            self.mic_ring = vec![0.0; G_WIN];
        }
    }

    /// Retard appliqué à la référence par le préalignement, en échantillons.
    pub(crate) fn current_shift(&self) -> usize {
        self.cur_shift
    }

    pub(crate) fn is_delay_locked(&self) -> bool {
        self.gcc_locked
    }

    /// Traite `mic.len()` échantillons (multiple de [`M`]) : `e_out` reçoit le micro sans l'écho
    /// linéaire, `yhat_out` l'écho estimé.
    pub(crate) fn process(
        &mut self,
        mic: &[f32],
        reference: &[f32],
        e_out: &mut [f32],
        yhat_out: &mut [f32],
    ) {
        let hop = mic.len() / M * M;
        let mut xs = [0.0f32; M];
        for o in (0..hop).step_by(M) {
            self.mic_ring.copy_within(M.., 0);
            self.mic_ring[G_WIN - M..].copy_from_slice(&mic[o..o + M]);
            self.ref_ring.copy_within(M.., 0);
            self.ref_ring[G_WIN - M..].copy_from_slice(&reference[o..o + M]);
            for i in 0..M {
                self.ref_dline[(self.ref_dpos + i) % DELAY_LINE] = reference[o + i];
            }
            self.n_seen += M as i64;
            let w = G_WIN as i64;
            if self.enable_prealign && self.n_seen >= w && (self.n_seen - w) % G_HOP < M as i64 {
                self.gcc_update();
            }
            for (i, x) in xs.iter_mut().enumerate() {
                *x = if self.n_seen - M as i64 + i as i64 >= self.cur_shift as i64 {
                    let idx = (self.ref_dpos + i + DELAY_LINE - self.cur_shift) % DELAY_LINE;
                    self.ref_dline[idx]
                } else {
                    0.0
                };
            }
            self.ref_dpos = (self.ref_dpos + M) % DELAY_LINE;
            self.block(&mic[o..o + M], &xs, &mut e_out[o..o + M]);
        }
        for i in 0..hop {
            yhat_out[i] = mic[i] - e_out[i];
        }
    }

    fn gcc_update(&mut self) {
        if self.gcc_locked {
            return;
        }
        let s = &mut self.scratch;
        let mut rms = 0.0f32;
        for &v in &self.ref_ring {
            rms += v * v;
        }
        rms = (rms / G_WIN as f32).sqrt();
        self.gcc_maxrms = self.gcc_maxrms.max(rms);
        let keep = rms > self.gcc_maxrms * 10.0f32.powf(-G_GATE_DB / 20.0);
        if keep {
            s.g_pad[..G_WIN].copy_from_slice(&self.ref_ring);
            s.g_pad[G_WIN..].fill(0.0);
            self.gcc_fft.rfft(&s.g_pad, &mut s.g_xr, &mut s.g_xi);
            s.g_pad[..G_WIN].copy_from_slice(&self.mic_ring);
            self.gcc_fft.rfft(&s.g_pad, &mut s.g_dr, &mut s.g_di);
            for k in 0..=G_NFFT / 2 {
                let sr = s.g_dr[k] * s.g_xr[k] + s.g_di[k] * s.g_xi[k];
                let si = s.g_di[k] * s.g_xr[k] - s.g_dr[k] * s.g_xi[k];
                let mag = (sr * sr + si * si).sqrt() + 1e-9;
                self.gcc_sr[k] += sr / mag;
                self.gcc_si[k] += si / mag;
            }
        }
        self.gcc_fft.irfft(&self.gcc_sr, &self.gcc_si, &mut s.g_c);
        let (mut best, mut peak, mut asum) = (0usize, s.g_c[0], 0.0f32);
        for (l, &c) in s.g_c[..G_MAXLAG].iter().enumerate() {
            if c > peak {
                peak = c;
                best = l;
            }
            asum += c.abs();
        }
        let conf = peak / (asum / G_MAXLAG as f32 + 1e-12);
        self.gcc_conf = conf;
        self.cur_shift = if conf > G_CONF_THR {
            best.saturating_sub(M) / M * M
        } else {
            0
        };
        if conf > G_CONF_THR && self.n_seen >= LOCK_AFTER {
            self.gcc_locked = true;
        }
    }

    /// Prédiction de l'écho `Y = Σ_p H_p · X_p`, dans l'ordre d'accumulation du C++.
    fn predict(&self, y_re: &mut [f32], y_im: &mut [f32]) {
        y_re.fill(0.0);
        y_im.fill(0.0);
        for p in 0..N {
            let base = p * NB;
            let (hr, hi) = (&self.h_re[base..base + NB], &self.h_im[base..base + NB]);
            let (xr, xi) = (&self.x_re[base..base + NB], &self.x_im[base..base + NB]);
            for k in 0..NB {
                y_re[k] += hr[k] * xr[k] - hi[k] * xi[k];
                y_im[k] += hr[k] * xi[k] + hi[k] * xr[k];
            }
        }
    }

    fn block(&mut self, d_cur: &[f32], x_cur: &[f32], e_out: &mut [f32]) {
        let mut s = std::mem::replace(&mut self.scratch, empty_scratch());

        // Analyse de la référence et insertion dans l'anneau (partition 0 = la plus récente).
        s.xn[..M].copy_from_slice(&self.x_old);
        s.xn[M..].copy_from_slice(x_cur);
        self.x_old.copy_from_slice(x_cur);
        self.fft.rfft(&s.xn, &mut s.x_re, &mut s.x_im);
        self.x_re.copy_within(..(N - 1) * NB, NB);
        self.x_im.copy_within(..(N - 1) * NB, NB);
        self.x_re[..NB].copy_from_slice(&s.x_re);
        self.x_im[..NB].copy_from_slice(&s.x_im);

        // Écho estimé et erreur.
        self.predict(&mut s.y_re, &mut s.y_im);
        self.fft.irfft(&s.y_re, &s.y_im, &mut s.buf);
        for i in 0..M {
            e_out[i] = d_cur[i] - s.buf[M + i];
        }

        // Spectres de e et d (première moitié à zéro).
        s.xn[..M].fill(0.0);
        s.xn[M..].copy_from_slice(e_out);
        self.fft.rfft(&s.xn, &mut s.e_re, &mut s.e_im);
        s.xn[M..].copy_from_slice(d_cur);
        self.fft.rfft(&s.xn, &mut s.d_re, &mut s.d_im);

        s.x2.fill(0.0);
        s.mean_p.fill(0.0);
        for p in 0..N {
            let base = p * NB;
            for k in 0..NB {
                let (xr, xi) = (self.x_re[base + k], self.x_im[base + k]);
                s.x2[k] += xr * xr + xi * xi;
                s.mean_p[k] += self.p[base + k];
            }
        }
        for v in s.mean_p.iter_mut() {
            *v /= N as f32;
        }

        // Contrôleur : pas par bin (gbin) et par partition (spart).
        let (gbin, spart) = self.controller.step(
            &s.x_re, &s.x_im, &s.x2, &s.d_re, &s.d_im, &s.e_re, &s.e_im, &s.y_re, &s.y_im,
            &s.mean_p, &self.h_re, &self.h_im, &self.p,
        );

        // Mise à jour de Kalman.
        let a2 = A_DECAY * A_DECAY;
        for p in 0..N {
            let base = p * NB;
            for k in 0..NB {
                let i = base + k;
                let rt = (s.e_re[k] * s.e_re[k] + s.e_im[k] * s.e_im[k]) / N as f32;
                let pe = 0.5 * self.p[i] * s.x2[k] + rt;
                let mut m = self.p[i] / (pe + 1e-10);
                m *= gbin[k] * spart[p];
                let step = m * s.x2[k];
                if step > 2.0 {
                    m *= 2.0 / step;
                }
                let fac = (1.0 - 0.5 * m * s.x2[k]).max(0.0);
                let h2 = self.h_re[i] * self.h_re[i] + self.h_im[i] * self.h_im[i];
                self.p[i] = (a2 * fac * self.p[i] + (1.0 - a2) * h2).max(1e-12);
                s.mu[i] = m;
            }
        }

        // H += μ · E · conj(X), puis K_ITER − 1 répétitions avec l'erreur recalculée.
        for it in 0..K_ITER {
            if it > 0 {
                self.predict(&mut s.y_re, &mut s.y_im);
                self.fft.irfft(&s.y_re, &s.y_im, &mut s.buf);
                s.xn[..M].fill(0.0);
                for i in 0..M {
                    s.xn[M + i] = d_cur[i] - s.buf[M + i];
                }
                self.fft.rfft(&s.xn, &mut s.e2_re, &mut s.e2_im);
            }
            let (er, ei) = if it > 0 {
                (&s.e2_re, &s.e2_im)
            } else {
                (&s.e_re, &s.e_im)
            };
            for p in 0..N {
                let base = p * NB;
                for k in 0..NB {
                    let i = base + k;
                    let (xr, xi, m) = (self.x_re[i], self.x_im[i], s.mu[i]);
                    self.h_re[i] += m * (er[k] * xr + ei[k] * xi);
                    self.h_im[i] += m * (ei[k] * xr - er[k] * xi);
                }
            }
        }

        // Contrainte de recouvrement-sauvegarde, une partition par bloc à tour de rôle.
        let base = self.p_idx * NB;
        self.fft.irfft(
            &self.h_re[base..base + NB],
            &self.h_im[base..base + NB],
            &mut s.buf,
        );
        s.buf[M..].fill(0.0);
        self.fft.rfft(&s.buf, &mut s.e2_re, &mut s.e2_im);
        self.h_re[base..base + NB].copy_from_slice(&s.e2_re);
        self.h_im[base..base + NB].copy_from_slice(&s.e2_im);
        self.p_idx = (self.p_idx + 1) % N;

        self.scratch = s;
    }
}

fn empty_scratch() -> Scratch {
    Scratch {
        xn: Vec::new(),
        x_re: Vec::new(),
        x_im: Vec::new(),
        y_re: Vec::new(),
        y_im: Vec::new(),
        e_re: Vec::new(),
        e_im: Vec::new(),
        e2_re: Vec::new(),
        e2_im: Vec::new(),
        d_re: Vec::new(),
        d_im: Vec::new(),
        x2: Vec::new(),
        mean_p: Vec::new(),
        buf: Vec::new(),
        mu: Vec::new(),
        g_pad: Vec::new(),
        g_xr: Vec::new(),
        g_xi: Vec::new(),
        g_dr: Vec::new(),
        g_di: Vec::new(),
        g_c: Vec::new(),
    }
}
