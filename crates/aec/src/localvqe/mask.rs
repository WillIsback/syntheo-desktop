//! Masque neuronal résiduel de LocalVQE v1.4-AEC 200K, en ONNX (export soniqo, opset 18) : encodeurs
//! micro / référence, bloc d'alignement à attention (retard « soft » sur 16 trames, 256 ms),
//! goulot S4D et masque convolutif complexe 3×3. Sept tenseurs d'état passent d'une trame à l'autre.

use syntheo_onnx::{
    ndarray::{Array4, ArrayD, IxDyn},
    ort::{session::Session, value::TensorRef},
};

use super::N_BINS;

pub(crate) const MODEL_BYTES: &[u8] =
    include_bytes!("../../data/models/LocalVQEAECResidualMask.onnx");

/// Ordre des entrées du graphe après les deux spectres, et forme de chaque état.
const STATES: [(&str, &[usize]); 7] = [
    ("conv_state", &[1, 75936]),
    ("align_key_state", &[1, 16, 15, 64]),
    ("align_reference_state", &[1, 20, 15, 64]),
    ("align_smooth_state", &[1, 16, 4, 16]),
    ("s4_real_state", &[1, 80]),
    ("s4_imag_state", &[1, 80]),
    ("ccm_state", &[1, 2, 2, 256]),
];

pub(crate) struct ResidualMask {
    session: Session,
    mic: Array4<f32>,
    reference: Array4<f32>,
    states: Vec<ArrayD<f32>>,
}

fn layout_error() -> crate::Error {
    crate::Error::ShapeError(syntheo_onnx::ndarray::ShapeError::from_kind(
        syntheo_onnx::ndarray::ErrorKind::IncompatibleLayout,
    ))
}

impl ResidualMask {
    pub(crate) fn new() -> Result<Self, crate::Error> {
        let session = syntheo_onnx::load_model_from_bytes(MODEL_BYTES)?;
        Ok(Self {
            session,
            mic: Array4::zeros((1, 2, 1, N_BINS)),
            reference: Array4::zeros((1, 2, 1, N_BINS)),
            states: STATES
                .iter()
                .map(|(_, shape)| ArrayD::zeros(IxDyn(shape)))
                .collect(),
        })
    }

    pub(crate) fn reset(&mut self) {
        for state in &mut self.states {
            state.fill(0.0);
        }
    }

    /// Une trame : spectres `[re | im]` du résidu `e` et de l'écho estimé `ŷ` -> spectre rehaussé.
    pub(crate) fn run(
        &mut self,
        residual: &[f32],
        echo_estimate: &[f32],
        enhanced: &mut [f32],
    ) -> Result<(), crate::Error> {
        self.mic
            .as_slice_mut()
            .ok_or_else(layout_error)?
            .copy_from_slice(residual);
        self.reference
            .as_slice_mut()
            .ok_or_else(layout_error)?
            .copy_from_slice(echo_estimate);

        let mut outputs = {
            let s = &self.states;
            self.session.run(syntheo_onnx::ort::inputs![
                TensorRef::from_array_view(self.mic.view())?,
                TensorRef::from_array_view(self.reference.view())?,
                TensorRef::from_array_view(s[0].view())?,
                TensorRef::from_array_view(s[1].view())?,
                TensorRef::from_array_view(s[2].view())?,
                TensorRef::from_array_view(s[3].view())?,
                TensorRef::from_array_view(s[4].view())?,
                TensorRef::from_array_view(s[5].view())?,
                TensorRef::from_array_view(s[6].view())?,
            ])?
        };

        let out = outputs
            .remove("enhanced_spectrum")
            .ok_or_else(|| crate::Error::MissingOutput("enhanced_spectrum".into()))?;
        let (_, data) = out.try_extract_tensor::<f32>()?;
        if data.len() != enhanced.len() {
            return Err(layout_error());
        }
        enhanced.copy_from_slice(data);

        for ((name, _), state) in STATES.iter().zip(self.states.iter_mut()) {
            let key = format!("next_{name}");
            let value = outputs
                .remove(key.as_str())
                .ok_or_else(|| crate::Error::MissingOutput(key.clone()))?;
            let (_, data) = value.try_extract_tensor::<f32>()?;
            let slot = state.as_slice_mut().ok_or_else(layout_error)?;
            if data.len() != slot.len() {
                return Err(layout_error());
            }
            slot.copy_from_slice(data);
        }
        Ok(())
    }
}
