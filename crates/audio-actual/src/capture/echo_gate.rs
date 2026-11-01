//! Mise en veille de l'annulation d'écho quand le son de l'ordinateur est silencieux (#291).
//!
//! Sans référence, il n'y a pas d'écho à retirer : le modèle n'est pas appelé et le micro passe
//! tel quel. La décision « référence active ou non » ([`ReferenceActivityDetector`]) et
//! l'orchestration des transitions ([`GatedEchoCanceller`]) ne dépendent pas du modèle : tout
//! modèle qui implémente [`EchoCanceller`] (DTLN-aec aujourd'hui, LocalVQE ensuite) en profite.

use std::collections::VecDeque;

/// Seuil de silence de la référence : −60 dBFS en RMS.
///
/// Le couplage acoustique haut-parleur → micro d'un portable est au mieux voisin de 0 dB (souvent
/// −10 à −20 dB) : une référence à −60 dBFS produit un écho sous −60 dBFS, noyé dans le bruit de
/// fond d'un micro intégré (typiquement −60 à −50 dBFS). Le silence numérique d'une capture
/// système (zéros, ou dither vers −90 dBFS) reste, lui, très en dessous.
pub(crate) const REFERENCE_SILENCE_RMS: f32 = 1e-3;

/// Traîne : durée pendant laquelle le modèle reste actif après le dernier son de la référence.
///
/// L'écho persiste après la fin du son : réverbération de la pièce (RT60 de 0,3 à 0,6 s dans un
/// bureau ou un salon) et latence de l'alignement de la référence (environ 180 ms mesurés,
/// `speaker_delay_ms`, non compensée tant que l'aligneur n'est pas verrouillé). 500 ms couvrent
/// 180 ms de retard plus 300 ms de réverbération.
pub(crate) const REFERENCE_HANGOVER_MS: u32 = 500;

/// Fenêtre d'analyse de l'énergie : un son bref (clic, notification) dans une trame de 120 ms
/// suffit à réveiller le modèle, alors qu'un RMS sur toute la trame le diluerait.
const ACTIVITY_WINDOW_MS: u32 = 16;

/// Historique rejoué dans le modèle, sortie ignorée, quand il reprend après une veille : ses
/// tampons circulaires et ses états LSTM repartent de signaux réels et non de zéros.
const RESUME_PREROLL_MS: u32 = 128;

/// Durée du fondu enchaîné entre micro brut et sortie du modèle, dans les deux sens.
const CROSSFADE_MS: u32 = 10;

/// Modèle d'annulation d'écho en flux, à état.
pub(crate) trait EchoCanceller {
    type Error: std::fmt::Debug;

    fn process_streaming(
        &mut self,
        mic: &[f32],
        reference: &[f32],
    ) -> Result<Vec<f32>, Self::Error>;

    fn reset(&mut self);

    /// Remise en route après une veille (référence silencieuse au-delà de la traîne). Par défaut,
    /// remise à zéro complète ; un modèle adaptatif peut garder ce qu'il a appris du trajet
    /// d'écho, qu'une pause du son ne change pas.
    fn resume(&mut self) {
        self.reset();
    }

    /// Retard de la sortie sur l'entrée, en échantillons.
    fn latency_samples(&self) -> usize;

    /// Pas d'analyse : le modèle ne traite que des multiples de ce nombre d'échantillons.
    fn hop_samples(&self) -> usize;
}

impl EchoCanceller for syntheo_aec::AEC {
    type Error = syntheo_aec::Error;

    fn process_streaming(
        &mut self,
        mic: &[f32],
        reference: &[f32],
    ) -> Result<Vec<f32>, Self::Error> {
        syntheo_aec::AEC::process_streaming(self, mic, reference)
    }

    fn reset(&mut self) {
        syntheo_aec::AEC::reset(self);
    }

    /// Recouvrement-addition : un échantillon sort quand il quitte la fenêtre de `BLOCK_SIZE`.
    fn latency_samples(&self) -> usize {
        syntheo_aec::BLOCK_SIZE - syntheo_aec::BLOCK_SHIFT
    }

    fn hop_samples(&self) -> usize {
        syntheo_aec::BLOCK_SHIFT
    }
}

/// LocalVQE v1.4-AEC (#293), derrière la fonctionnalité `localvqe` ; DTLN reste le défaut.
#[cfg(feature = "localvqe")]
impl EchoCanceller for syntheo_aec::LocalVqe {
    type Error = syntheo_aec::Error;

