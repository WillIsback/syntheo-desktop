import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeStoredLlmSelection } from "~/settings/ai/llm/selection";
import { PROVIDERS } from "~/settings/ai/llm/shared";

// Garde-fou : le résumé, le chat et le générateur ne parlent qu'à un serveur
// OpenAI-compatible on-premise (vLLM, Ollama, llama.cpp…). Les providers LLM
// cloud hérités d'Anarlog sont supprimés.
// Vitest s'exécute depuis apps/desktop (environnement jsdom, pas d'URL file:).
const REPO_ROOT = join(process.cwd(), "../..");

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });

describe("llm on-prem", () => {
  it("llm_settings_offer_only_custom", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(["custom"]);
  });

  it("desktop_declares_no_cloud_llm_sdk", () => {
    const manifest = read("apps/desktop/package.json");
    for (const dependency of [
      '"@ai-sdk/anthropic"',
      '"@ai-sdk/azure"',
      '"@ai-sdk/google"',
      '"@ai-sdk/openai"',
      '"@openrouter/ai-sdk-provider"',
      '"ollama"',
    ]) {
      expect(manifest).not.toContain(dependency);
    }
  });

  it("no_device_fingerprint_header", () => {
    const offenders = sources(join(REPO_ROOT, "apps/desktop/src")).filter(
      (path) =>
        /x-device-fingerprint|getFingerprint/i.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("normalizes_a_legacy_llm_selection", () => {
    expect(normalizeStoredLlmSelection("anarlog", "auto")).toEqual({
      provider: "",
      model: "",
    });
    expect(normalizeStoredLlmSelection("custom", "qwen")).toEqual({
      provider: "custom",
      model: "qwen",
    });
    expect(normalizeStoredLlmSelection(undefined, undefined)).toEqual({
      provider: undefined,
      model: undefined,
    });
  });
});
