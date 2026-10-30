# Syntheo agent plugin

Query Syntheo meetings from an agent, entirely on your computer. The plugin bundles the Syntheo skill and declares the local MCP server (`syntheo mcp`, over stdio). Agents read notes, summaries, participants, action items, bounded transcript excerpts, recurring history, and complete exports when explicitly needed. There is no hosted service, account, or sign-in.

## Requirements

1. Install the Syntheo desktop app and open it once so it creates its local database.
2. Build the Syntheo CLI from source. It is not included in the published app packages:

   ```bash
   git clone https://github.com/WillIsback/syntheo-desktop.git
   cd syntheo-desktop
   cargo install --locked --path apps/cli
   ```

3. Check readiness with `syntheo --json doctor`, then `syntheo --json meetings list`.

The plugin starts the MCP server with the command `syntheo`, so the CLI must be on the agent's `PATH`. The `.deb` package installs the desktop app itself as `/usr/bin/syntheo`; on such a machine, make sure `~/.cargo/bin` comes first in `PATH`, or configure the MCP server yourself with the absolute path `~/.cargo/bin/syntheo` (see below). See [Install the CLI](https://syntheo.mintlify.site/docs/installation).

The app can be closed once its database exists, except for recording imports, which need the app open.

## Install from this repository

### Claude Code

```bash
claude plugin marketplace add WillIsback/syntheo-desktop
claude plugin install syntheo@syntheo-desktop
```

Or add the local server directly:

```bash
claude mcp add syntheo -- syntheo mcp
```

### Codex

```bash
codex plugin marketplace add WillIsback/syntheo-desktop \
  --sparse .agents/plugins \
  --sparse agent-plugins/syntheo
```

Then install **Syntheo** from the Syntheo Desktop source.

### Cursor

Import `https://github.com/WillIsback/syntheo-desktop` as a team marketplace, then install **Syntheo**. You can also load `agent-plugins/syntheo` as a local plugin while testing.

## Configure MCP directly

Clients that do not install plugins can start the local server themselves:

```json
{
  "mcpServers": {
    "syntheo": {
      "command": "/home/USER/.cargo/bin/syntheo",
      "args": ["mcp"]
    }
  }
}
```

Restart the client after changing its configuration. See [MCP for agents](https://syntheo.mintlify.site/docs/agents/mcp).

## Data access

The CLI and MCP server read the app's local database through Syntheo's compatibility layer; agents never touch SQLite directly. Neither sends data to a Syntheo server. Content the agent reads is sent to the model the agent uses. Agents cannot change a meeting directly: they stage proposals that you apply or decline in the desktop app. See [Data and privacy](https://syntheo.mintlify.site/docs/data-and-privacy).