    fn process_streaming(
        &mut self,
        mic: &[f32],
        reference: &[f32],
    ) -> Result<Vec<f32>, Self::Error> {
        syntheo_aec::LocalVqe::process_streaming(self, mic, reference)
    }

    fn reset(&mut self) {
        syntheo_aec::LocalVqe::reset(self);
    }

    /// Garde le filtre adaptatif et le retard estimé : sans cela, chaque reprise coûterait 1 à 3 s
    /// de reconvergence (mesuré par `localvqe_bench`, section « Reprise après veille »).
    fn resume(&mut self) {
        syntheo_aec::LocalVqe::resume(self);
    }

    /// File d'attente d'un pas plus recouvrement-addition : 512 échantillons en 200K.
    fn latency_samples(&self) -> usize {
        syntheo_aec::LocalVqe::latency_samples(self)
    }

    /// Accepte toute longueur (file interne) ; le pas sert à caler la reprise.
    fn hop_samples(&self) -> usize {
        syntheo_aec::LocalVqe::hop_samples(self)
    }
}

fn ms_to_samples(sample_rate: u32, ms: u32) -> usize {
    (sample_rate as usize * ms as usize) / 1000
}

/// Décide si la référence (le son de l'ordinateur) porte du signal, traîne comprise.
#[derive(Debug, Clone)]
pub(crate) struct ReferenceActivityDetector {
    threshold_rms: f32,
    window_samples: usize,
    hangover_samples: usize,
    samples_since_active: usize,
}

impl ReferenceActivityDetector {
    pub(crate) fn new(sample_rate: u32) -> Self {
        Self::with_params(
            REFERENCE_SILENCE_RMS,
            ms_to_samples(sample_rate, ACTIVITY_WINDOW_MS),
            ms_to_samples(sample_rate, REFERENCE_HANGOVER_MS),
        )
    }

    pub(crate) fn with_params(
        threshold_rms: f32,
        window_samples: usize,
        hangover_samples: usize,
    ) -> Self {
        Self {
            threshold_rms,
            window_samples: window_samples.max(1),
            hangover_samples,
            // Au démarrage, la référence est réputée silencieuse depuis longtemps.
            samples_since_active: hangover_samples,
        }
    }

    /// Observe une trame de référence alignée ; renvoie `true` si le modèle doit tourner.
    ///
    /// Le modèle reste actif tant que moins de `hangover_samples` échantillons silencieux ont
    /// suivi la dernière trame sonore.
    pub(crate) fn observe(&mut self, reference: &[f32]) -> bool {
        if self.has_signal(reference) {
            self.samples_since_active = 0;
            return true;
        }
        self.samples_since_active = self.samples_since_active.saturating_add(reference.len());
        self.samples_since_active < self.hangover_samples
    }

    fn has_signal(&self, reference: &[f32]) -> bool {
        let threshold_energy = self.threshold_rms * self.threshold_rms;
        reference.chunks(self.window_samples).any(|window| {
            let energy = window.iter().map(|sample| sample * sample).sum::<f32>();
            energy >= threshold_energy * window.len() as f32
        })
    }
}

/// Retard fixe, pour que le micro brut reste en phase avec la sortie retardée du modèle.
struct FixedDelay {
    line: VecDeque<f32>,
}

impl FixedDelay {
    fn new(delay_samples: usize) -> Self {
        Self {
            line: std::iter::repeat_n(0.0, delay_samples).collect(),
        }
    }

    fn process(&mut self, input: &[f32]) -> Vec<f32> {
        input
            .iter()
            .map(|&sample| {
                self.line.push_back(sample);
                self.line.pop_front().unwrap_or(0.0)
            })
            .collect()
    }
}

/// Fondu en cosinus surélevé de `from` vers `to` sur les `fade_len` premiers échantillons.
/// Les deux signaux sont corrélés (même micro), la somme des poids vaut donc 1.
fn crossfade(from: &[f32], to: &[f32], fade_len: usize) -> Vec<f32> {
    let len = from.len().min(to.len());
    let fade_len = fade_len.min(len);
    (0..len)
        .map(|idx| {
            if idx >= fade_len {
                return to[idx];
            }
            let phase = (idx as f32 + 0.5) / fade_len as f32;
            let weight = 0.5 - 0.5 * (std::f32::consts::PI * phase).cos();
            from[idx] + (to[idx] - from[idx]) * weight
        })
        .collect()
}

