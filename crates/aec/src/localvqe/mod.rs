//! Annulation d'écho LocalVQE v1.4-AEC (#293), en remplacement candidat de DTLN-aec.
//!
//! Chaîne, par pas de 256 échantillons (16 ms à 16 kHz) :
//! 1. frontal adaptatif ([`daf`]) : préalignement GCC-PHAT de la référence, puis filtre de Kalman
//!    partitionné (1,024 s d'écho) piloté par un contrôleur appris ; sorties `e = micro − ŷ` et `ŷ` ;
//! 2. analyse STFT racine-Hann 512/256 de `e` et `ŷ` ([`codec`]) ;
//! 3. masque neuronal résiduel en ONNX ([`mask`]), qui aligne lui-même `ŷ` sur `e` (attention
//!    sur 256 ms) et retire l'écho non linéaire ou réverbéré que le filtre laisse ;
//! 4. synthèse et recouvrement-addition : 256 échantillons de latence algorithmique.
//!
//! La variante [`LocalVqeVariant::Frontend2_7K`] s'arrête après l'étape 1 (le GGUF officiel
//! « 2.7K » contient exactement ces poids) : pas de latence algorithmique, pas d'ONNX.
//!
//! Les entrées peuvent avoir n'importe quelle longueur : une file interne regroupe les
//! échantillons par pas, et la sortie est retardée d'un pas en plus pour toujours rendre autant
//! d'échantillons qu'il en entre (voir [`LocalVqe::latency_samples`]).

mod codec;
mod controller;
mod daf;
mod mask;
mod weights;

use std::collections::VecDeque;

pub const SAMPLE_RATE: u32 = 16_000;
pub(crate) const FFT_SIZE: usize = 512;
pub(crate) const HOP_SIZE: usize = 256;
pub(crate) const N_BINS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalVqeVariant {
    /// Frontal adaptatif + masque neuronal (203 K paramètres).
    Aec200K,
    /// Frontal adaptatif seul (2 742 paramètres).
    Frontend2_7K,
}

pub struct LocalVqe {
    variant: LocalVqeVariant,
    daf: daf::Daf,
    mask: Option<mask::ResidualMask>,
    codec: codec::Codec,
    step: usize,
    pending_mic: Vec<f32>,
    pending_reference: Vec<f32>,
    output: VecDeque<f32>,
    // Une trame du pas courant.
    residual: Vec<f32>,
    echo: Vec<f32>,
    previous_residual: Vec<f32>,
    previous_echo: Vec<f32>,
    residual_spectrum: Vec<f32>,
    echo_spectrum: Vec<f32>,
    enhanced_spectrum: Vec<f32>,
    frame: Vec<f32>,
    ola: Vec<f32>,
}

impl LocalVqe {
    /// LocalVQE v1.4-AEC 200K : frontal + masque.
    pub fn new() -> Result<Self, crate::Error> {
        Self::with_variant(LocalVqeVariant::Aec200K)
    }

    /// LocalVQE v1.4-AEC 2.7K : frontal adaptatif seul.
    pub fn frontend_only() -> Result<Self, crate::Error> {
        Self::with_variant(LocalVqeVariant::Frontend2_7K)
    }

    pub fn with_variant(variant: LocalVqeVariant) -> Result<Self, crate::Error> {
        let config = weights::FrontendConfig::parse(weights::FRONTEND_JSON)?;
        let mask = match variant {
            LocalVqeVariant::Aec200K => Some(mask::ResidualMask::new()?),
            LocalVqeVariant::Frontend2_7K => None,
        };
        // Le frontal travaille par blocs de 128 : sans masque, inutile d'attendre un pas de 256.
        let step = if mask.is_some() { HOP_SIZE } else { daf::M };
        let mut this = Self {
            variant,
            daf: daf::Daf::new(config.controller),
            mask,
            codec: codec::Codec::new(config.analysis_window),
            step,
            pending_mic: Vec::with_capacity(4 * HOP_SIZE),
            pending_reference: Vec::with_capacity(4 * HOP_SIZE),
            output: VecDeque::with_capacity(8 * HOP_SIZE),
            residual: vec![0.0; step],
            echo: vec![0.0; step],
            previous_residual: vec![0.0; HOP_SIZE],
            previous_echo: vec![0.0; HOP_SIZE],
            residual_spectrum: vec![0.0; 2 * N_BINS],
            echo_spectrum: vec![0.0; 2 * N_BINS],
            enhanced_spectrum: vec![0.0; 2 * N_BINS],
            frame: vec![0.0; FFT_SIZE],
            ola: vec![0.0; FFT_SIZE],
        };
        this.reset();
        Ok(this)
    }

