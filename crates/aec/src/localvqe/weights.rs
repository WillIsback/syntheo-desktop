//! Poids du contrôleur du frontal (2 742 valeurs) et fenêtre d'analyse, lus depuis
//! `LocalVQEAECFrontend.json` (export soniqo, identique aux tenseurs `daf.*` des GGUF officiels
//! 200K et 2.7K : vérifié valeur par valeur, voir `crates/aec/data/models/LOCALVQE_NOTICE.md`).

use serde_json::Value;

use super::{FFT_SIZE, HOP_SIZE, SAMPLE_RATE};

pub(crate) const FRONTEND_JSON: &str = include_str!("../../data/models/LocalVQEAECFrontend.json");

/// GRU au sens de `torch.nn.GRUCell` : portes `[r, z, n]`, poids en ligne majeure.
pub(crate) struct GruWeights {
    pub(crate) n_in: usize,
    pub(crate) n_hidden: usize,
    pub(crate) w_ih: Vec<f32>,
    pub(crate) w_hh: Vec<f32>,
    pub(crate) b_ih: Vec<f32>,
    pub(crate) b_hh: Vec<f32>,
}

pub(crate) struct ControllerWeights {
    pub(crate) glob_ln_w: Vec<f32>,
    pub(crate) glob_ln_b: Vec<f32>,
    pub(crate) glob: GruWeights,
    pub(crate) bins_ln_w: Vec<f32>,
    pub(crate) bins_ln_b: Vec<f32>,
    pub(crate) bins: GruWeights,
    pub(crate) part_ln_w: Vec<f32>,
    pub(crate) part_ln_b: Vec<f32>,
    pub(crate) part: GruWeights,
    pub(crate) head_w: Vec<f32>,
    pub(crate) head_b: f32,
    pub(crate) part_head_w: Vec<f32>,
    pub(crate) part_head_b: f32,
}

pub(crate) struct FrontendConfig {
    pub(crate) controller: ControllerWeights,
    pub(crate) analysis_window: Vec<f32>,
}

fn invalid(message: impl Into<String>) -> crate::Error {
    crate::Error::LocalVqeWeights(message.into())
}

fn floats(value: &Value, key: &str) -> Result<Vec<f32>, crate::Error> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("champ {key} absent")))?
        .iter()
        .map(|v| {
            v.as_f64()
                .map(|f| f as f32)
                .ok_or_else(|| invalid(format!("{key} : valeur non numérique")))
        })
        .collect()
}

fn expect_u64(value: &Value, key: &str, expected: u64) -> Result<(), crate::Error> {
    match value.get(key).and_then(Value::as_u64) {
        Some(found) if found == expected => Ok(()),
        found => Err(invalid(format!("{key} = {found:?}, attendu {expected}"))),
    }
}

impl FrontendConfig {
    pub(crate) fn parse(json: &str) -> Result<Self, crate::Error> {
        let root: Value = serde_json::from_str(json).map_err(|e| invalid(e.to_string()))?;
        expect_u64(&root, "format_version", 1)?;
        expect_u64(&root, "sample_rate", SAMPLE_RATE as u64)?;
        expect_u64(&root, "fft_size", FFT_SIZE as u64)?;
        expect_u64(&root, "hop_size", HOP_SIZE as u64)?;
        expect_u64(&root, "daf_block_size", super::daf::M as u64)?;
        expect_u64(&root, "daf_partitions", super::daf::N as u64)?;
        expect_u64(&root, "daf_iterations", super::daf::K_ITER as u64)?;

        let flat = floats(&root, "controller_weights")?;
        let layout = root
            .get("controller_layout")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("controller_layout absent"))?;
        let mut tensors = std::collections::HashMap::new();
        let mut offset = 0usize;
        for item in layout {
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("controller_layout : nom absent"))?;
            let count = item
                .get("count")
                .and_then(Value::as_u64)
                .ok_or_else(|| invalid("controller_layout : taille absente"))?
                as usize;
            let slice = flat
                .get(offset..offset + count)
                .ok_or_else(|| invalid("controller_weights trop court"))?;
            tensors.insert(name.to_string(), slice.to_vec());
            offset += count;
        }
        if offset != flat.len() {
            return Err(invalid("controller_weights : taille incohérente"));
        }

        let mut take = |name: &str, count: usize| -> Result<Vec<f32>, crate::Error> {
            let tensor = tensors
                .remove(name)
                .ok_or_else(|| invalid(format!("tenseur {name} absent")))?;
            if tensor.len() != count {
                return Err(invalid(format!(
                    "{name} : {} valeurs, attendu {count}",
                    tensor.len()
                )));
            }
            Ok(tensor)
        };
        let mut gru =
            |prefix: &str, n_in: usize, n_hidden: usize| -> Result<GruWeights, crate::Error> {
                Ok(GruWeights {
                    n_in,
                    n_hidden,
                    w_ih: take(&format!("{prefix}.weight_ih"), 3 * n_hidden * n_in)?,
                    w_hh: take(&format!("{prefix}.weight_hh"), 3 * n_hidden * n_hidden)?,
                    b_ih: take(&format!("{prefix}.bias_ih"), 3 * n_hidden)?,
                    b_hh: take(&format!("{prefix}.bias_hh"), 3 * n_hidden)?,
                })
            };
        let glob = gru("daf.glob.gru", 10, 8)?;
        let bins = gru("daf.bins.gru", 18, 16)?;
        let part = gru("daf.part.gru", 10, 8)?;
        let controller = ControllerWeights {
            glob,
            bins,
            part,
            glob_ln_w: take("daf.glob.norm.ln.weight", 6)?,
            glob_ln_b: take("daf.glob.norm.ln.bias", 6)?,
            bins_ln_w: take("daf.bins.norm.ln.weight", 6)?,
            bins_ln_b: take("daf.bins.norm.ln.bias", 6)?,
            part_ln_w: take("daf.part.ln.weight", 2)?,
            part_ln_b: take("daf.part.ln.bias", 2)?,
            head_w: take("daf.head.weight", 16)?,
            head_b: take("daf.head.bias", 1)?[0],
            part_head_w: take("daf.part.head.weight", 8)?,
            part_head_b: take("daf.part.head.bias", 1)?[0],
        };

        let analysis_window = floats(&root, "analysis_window")?;
        if analysis_window.len() != FFT_SIZE {
            return Err(invalid("analysis_window : taille incohérente"));
        }
        Ok(Self {
            controller,
            analysis_window,
        })
    }
}
