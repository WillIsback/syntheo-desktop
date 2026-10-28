import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const shimPath = resolve(__dirname, "shim.js");
const defaultRelayPort = 1423;
const shimScriptSrc = "/relay-shim.js";

function getRelayPort() {
  const value = Number.parseInt(process.env.RELAY_PORT || "", 10);
  return Number.isInteger(value) && value > 0 ? value : defaultRelayPort;
}

/** @returns {import('vite').Plugin} */
export function relayShim() {
  return {
    name: "relay-shim",
    configureServer(server) {
      server.middlewares.use(shimScriptSrc, (_req, res) => {
        const content = readFileSync(shimPath, "utf-8").replaceAll(
          "__RELAY_PORT__",
          String(getRelayPort()),
        );
        res.setHeader("Content-Type", "application/javascript");
        res.end(content);
      });
    },
    transformIndexHtml(_html, ctx) {
      // En build, le shim n'est pas servi : on ne l'injecte pas du tout
      // (injection conditionnelle plutôt que retrait du tag par regex).
      if (!ctx.server) {
        return [];
      }
      return [
        {
          tag: "script",
          attrs: { src: shimScriptSrc },
          injectTo: "head",
        },
      ];
    },
  };
}
