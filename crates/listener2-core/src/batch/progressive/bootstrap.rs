use owhisper_client::OpenAIAdapter;
use ractor::{ActorProcessingErr, ActorRef};
use tracing::Instrument;

use super::ProgressiveProvider;
use super::actor::{
    BatchArgs, BatchMsg, BatchStartNotifier, process_provider_stream, report_stream_start_failure,
};

pub(super) async fn spawn_progressive_batch_task(
    args: BatchArgs,
    myself: ActorRef<BatchMsg>,
) -> Result<
    (
        tokio::task::JoinHandle<()>,
        tokio::sync::oneshot::Sender<()>,
    ),
    ActorProcessingErr,
> {
    match args.progressive_provider {
        ProgressiveProvider::OpenAI => spawn_openai_batch_task(args, myself).await,
    }
}

async fn spawn_openai_batch_task(
    args: BatchArgs,
    myself: ActorRef<BatchMsg>,
) -> Result<
    (
        tokio::task::JoinHandle<()>,
        tokio::sync::oneshot::Sender<()>,
    ),
    ActorProcessingErr,
> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let span = tracing::info_span!("openai_progressive_batch");

    let rx_task = tokio::spawn(
        async move {
            // Le streaming progressif ne lit qu'un seul fichier : les envois
            // découpés ou en mémoire passent par le chemin direct.
            let opened = OpenAIAdapter::transcribe_file_streaming(
                &args.base_url,
                &args.api_key,
                &args.listen_params,
                &args.file_path,
            )
            .await;

            let stream = match opened {
                Ok(stream) => {
                    notify_start_result(&args.start_notifier, Ok(()));
                    stream
                }
                Err(err) => {
                    report_stream_start_failure(
                        &myself,
                        &args.start_notifier,
                        &args.provider_label,
                        &err,
                        "openai progressive batch failed to start",
                    );
                    return;
                }
            };

            process_provider_stream(
                stream,
                myself,
                shutdown_rx,
                &args.provider_label,
                "openai progressive batch",
            )
            .await;
        }
        .instrument(span),
    );

    Ok((rx_task, shutdown_tx))
}

pub(super) fn notify_start_result(notifier: &BatchStartNotifier, result: crate::Result<()>) {
    if let Ok(mut guard) = notifier.lock()
        && let Some(sender) = guard.take()
    {
        let _ = sender.send(result);
    }
}
