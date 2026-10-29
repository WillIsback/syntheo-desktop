import { Effect, pipe, Schema } from "effect";

import {
  DEFAULT_RESULT,
  extractMetadataMap,
  fetchJson,
  isDateSnapshot,
  isNonChatModel,
  isOldModel,
  type ListModelsResult,
  type ModelIgnoreReason,
  partition,
  REQUEST_TIMEOUT,
  shouldIgnoreCommonKeywords,
  sortModelsByRecency,
} from "./list-common";

const OpenAIModelSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
    }),
  ),
});

export async function listOpenAIModels(
  baseUrl: string,
  apiKey: string,
): Promise<ListModelsResult> {
  if (!baseUrl) {
    return DEFAULT_RESULT;
  }

  return pipe(
    fetchJson(`${baseUrl}/models`, { Authorization: `Bearer ${apiKey}` }),
    Effect.andThen((json) =>
      Schema.decodeUnknownEffect(OpenAIModelSchema)(json),
    ),
    Effect.map(({ data }) => {
      const result = partition(
        data,
        (model) => {
          const reasons: ModelIgnoreReason[] = [];
          if (shouldIgnoreCommonKeywords(model.id)) {
            reasons.push("common_keyword");
          }
          if (isNonChatModel(model.id)) {
            reasons.push("not_chat_model");
          }
          if (isOldModel(model.id)) {
            reasons.push("old_model");
          }
          if (isDateSnapshot(model.id)) {
            reasons.push("date_snapshot");
          }
          return reasons.length > 0 ? reasons : null;
        },
        (model) => model.id,
      );

      return {
        models: sortModelsByRecency(result.models),
        ignored: result.ignored,
        metadata: extractMetadataMap(
          data,
          (model) => model.id,
          (_model) => ({ input_modalities: ["text", "image"] }),
        ),
      };
    }),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.catch(() => Effect.succeed(DEFAULT_RESULT)),
    Effect.runPromise,
  );
}

export async function listGenericModels(
  baseUrl: string,
  apiKey: string,
  options?: { filterDateSnapshots?: boolean },
): Promise<ListModelsResult> {
  if (!baseUrl) {
    return DEFAULT_RESULT;
  }

  return pipe(
    fetchJson(`${baseUrl}/models`, { Authorization: `Bearer ${apiKey}` }),
    Effect.andThen((json) =>
      Schema.decodeUnknownEffect(OpenAIModelSchema)(json),
    ),
    Effect.map(({ data }) => processGenericModels(data, options)),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.catch(() => Effect.succeed(DEFAULT_RESULT)),
    Effect.runPromise,
  );
}

export function processGenericModels(
  data: readonly { id: string }[],
  options?: { filterDateSnapshots?: boolean },
): ListModelsResult {
  const result = partition(
    data,
    (model) => {
      const reasons: ModelIgnoreReason[] = [];
      if (shouldIgnoreCommonKeywords(model.id)) {
        reasons.push("common_keyword");
      }
      if (isNonChatModel(model.id)) {
        reasons.push("not_chat_model");
      }
      if (isOldModel(model.id)) {
        reasons.push("old_model");
      }
      if (options?.filterDateSnapshots !== false && isDateSnapshot(model.id)) {
        reasons.push("date_snapshot");
      }
      return reasons.length > 0 ? reasons : null;
    },
    (model) => model.id,
  );

  return {
    models: sortModelsByRecency(result.models),
    ignored: result.ignored,
    metadata: extractMetadataMap(
      data,
      (model) => model.id,
      () => ({ input_modalities: ["text"] }),
    ),
  };
}

// Un serveur on-prem expose les modèles qu'il sert : aucun n'est écarté par
// les heuristiques propres au catalogue OpenAI (anciens, datés, gpt-4o-*) ;
// seuls les modèles d'embedding, d'audio ou d'image le sont.
export function listCustomModels(
  baseUrl: string,
  apiKey: string,
): Promise<ListModelsResult> {
  if (!baseUrl) {
    return Promise.resolve(DEFAULT_RESULT);
  }

  return pipe(
    fetchJson(
      `${baseUrl}/models`,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    ),
    Effect.andThen((json) =>
      Schema.decodeUnknownEffect(OpenAIModelSchema)(json),
    ),
    Effect.map(({ data }) => processCustomModels(data)),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.catch(() => Effect.succeed(DEFAULT_RESULT)),
    Effect.runPromise,
  );
}

export function processCustomModels(
  data: readonly { id: string }[],
): ListModelsResult {
  const result = partition(
    data,
    (model) => {
      const reasons: ModelIgnoreReason[] = [];
      if (shouldIgnoreCommonKeywords(model.id)) {
        reasons.push("common_keyword");
      }
      return reasons.length > 0 ? reasons : null;
    },
    (model) => model.id,
  );

  return {
    models: sortModelsByRecency(result.models),
    ignored: result.ignored,
    metadata: extractMetadataMap(
      data,
      (model) => model.id,
      () => ({ input_modalities: ["text"] }),
    ),
  };
}
