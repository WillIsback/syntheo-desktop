mod direct;

pub(super) use direct::run_direct_batch_for_adapter_kind;

#[cfg(test)]
use super::upload::segment_plan;
#[cfg(test)]
use direct::{
    DIRECT_BATCH_TIMEOUT_CEILING, DIRECT_BATCH_TIMEOUT_FLOOR, RATE_LIMIT_BASE_DELAY,
    RATE_LIMIT_MAX_DELAY, direct_batch_timeout_for_audio, merge_segment_responses,
    rate_limit_retry_delay, run_direct_batch, run_direct_batch_with_timeout,
};
#[cfg(test)]
mod tests;
