# Overview

Syntheo Desktop is a pnpm and Rust workspace (Tauri 2 desktop app), derived from Anarlog (see `NOTICE.md`). Read the nearest `AGENTS.md` before changing a component; nested files inherited from Anarlog may still mention removed services.

- `apps/desktop/`: Tauri 2 with React, TypeScript, Vite, and Tailwind. Zustand owns UI state; TanStack Query/Form own queries, mutations, and forms.
- `crates/db-app/`: SQLite schema and migrations. New migrations are timestamped after the last existing one.
- `crates/owhisper-client/`: STT adapters. Only on-premise protocols are allowed (OpenAI Realtime, vLLM Realtime, NVIDIA NIM WebSocket/gRPC, OpenAI-compatible batch).
- `crates/template-app/`: Jinja prompt templates (enhance).
- `design/refonte-the-vert/`: UI redesign in progress ("Thé vert" identity, "document vivant" note flow). Read its `README.md` before any UI change: it defines the target design, the work lots and the clickable mockups.

Project rules (see `docs/architecture.mdx`):

- Inference only through user-configured on-premise endpoints; never add a cloud provider or a cloud integration.
- Audio is never written to disk, not even temporarily.
- No telemetry, account, or billing code.
- User-facing text is French first.
- Commits and PR titles follow Conventional Commits; PRs reference an issue (`Closes #N`).
