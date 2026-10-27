use serde::{Serialize, ser::Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[cfg(feature = "onnx")]
    #[error(transparent)]
    SyntheoOnnxError(#[from] syntheo_onnx::Error),

    #[cfg(feature = "onnx")]
    #[error(transparent)]
    OrtError(#[from] syntheo_onnx::ort::Error),

    #[error(transparent)]
    FftError(#[from] realfft::FftError),

    #[cfg(feature = "onnx")]
    #[error(transparent)]
    ShapeError(#[from] syntheo_onnx::ndarray::ShapeError),

    #[error("Missing output tensor: {0}")]
    MissingOutput(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
