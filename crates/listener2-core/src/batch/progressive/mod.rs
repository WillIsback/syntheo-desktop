mod actor;
mod bootstrap;
mod segmented;

use std::sync::Arc;

use owhisper_client::{AdapterKind, OpenAIAdapter};

use crate::BatchRuntime;

use super::{BatchParams, BatchRunOutput};

#[derive(Debug, Clone, Copy, strum::IntoStaticStr)]
pub(super) enum ProgressiveProvider {
    #[strum(serialize = "openai")]
    OpenAI,
}

impl ProgressiveProvider {
    pub(super) fn label(self) -> &'static str {
        self.into()
    }
}

pub(super) async fn run_progressive_batch_session(
    runtime: Arc<dyn BatchRuntime>,
    params: BatchParams,
    listen_params: owhisper_interface::ListenParams,
) -> crate::Result<BatchRunOutput> {
    let progressive_provider = resolve_progressive_provider(&params, &listen_params)?;
    actor::run_progressive_batch(runtime, params, listen_params, progressive_provider).await
}

fn resolve_progressive_provider(
    _params: &BatchParams,
    listen_params: &owhisper_interface::ListenParams,
) -> crate::Result<ProgressiveProvider> {
    if OpenAIAdapter::supports_progressive_batch_model(listen_params.model.as_deref()) {
        Ok(ProgressiveProvider::OpenAI)
    } else {
        Err(crate::BatchFailure::ProgressiveBatchUnsupported {
            provider: AdapterKind::OpenAI.to_string(),
        }
        .into())
    }
}
