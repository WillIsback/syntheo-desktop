//! Contrôleur appris du frontal (variante « v2xp », 2 742 poids) : trois GRU qui fixent le pas
//! de la mise à jour de Kalman, par bin de fréquence (`gbin`) et par partition (`spart`).
//! Portage de la section « controller features » de `ggml/daf_frontend.cpp` (LocalVQE, Apache-2.0).

// Boucles indicées comme dans le C++, pour la relecture côte à côte avec la référence.
#![allow(clippy::needless_range_loop)]

use super::weights::{ControllerWeights, GruWeights};

const CE: f32 = 1e-9;

#[inline]
fn log10e(x: f32) -> f32 {
    (x + 1e-10).log10()
}

#[inline]
fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// `torch.nn.GRUCell` : `h' = (1 − z)·n + z·h`.
fn gru_cell(x: &[f32], h: &mut [f32], w: &GruWeights, gi: &mut [f32], gh: &mut [f32]) {
    let (nin, nh) = (w.n_in, w.n_hidden);
    for g in 0..3 * nh {
        let mut s = w.b_ih[g];
        let row = &w.w_ih[g * nin..(g + 1) * nin];
        for i in 0..nin {
            s += row[i] * x[i];
        }
        gi[g] = s;
        let mut t = w.b_hh[g];
        let row = &w.w_hh[g * nh..(g + 1) * nh];
        for i in 0..nh {
            t += row[i] * h[i];
        }
        gh[g] = t;
    }
    for i in 0..nh {
        let r = sigmoid(gi[i] + gh[i]);
        let z = sigmoid(gi[nh + i] + gh[nh + i]);
        let n = (gi[2 * nh + i] + r * gh[2 * nh + i]).tanh();
        h[i] = (1.0 - z) * n + z * h[i];
    }
}

/// LayerNorm sur les 6 premières caractéristiques ; les cosinus passent tels quels.
fn cos_ln(input: &[f32], out: &mut [f32], w: &[f32], b: &[f32]) {
    let mut mean = 0.0f32;
    for &v in &input[..6] {
        mean += v;
    }
    mean /= 6.0;
    let mut var = 0.0f32;
    for &v in &input[..6] {
        let d = v - mean;
        var += d * d;
    }
    var /= 6.0;
    let inv = 1.0 / (var + 1e-5).sqrt();
    for i in 0..6 {
        out[i] = (input[i] - mean) * inv * w[i] + b[i];
    }
    out[6..input.len()].copy_from_slice(&input[6..]);
}

pub(crate) struct Controller {
    w: ControllerWeights,
    nb: usize,
    n_part: usize,
    hg: Vec<f32>,
    hb: Vec<f32>,
    hp: Vec<f32>,
    fbins: Vec<f32>,
    gbin: Vec<f32>,
    spart: Vec<f32>,
    gi: Vec<f32>,
    gh: Vec<f32>,
}

impl Controller {
    pub(crate) fn new(w: ControllerWeights, nb: usize, n_part: usize) -> Self {
        Self {
            w,
            nb,
            n_part,
            hg: vec![0.0; 8],
            hb: vec![0.0; nb * 16],
            hp: vec![0.0; n_part * 8],
            fbins: vec![0.0; nb * 10],
            gbin: vec![0.0; nb],
            spart: vec![0.0; n_part],
            gi: vec![0.0; 48],
            gh: vec![0.0; 48],
        }
    }

    pub(crate) fn reset(&mut self) {
        self.hg.fill(0.0);
        self.hb.fill(0.0);
        self.hp.fill(0.0);
    }

