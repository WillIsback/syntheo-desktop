# Syntheo agent plugin

Query Syntheo meetings with a local-first skill and an optional Cloud MCP connection. On your computer, the skill prefers the local CLI or local MCP, including unsynced changes. Remote agents use OAuth-connected Cloud snapshots. Read notes, summaries, participants, action items, bounded transcript excerpts, recurring history, and complete exports when explicitly needed.

## Local access

Install the [Syntheo CLI](https://github.com/WillIsback/syntheo-desktop/tree/main/docs/installation) and open the desktop app once to create its database. Use `syntheo-cli` instead of `syntheo` for every command on Flatpak. Run `syntheo --json doctor`, then `syntheo --json meetings --source local list`. Local reads need no Cloud login, Pro subscription, or completed sync. The app can be closed after its database exists.

## Optional Cloud access

1. Sign in with Pro access through a personal plan or an eligible paid Team membership in the desktop app.
2. Open **Settings → Developers → Cloud API & Connectors**, review the disclosure, and enable it.
3. Wait for your meeting snapshots to upload.

Use the host's connection control to sign in and approve OAuth. Some MCP hosts prompt on first cloud tool use. The host discovers Syntheo's authorization server from `https://api.example.com/mcp`; no cloud API key is required.

The CLI can also read hosted snapshots with `syntheo meetings --source cloud ...` after login. `--source auto` prefers the local database and uses Cloud only when it is absent; it does not check freshness or hide database errors.

The repository package is named **Syntheo**. Its optional hosted connection appears as **Syntheo Cloud**.

## Install from this repository

### Claude Code

```bash
claude plugin marketplace add WillIsback/syntheo-desktop
claude plugin install syntheo@fastrepl
```

Or add the remote server directly. Claude discovers OAuth from the MCP endpoint:

```bash
claude mcp add --transport http syntheo https://api.example.com/mcp
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add WillIsback/syntheo-desktop
copilot plugin install syntheo@fastrepl
```

### ChatGPT and Codex

```bash
codex plugin marketplace add WillIsback/syntheo-desktop \
  --sparse .agents/plugins \
  --sparse agent-plugins/syntheo
```

Restart the ChatGPT desktop app, open the Plugins Directory, select the Fastrepl source, and install **Syntheo**.

The plugin includes an optional **Syntheo Cloud** App connection. Connect it for hosted access; leave it disconnected to use the local CLI. The public directory listing has its own review and release process, separate from this repository marketplace.

### Cursor

Import `https://github.com/WillIsback/syntheo-desktop` as a team marketplace, then install **Syntheo**. You can also load `agent-plugins/syntheo` as a local plugin while testing.

## Configure MCP directly

Clients that do not install plugins can add the hosted server:

```json
{
  "mcpServers": {
    "syntheo": {
      "url": "https://api.example.com/mcp"
    }
  }
}
```

For a fully local agent that should not use Cloud, start `syntheo mcp` yourself. See [MCP for agents](https://github.com/WillIsback/syntheo-desktop/tree/main/docs/agents/mcp). Static remote clients that cannot complete MCP OAuth can follow the [remote MCP setup](https://github.com/WillIsback/syntheo-desktop/tree/main/docs/reference/api-cloud#remote-mcp) with a cloud API key.

## Data access

Cloud MCP is read-only hosted snapshots. Local CLI and optional local MCP read the app database through Syntheo's compatibility layer. Cloud access uploads a separate server-readable copy only after the user opts in. Encrypted Cloud Sync and connector uploads have independent freshness; neither database availability nor a meeting's `updated_at` proves that all copies are current. See [Data, privacy, and retention](https://github.com/WillIsback/syntheo-desktop/tree/main/docs/data-and-privacy).
