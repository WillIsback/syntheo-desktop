#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error(transparent)]
    ResampleError(#[from] rubato::ResampleError),
    #[error(transparent)]
    ResamplerConstructionError(#[from] rubato::ResamplerConstructionError),
    #[error(transparent)]
    DecoderError(#[from] rodio::decoder::DecoderError),
    #[error(transparent)]
    Resampler(#[from] syntheo_resampler::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Hound(#[from] hound::Error),
    #[error("unsupported channel count {count}")]
    UnsupportedChannelCount { count: u16 },
    #[error("invalid sample rate {0}")]
    InvalidSampleRate(u32),
}
