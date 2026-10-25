pub fn is_meta_model(model: &str) -> bool {
    matches!(model, "cloud" | "auto")
}

/// Defaults of the OpenAI speech protocol. On-prem servers are configured by
/// URL: there is no default host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::EnumString, strum::Display)]
pub enum Provider {
    #[strum(serialize = "openai")]
    OpenAI,
}

impl Provider {
    pub fn build_auth_header(&self, api_key: &str) -> Option<(&'static str, String)> {
        match self {
            Self::OpenAI => Some(("Authorization", format!("Bearer {api_key}"))),
        }
    }

    pub fn default_live_model(&self) -> &'static str {
        match self {
            Self::OpenAI => "gpt-live-transcribe",
        }
    }

    pub fn default_live_sample_rate(&self) -> u32 {
        match self {
            Self::OpenAI => 24000,
        }
    }

    pub fn default_batch_model(&self) -> &'static str {
        match self {
            Self::OpenAI => "gpt-transcribe",
        }
    }

    pub fn supports_native_multichannel(&self) -> bool {
        false
    }
}