    pub fn variant(&self) -> LocalVqeVariant {
        self.variant
    }

    /// Pas de traitement interne, en échantillons.
    pub fn hop_samples(&self) -> usize {
        self.step
    }

    /// Retard de la sortie sur l'entrée : un pas de file d'attente, plus un pas de recouvrement-
    /// addition pour le masque. 512 échantillons (32 ms) en 200K, 128 (8 ms) en 2.7K.
    pub fn latency_samples(&self) -> usize {
        self.step + if self.mask.is_some() { HOP_SIZE } else { 0 }
    }

    /// Active ou coupe le préalignement GCC-PHAT de la référence (actif par défaut).
    pub fn set_prealign(&mut self, enabled: bool) {
        self.daf.enable_prealign = enabled;
    }

    /// Retard de référence appliqué par le préalignement, en échantillons, et s'il est figé.
    pub fn reference_delay(&self) -> (usize, bool) {
        (self.daf.current_shift(), self.daf.is_delay_locked())
    }

    /// Remise à zéro complète : filtre, retard estimé, états du masque, files.
    pub fn reset(&mut self) {
        self.daf.reset();
        self.clear_streams();
    }

    /// Reprise après une veille : oublie les signaux mais garde le trajet d'écho appris par le
    /// filtre (et le retard estimé), qu'une pause du son de l'ordinateur ne change pas. Le filtre
    /// n'a pas à reconverger (1 à 3 s) à chaque reprise.
    pub fn resume(&mut self) {
        self.daf.clear_signal_history();
        self.clear_streams();
    }

    fn clear_streams(&mut self) {
        if let Some(mask) = self.mask.as_mut() {
            mask.reset();
        }
        self.pending_mic.clear();
        self.pending_reference.clear();
        self.output.clear();
        self.output.extend(std::iter::repeat_n(0.0, self.step));
        self.previous_residual.fill(0.0);
        self.previous_echo.fill(0.0);
        self.ola.fill(0.0);
    }

    /// Traite un morceau de flux ; renvoie autant d'échantillons que `min(mic, reference)`.
    pub fn process_streaming(
        &mut self,
        mic: &[f32],
        reference: &[f32],
    ) -> Result<Vec<f32>, crate::Error> {
        let len = mic.len().min(reference.len());
        self.pending_mic.extend_from_slice(&mic[..len]);
        self.pending_reference.extend_from_slice(&reference[..len]);
        let step = self.step;
        let ready = self.pending_mic.len() / step * step;
        for start in (0..ready).step_by(step) {
            self.process_step(start)?;
        }
        self.pending_mic.drain(..ready);
        self.pending_reference.drain(..ready);
        Ok(self.output.drain(..len.min(self.output.len())).collect())
    }

    fn process_step(&mut self, start: usize) -> Result<(), crate::Error> {
        let step = self.step;
        let mic = &self.pending_mic[start..start + step];
        let reference = &self.pending_reference[start..start + step];
        self.daf
            .process(mic, reference, &mut self.residual, &mut self.echo);

        let Some(mask) = self.mask.as_mut() else {
            self.output.extend(self.residual.iter().copied());
            return Ok(());
        };

        self.codec.analysis(
            &self.previous_residual,
            &self.residual,
            &mut self.residual_spectrum,
        );
        self.codec
            .analysis(&self.previous_echo, &self.echo, &mut self.echo_spectrum);
        self.previous_residual.copy_from_slice(&self.residual);
        self.previous_echo.copy_from_slice(&self.echo);

        mask.run(
            &self.residual_spectrum,
            &self.echo_spectrum,
            &mut self.enhanced_spectrum,
        )?;
        self.codec
            .synthesis(&self.enhanced_spectrum, &mut self.frame);
        for (acc, &sample) in self.ola.iter_mut().zip(self.frame.iter()) {
            *acc += sample;
        }
        self.output.extend(self.ola[..HOP_SIZE].iter().copied());
        self.ola.copy_within(HOP_SIZE.., 0);
        self.ola[FFT_SIZE - HOP_SIZE..].fill(0.0);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
