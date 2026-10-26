import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { aiProviderSchema } from "@anlg/store";

import { PROVIDERS } from "~/settings/ai/stt/shared";

// Garde-fou : la transcription ne parle qu'aux protocoles standard des moteurs
// on-premise (OpenAI Realtime et /v1/audio/transcriptions, NVIDIA NIM). Les
// adaptateurs STT cloud hérités d'Anarlog sont supprimés.
// Vitest s'exécute depuis apps/desktop (environnement jsdom, pas d'URL file:).
const REPO_ROOT = join(process.cwd(), "../..");

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const CLOUD_STT =
  /\b(deepgram|assemblyai|soniox|speechmatics|gladia|elevenlabs|cartesia|fireworks|dashscope|groq|azure|google_cloud|aws_transcribe|amazon_bedrock|revai|inworld|gradium|modulate|alebex|wisprflow|smallestai|aquavoice|cohere)\b/i;

describe("stt on-prem", () => {
  it("keeps_only_on_prem_stt_adapters", () => {
    const entries = readdirSync(
      join(REPO_ROOT, "crates/owhisper-client/src/adapter"),
    ).sort();
    expect(entries).toEqual([
      "http.rs",
      "language.rs",
      "mod.rs",
      "nvidia.rs",
      "openai",
      "openai_compatible_batch.rs",
      "parsing.rs",
      "segment.rs",
      "streaming_providers_tests.rs",
      "tests.rs",
    ]);
  });

  it("rust_consumers_name_no_cloud_stt_provider", () => {
    const offenders = [
      "crates/listener-core/src/actors/listener/adapters.rs",
      "crates/listener2-core/src/batch/mod.rs",
      "crates/listener2-core/src/batch/simple/direct.rs",
      "crates/listener2-core/src/lib.rs",
      "plugins/dictation/src/preview.rs",
      "crates/owhisper-client/src/providers.rs",
    ].filter((file) => CLOUD_STT.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("stt_settings_offer_only_on_prem_protocols", () => {
    const enabled = PROVIDERS.filter((provider) => !provider.disabled)
      .map((provider) => provider.id)
      .sort();
    expect(enabled).toEqual(["nvidia", "openai"]);
    const openai = PROVIDERS.find((provider) => provider.id === "openai");
    expect(openai?.baseUrl).toBeUndefined();
  });

  it("stt_endpoint_key_is_optional_over_https", () => {
    expect(
      aiProviderSchema.safeParse({
        type: "stt",
        base_url: "https://spark-787d-1.tail6cba9f.ts.net/v1/realtime",
        api_key: "",
      }).success,
    ).toBe(true);
  });

  it.each([
    "plugins/local-stt",
    "plugins/local-llm",
    "crates/transcribe-soniqo",
    "crates/transcribe-speechanalyzer",
    "crates/whisper-local",
    "crates/pyannote-local",
    "crates/voiceprint",
    "crates/embedding",
    "crates/local-model",
    "crates/model-downloader",
  ])("removes_embedded_inference %s", (path) => {
    expect(existsSync(join(REPO_ROOT, path))).toBe(false);
  });

  it("rust_consumers_name_no_local_engine", () => {
    const offenders = [
      "crates/listener-core/src/actors/listener/adapters.rs",
      "crates/listener2-core/src/batch/mod.rs",
      "plugins/dictation/src/preview.rs",
      "apps/desktop/src-tauri/src/lib.rs",
    ].filter((file) =>
      /soniqo|speechanalyzer|apple_speech|whisper_?cpp|argmax|local_stt|local_llm|voiceprint|pyannote/i.test(
        read(file),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("desktop_imports_no_local_engine", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return files(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
          ? [path]
          : [];
      });
    const offenders = files(join(REPO_ROOT, "apps/desktop/src")).filter(
      (path) =>
        /@anlg\/plugin-local-(stt|llm)/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
