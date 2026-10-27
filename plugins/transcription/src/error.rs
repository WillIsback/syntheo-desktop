use serde::{Serialize, ser::Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    IoError(#[from] std::io::Error),
    #[error(transparent)]
    SyntheoAudioError(#[from] syntheo_audio::Error),

    #[error("no session")]
    NoneSession,
    #[error("session already running")]
    SessionAlreadyRunning,
    #[error("session storage unavailable")]
    SessionStorageUnavailable,
    #[error("start session failed")]
    StartSessionFailed,
    #[error("capture snapshot unavailable")]
    CaptureSnapshotUnavailable,
    #[error("stop session failed")]
    StopSessionFailed,
    #[error("actor not found {0}")]
    ActorNotFound(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
