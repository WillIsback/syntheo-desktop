import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().min(1).default("http://localhost:3001"),
    // Pas de CDN distant : les icônes sont servies depuis les assets locaux.
    VITE_STATIC_ASSETS_URL: z.string().url().optional(),
    VITE_AI_API_URL: z.string().url().optional(),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});
