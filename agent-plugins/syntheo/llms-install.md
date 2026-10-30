# Set up Syntheo agent access

1. Syntheo is local only: there is no hosted service, account, or sign-in. The `syntheo` CLI and its stdio MCP server (`syntheo mcp`) read the desktop app's local database.
2. Check that the CLI is installed with `syntheo --json doctor`. If `syntheo` starts the desktop app instead (the `.deb` package installs the app as `/usr/bin/syntheo`), use the absolute CLI path, usually `~/.cargo/bin/syntheo`, for every command below. If the CLI is missing, explain that it is built from source with `cargo install --locked --path apps/cli` from a clone of `https://github.com/WillIsback/syntheo-desktop`; do not install software without authorization.
3. If the agent supports MCP, configure a server named `syntheo` with the CLI executable as its command and arguments `["mcp"]`. Do not start it in an environment without the user's local database.
4. Confirm the MCP server lists `list_meetings`, `get_meeting`, `get_meeting_transcript`, `get_recurring_meeting_history`, and `export_meeting`, or read with `syntheo --json meetings list`. An empty search is not a missing database; report database errors instead of hiding them.
5. Never query or modify Syntheo's SQLite database directly.

Agents never change a meeting directly. Staging a note or summary edit creates a proposal that the user applies or declines in the desktop app. A meeting's `updated_at` is the last change to its content.