    /// Un pas du contrôleur. `x` : spectre du bloc de référence courant ; `x2` : énergie de
    /// référence cumulée sur les partitions ; `d`, `e`, `y` : micro, erreur, écho estimé ;
    /// `h`, `p` : filtre et covariance, (N, NB). Renvoie `(gbin, spart)`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn step(
        &mut self,
        x_re: &[f32],
        x_im: &[f32],
        x2: &[f32],
        d_re: &[f32],
        d_im: &[f32],
        e_re: &[f32],
        e_im: &[f32],
        y_re: &[f32],
        y_im: &[f32],
        mean_p: &[f32],
        h_re: &[f32],
        h_im: &[f32],
        p: &[f32],
    ) -> (&[f32], &[f32]) {
        let nb = self.nb;
        for k in 0..nb {
            let xa = (x_re[k] * x_re[k] + x_im[k] * x_im[k]).sqrt();
            let ea = (e_re[k] * e_re[k] + e_im[k] * e_im[k]).sqrt();
            let ya = (y_re[k] * y_re[k] + y_im[k] * y_im[k]).sqrt();
            let da = (d_re[k] * d_re[k] + d_im[k] * d_im[k]).sqrt();
            let f = &mut self.fbins[k * 10..k * 10 + 10];
            f[0] = log10e(xa * xa);
            f[1] = log10e(x2[k]);
            f[2] = log10e(da * da);
            f[3] = log10e(ea * ea);
            f[4] = log10e(ya * ya);
            f[5] = log10e(mean_p[k]);
            f[6] = (e_re[k] * d_re[k] + e_im[k] * d_im[k]) / (ea * da + CE);
            f[7] = (d_re[k] * y_re[k] + d_im[k] * y_im[k]) / (da * ya + CE);
            f[8] = (e_re[k] * y_re[k] + e_im[k] * y_im[k]) / (ea * ya + CE);
            f[9] = (x_re[k] * d_re[k] + x_im[k] * d_im[k]) / (xa * da + CE);
        }

        // Branche globale : moyenne sur les bins -> LN6 -> GRU(10 -> 8).
        let mut fg = [0.0f32; 10];
        for k in 0..nb {
            for j in 0..10 {
                fg[j] += self.fbins[k * 10 + j];
            }
        }
        for v in fg.iter_mut() {
            *v /= nb as f32;
        }
        let mut fb = [0.0f32; 10];
        cos_ln(&fg, &mut fb, &self.w.glob_ln_w, &self.w.glob_ln_b);
        gru_cell(&fb, &mut self.hg, &self.w.glob, &mut self.gi, &mut self.gh);

        // Par bin : [LN6(f) | cos | contexte 8] -> GRU(18 -> 16) -> g = 2σ(tête).
        let mut fbn = [0.0f32; 18];
        for k in 0..nb {
            cos_ln(
                &self.fbins[k * 10..k * 10 + 10],
                &mut fbn[..10],
                &self.w.bins_ln_w,
                &self.w.bins_ln_b,
            );
            fbn[10..].copy_from_slice(&self.hg);
            let hb = &mut self.hb[k * 16..k * 16 + 16];
            gru_cell(&fbn, hb, &self.w.bins, &mut self.gi, &mut self.gh);
            let mut z = self.w.head_b;
            for i in 0..16 {
                z += self.w.head_w[i] * hb[i];
            }
            self.gbin[k] = 2.0 / (1.0 + (-z).exp());
        }

        // Par partition : [LN2(log|H|², log P) | contexte 8] -> GRU(10 -> 8) -> s = 2σ.
        for part in 0..self.n_part {
            let base = part * nb;
            let (mut h2, mut pm) = (0.0f32, 0.0f32);
            for k in 0..nb {
                h2 += h_re[base + k] * h_re[base + k] + h_im[base + k] * h_im[base + k];
                pm += p[base + k];
            }
            let f2 = [log10e(h2 / nb as f32), log10e(pm / nb as f32)];
            let mean = 0.5 * (f2[0] + f2[1]);
            let var = 0.5 * ((f2[0] - mean) * (f2[0] - mean) + (f2[1] - mean) * (f2[1] - mean));
            let inv = 1.0 / (var + 1e-5).sqrt();
            let mut in10 = [0.0f32; 10];
            in10[0] = (f2[0] - mean) * inv * self.w.part_ln_w[0] + self.w.part_ln_b[0];
            in10[1] = (f2[1] - mean) * inv * self.w.part_ln_w[1] + self.w.part_ln_b[1];
            in10[2..].copy_from_slice(&self.hg);
            let hp = &mut self.hp[part * 8..part * 8 + 8];
            gru_cell(&in10, hp, &self.w.part, &mut self.gi, &mut self.gh);
            let mut z = self.w.part_head_b;
            for i in 0..8 {
                z += self.w.part_head_w[i] * hp[i];
            }
            self.spart[part] = 2.0 / (1.0 + (-z).exp());
        }

        (&self.gbin, &self.spart)
    }
}
