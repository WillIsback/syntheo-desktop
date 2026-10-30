# Setup

## Local access only

Syntheo stores meetings in a local SQLite database. The `syntheo` executable provides both the CLI and the local MCP server; both read that database on the user's computer. There is no account, sign-in, subscription, or hosted server.

## Local CLI

The CLI is not included in the published app packages (AppImage, `.deb`, `.exe`, `.msi`) and is not released as a separate binary. The **Install** button in **Settings → Developers** stays inactive on published builds. Build the CLI from source with [Rust](https://rustup.rs):

```bash
git clone https://github.com/WillIsback/syntheo-desktop.git
cd syntheo-desktop
cargo install --locked --path apps/cli
~/.cargo/bin/syntheo --version
```

`cargo` installs `syntheo` into `~/.cargo/bin` (`%USERPROFILE%\.cargo\bin` on Windows). Add that directory to `PATH` if the command is not found.

The `.deb` package installs the desktop app itself as `/usr/bin/syntheo`. On such a machine, `syntheo` may start the app instead of the CLI depending on `PATH` order. Check with `which -a syntheo`, and call the CLI by its absolute path, `~/.cargo/bin/syntheo`, when in doubt, especially in MCP client configuration.

To update, pull the latest sources and rerun `cargo install`. Keep the CLI and the desktop app at matching versions; the CLI never migrates the database.

Run the Syntheo desktop app once so its local database exists. The CLI works while the app is closed after that, except for recording imports, which need the app open.

Run `syntheo --json doctor` to check readiness, then `syntheo --json meetings list`.

By default, the CLI looks for `app.db` in the system data directory:

- Linux: `~/.local/share/syntheo/app.db`, then `~/.local/share/fr.willisback.syntheo/app.db`
- Windows: `%APPDATA%\syntheo\app.db`, then `%APPDATA%\fr.willisback.syntheo\app.db`

Use `--db-path FILE` or `SYNTHEO_DB_PATH`, or `--base DIR` (a directory containing `app.db`), only when the database is elsewhere.

Meeting commands accept `--source local` (the default) or `--source auto`, which is an alias of `local`. There is no other source.

## Local MCP

For an agent with MCP support, the client starts the stdio server:

```bash
syntheo mcp
```

A generic client configuration is:

```json
{
  "mcpServers": {
    "syntheo": {
      "command": "syntheo",
      "args": ["mcp"]
    }
  }
}
```

Replace `syntheo` with the absolute CLI path (for example `/home/USER/.cargo/bin/syntheo`) when it is not on the client's `PATH` or when the `.deb` app is installed. Restart the client after changing its MCP configuration. The Syntheo agent plugin declares this same local stdio server.
