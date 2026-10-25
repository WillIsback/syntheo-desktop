use crate::error_detection::ProviderError;

pub fn is_meta_model(model: &str) -> bool {
    matches!(model, "cloud" | "auto")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Auth {
    Header {
        name: &'static str,
        prefix: Option<&'static str>,
    },
    FirstMessage {
        field_name: &'static str,
    },
    SessionInit {
        header_name: &'static str,
    },
}

impl Auth {
    pub fn build_header(&self, api_key: &str) -> Option<(&'static str, String)> {
        match self {
            Auth::Header { name, prefix } => {
                let value = match prefix {
                    Some(p) => format!("{}{}", p, api_key),
                    None => api_key.to_string(),
                };
                Some((name, value))
            }
            Auth::FirstMessage { .. } | Auth::SessionInit { .. } => None,
        }
    }

    pub fn build_session_init_header(&self, api_key: &str) -> Option<(&'static str, String)> {
        match self {
            Auth::SessionInit { header_name } => Some((header_name, api_key.to_string())),
            _ => None,
        }
    }

    pub fn transform_first_message(&self, payload: String, api_key: &str) -> String {
        match self {
            Auth::FirstMessage { field_name } => {
                match serde_json::from_str::<serde_json::Value>(&payload) {
                    Ok(mut json) => {
                        if let Some(obj) = json.as_object_mut() {
                            obj.insert(
                                (*field_name).to_string(),
                                serde_json::Value::String(api_key.to_string()),
                            );
                        }
                        serde_json::to_string(&json).unwrap_or(payload)
                    }
                    Err(_) => payload,
                }
            }
            Auth::Header { .. } | Auth::SessionInit { .. } => payload,
        }
    }
}

/// Metadata of the only STT protocol with a well-known public host. On-prem
/// servers are configured by URL and carry no provider metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::EnumString, strum::Display)]
pub enum Provider {
    #[strum(serialize = "openai")]
    OpenAI,
}

impl Provider {
    const ALL: [Provider; 1] = [Self::OpenAI];

    pub fn from_host(host: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.is_host(host))
    }

    pub fn auth(&self) -> Auth {
        match self {
            Self::OpenAI => Auth::Header {
                name: "Authorization",
                prefix: Some("Bearer "),
            },
        }
    }

    pub fn build_auth_header(&self, api_key: &str) -> Option<(&'static str, String)> {
        self.auth().build_header(api_key)
    }

    pub fn default_ws_url(&self) -> String {
        format!("wss://{}{}", self.default_ws_host(), self.ws_path())
    }

    pub fn default_api_host(&self) -> &'static str {
        match self {
            Self::OpenAI => "api.openai.com",
        }
    }

    pub fn default_ws_host(&self) -> &'static str {
        match self {
            Self::OpenAI => "api.openai.com",
        }
    }

    pub fn ws_path(&self) -> &'static str {
        match self {
            Self::OpenAI => "/v1/realtime",
        }
    }

    pub fn default_api_url(&self) -> Option<&'static str> {
        match self {
            Self::OpenAI => None,
        }
    }

    pub fn default_api_base(&self) -> &'static str {
        match self {
            Self::OpenAI => "https://api.openai.com/v1",
        }
    }

    pub fn domain(&self) -> &'static str {
        match self {
            Self::OpenAI => "openai.com",
        }
    }

    pub fn is_host(&self, host: &str) -> bool {
        let domain = self.domain();
        host == domain || host.ends_with(&format!(".{}", domain))
    }

    pub fn matches_url(&self, base_url: &str) -> bool {
        url::Url::parse(base_url)
            .ok()
            .and_then(|u| u.host_str().map(|h| self.is_host(h)))
            .unwrap_or(false)
    }

    pub fn from_url(base_url: &str) -> Option<Self> {
        url::Url::parse(base_url)
            .ok()
            .and_then(|u| u.host_str().and_then(Self::from_host))
    }

    pub fn env_key_name(&self) -> &'static str {
        match self {
            Self::OpenAI => "OPENAI_API_KEY",
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

    pub fn default_query_params(&self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::OpenAI => &[("intent", "transcription")],
        }
    }

    pub fn supports_native_multichannel(&self) -> bool {
        false
    }

    pub fn preserves_batch_channel_identity(&self) -> bool {
        false
    }

    pub fn control_message_types(&self) -> &'static [&'static str] {
        &[]
    }

    pub fn session_init_config(
        &self,
        _sample_rate: u32,
        _channels: u8,
    ) -> Option<serde_json::Value> {
        None
    }

    pub fn translate_control_message(
        &self,
        msg: &owhisper_interface::ControlMessage,
    ) -> Option<String> {
        use crate::adapter::RealtimeSttAdapter;
        use anlg_ws_client::client::Message;
        use owhisper_interface::ControlMessage;

        fn extract_text(msg: Message) -> Option<String> {
            match msg {
                Message::Text(t) => Some(t.to_string()),
                _ => None,
            }
        }

        let adapter = crate::adapter::OpenAIAdapter::default();
        match msg {
            ControlMessage::KeepAlive => adapter.keep_alive_message().and_then(extract_text),
            ControlMessage::Finalize => extract_text(adapter.finalize_message()),
            ControlMessage::CloseStream => None,
        }
    }

    pub fn detect_error(&self, _data: &[u8]) -> Option<ProviderError> {
        None
    }

    pub fn detect_any_error(data: &[u8]) -> Option<ProviderError> {
        Self::ALL.iter().find_map(|p| p.detect_error(data))
    }
}
