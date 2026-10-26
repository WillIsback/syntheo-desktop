import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { aiProviderSchema } from "@anlg/store";

import { normalizeStoredLlmSelection } from "~/settings/ai/llm/selection";
import { LLM_VLLM_PRESET_URL, PROVIDERS } from "~/settings/ai/llm/shared";
import { processCustomModels } from "~/settings/ai/shared/list-openai";

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

  it("custom_llm_preset_points_at_the_dgx_vllm", () => {
    expect(LLM_VLLM_PRESET_URL).toBe(
      "https://spark-787d-1.tail6cba9f.ts.net/v1",
    );
    const custom = PROVIDERS.find((provider) => provider.id === "custom");
    expect(custom?.baseUrl).toBe(LLM_VLLM_PRESET_URL);
    expect(custom?.displayName).toBe("vLLM (OpenAI-compatible)");
    expect(custom?.requirements).toEqual([
      { kind: "requires_config", fields: ["base_url"] },
    ]);
  });

  it("llm_endpoint_key_is_optional_over_https", () => {
    expect(
      aiProviderSchema.safeParse({
        type: "llm",
        base_url: LLM_VLLM_PRESET_URL,
        api_key: "",
      }).success,
    ).toBe(true);
  });

  it("custom_llm_lists_every_served_model", () => {
    expect(
      processCustomModels([
        { id: "nvidia/Qwen3.8-Flash-Next-FP4-Local" },
        { id: "gpt-3.5-turbo" },
        { id: "gpt-4o-2024-08-06" },
      ]).models.sort(),
    ).toEqual([
      "gpt-3.5-turbo",
      "gpt-4o-2024-08-06",
      "nvidia/Qwen3.8-Flash-Next-FP4-Local",
    ]);
  });

  it.each(["plugins/bedrock", "crates/openrouter", "crates/template-eval"])(
    "removes_cloud_llm_crates %s",
    (path) => {
      expect(existsSync(join(REPO_ROOT, path))).toBe(false);
      expect(read("Cargo.toml")).not.toContain(path);
    },
  );

  it("misc_plugin_exposes_no_device_fingerprint", () => {
    for (const file of [
      "plugins/misc/build.rs",
      "plugins/misc/src/lib.rs",
      "plugins/misc/permissions/default.toml",
      "plugins/misc/js/bindings.gen.ts",
    ]) {
      expect(read(file)).not.toContain("fingerprint");
    }
  });
});
