/// <reference types="vitest" />

import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

import { relayShim } from "@syntheo/plugin-relay/vite";

import { changelog } from "./plugins/changelog";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    relayShim(),
    changelog(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    lingui(),
    babel({
      presets: [linguiTransformerBabelPreset()],
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/autocomplete",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/lang-jinja",
      "codemirror-readonly-ranges",
      "@uiw/react-codemirror",
      "react",
      "react-dom",
    ],
  },
  test: {
    reporters: "default",
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    onConsoleLog: (_, type) => {
      return type === "stderr";
    },
    exclude: ["**/node_modules/**", "**/src-tauri/**"],
    // @lobehub/ui (tiré par @lobehub/icons) publie un build `es` avec des
    // imports de répertoires (`./Accordion`) que Node ESM ne résout pas.
    // On l'inline pour que Vite le transforme.
    server: {
      deps: {
        inline: [/@lobehub\/ui/, /@lobehub\/icons/],
      },
    },
  },
  ...tauri,
}));

// https://v2.tauri.app/start/frontend/vite/#update-vite-configuration
const tauri: UserConfig = {
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "./dist",
    chunkSizeWarningLimit: 500 * 10,
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "terser",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
};