/// Annulation d'écho mise en veille quand la référence est silencieuse.
///
/// Transitions : le modèle est remis à zéro à chaque reprise puis réchauffé avec
/// `RESUME_PREROLL_MS` d'historique, et un fondu de `CROSSFADE_MS` relie micro brut et sortie du
/// modèle. Le micro brut est retardé de la latence du modèle : les deux voies restent en phase et
/// la chronologie de la sortie ne change pas par rapport à un modèle toujours actif.
pub(crate) struct GatedEchoCanceller<P> {
    processor: P,
    detector: ReferenceActivityDetector,
    dry_delay: FixedDelay,
    history_mic: VecDeque<f32>,
    history_reference: VecDeque<f32>,
    preroll_samples: usize,
    crossfade_samples: usize,
    running: bool,
}

impl<P: EchoCanceller> GatedEchoCanceller<P> {
    pub(crate) fn new(processor: P, sample_rate: u32) -> Self {
        Self::with_detector(
            processor,
            sample_rate,
            ReferenceActivityDetector::new(sample_rate),
        )
    }

    pub(crate) fn with_detector(
        processor: P,
        sample_rate: u32,
        detector: ReferenceActivityDetector,
    ) -> Self {
        let hop = processor.hop_samples().max(1);
        let preroll_samples = ms_to_samples(sample_rate, RESUME_PREROLL_MS) / hop * hop;
        Self {
            dry_delay: FixedDelay::new(processor.latency_samples()),
            processor,
            detector,
            history_mic: VecDeque::with_capacity(preroll_samples),
            history_reference: VecDeque::with_capacity(preroll_samples),
            preroll_samples,
            crossfade_samples: ms_to_samples(sample_rate, CROSSFADE_MS),
            running: false,
        }
    }

    /// Oublie l'état du modèle (changement d'alignement, panne d'un canal). La prochaine trame
    /// active repartira d'un modèle neuf, avec fondu depuis le micro brut.
    pub(crate) fn reset(&mut self) {
        self.processor.reset();
        self.history_mic.clear();
        self.history_reference.clear();
        self.running = false;
    }

    /// Traite une trame alignée. `post` s'applique à la sortie du modèle seulement (par exemple
    /// la soustraction de l'écho linéaire résiduel).
    pub(crate) fn process(
        &mut self,
        mic: &[f32],
        reference: &[f32],
        post: impl FnOnce(Vec<f32>) -> Vec<f32>,
    ) -> Result<Vec<f32>, P::Error> {
        let len = mic.len().min(reference.len());
        let (mic, reference) = (&mic[..len], &reference[..len]);
        let active = self.detector.observe(reference);
        let dry = self.dry_delay.process(mic);

        let output = match (self.running, active) {
            (false, false) => Ok(dry),
            (false, true) => self.resume(mic, reference).map(|wet| {
                self.running = true;
                crossfade(&dry, &post(wet), self.crossfade_samples)
            }),
            (true, true) => self.processor.process_streaming(mic, reference).map(post),
            (true, false) => {
                self.running = false;
                self.processor
                    .process_streaming(mic, reference)
                    .map(|wet| crossfade(&post(wet), &dry, self.crossfade_samples))
            }
        };
        if output.is_err() {
            // La reprise suivante repartira d'un modèle remis à zéro.
            self.running = false;
        }
        self.remember(mic, reference);
        output
    }

    fn resume(&mut self, mic: &[f32], reference: &[f32]) -> Result<Vec<f32>, P::Error> {
        self.processor.resume();
        let hop = self.processor.hop_samples().max(1);
        let usable = self.history_mic.len() / hop * hop;
        if usable > 0 {
            let skip = self.history_mic.len() - usable;
            let mic_history: Vec<f32> = self.history_mic.iter().skip(skip).copied().collect();
            let reference_history: Vec<f32> =
                self.history_reference.iter().skip(skip).copied().collect();
            self.processor
                .process_streaming(&mic_history, &reference_history)?;
        }
        self.processor.process_streaming(mic, reference)
    }

    fn remember(&mut self, mic: &[f32], reference: &[f32]) {
        if self.preroll_samples == 0 {
            return;
        }
        let keep = |history: &mut VecDeque<f32>, input: &[f32], cap: usize| {
            let input = &input[input.len().saturating_sub(cap)..];
            let overflow = (history.len() + input.len()).saturating_sub(cap);
            history.drain(..overflow);
            history.extend(input);
        };
        keep(&mut self.history_mic, mic, self.preroll_samples);
        keep(&mut self.history_reference, reference, self.preroll_samples);
    }
}

#[cfg(test)]
#[path = "echo_gate_tests.rs"]
pub(crate) mod tests;
