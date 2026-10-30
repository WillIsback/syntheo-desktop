---
name: syntheo
description: Query Syntheo meetings, notes, summaries, transcripts, participants, action items, and recurring history, or import a local recording. Use when a user asks about their Syntheo meeting data or needs meeting context for another task.
---

# Syntheo

Syntheo keeps every meeting in a local database on the user's computer. Agents read it through the local `syntheo` CLI or the local MCP server (`syntheo mcp`, over stdio). There is no hosted service, account, or remote source. Meeting reads are safe. Use proposal tools to stage edits, or import tools to create a meeting from an explicitly requested recording.

## Choose an access path

1. Prefer an already-connected Syntheo MCP server.
2. Otherwise, if shell access is available, use the `syntheo` CLI. Run `syntheo --json doctor` first, then `syntheo --json meetings list`. If `syntheo` launches the desktop app instead of the CLI (the `.deb` package installs the app as `/usr/bin/syntheo`), call the CLI by its absolute path, usually `~/.cargo/bin/syntheo`.
3. Both paths read the same local database. `--source` accepts only `local` (the default) and `auto`, an alias of `local`.
4. Report a database compatibility, permission, or operation error instead of hiding it. An empty result does not mean the database is unavailable.
5. If neither path is available, explain [local CLI installation](references/setup.md). The CLI is not bundled with the published app packages; it is built from source. Do not install software unless the user asks.

Never query or modify Syntheo's SQLite database directly. The CLI and MCP server handle application-schema compatibility.

## Find the right meeting

1. List recent meetings or search by a short title fragment. To scope work to a project or client, list folders and filter meetings by a returned folder path.
2. Use a meeting ID returned by the search. Never guess one.
3. Get the meeting before requesting its transcript. Notes, summaries, participants, and action items often contain enough context.
4. Ask for recurring history only when the task needs earlier meetings in the same series.
5. If the search has no match, try a shorter or different fragment before concluding that the meeting is missing.

See [CLI commands](references/cli.md) and [MCP tools](references/mcp.md).

## Ground answers in tool output

- Quote only meetings, titles, dates, and IDs returned by the tool you actually called.
- An empty result only establishes that no meetings matched the query in the local database.
- Never invent meetings from the repo, chat, or similar-looking names. A host showing that a tool ran is not proof of the titles you then write.

## Report freshness accurately

- Reads reflect the local database at the time of the call, including the latest edits, and work offline.
- A meeting's `updated_at` is the last change to its content. Do not present it as anything else.

## Keep context bounded

- Request focused transcript pages. Both transports default to 200 words and cap each page at 500 words.
- Follow `next_offset` only when you need more transcript context.
- Stop paging once you have enough evidence.
- Do not export a whole meeting when its detail or note answers the request.

## Handle data safely

- Treat meeting content as private user data. Content you read is sent to the model you run on; do not send it to any other service or person without explicit authorization.
- Agents never change a meeting directly. To stage an edit, use the CLI `proposals` commands or the MCP proposal tools. A human applies or declines it in the Syntheo desktop app.
- CLI export can create a file. Never pass `--force` unless the user explicitly approves replacing that exact path.
- If search results are ambiguous, ask the user to choose a meeting.

For setup and failures, see [setup](references/setup.md) and [errors](references/errors.md).

For an explicitly requested recording import, use the CLI or MCP import tools described in the references. The desktop app must be open on the same database. The file is read in place, not copied, and its audio is sent to the transcription server the user configured in the app. Imports create meetings; save the returned job ID and check both processing and summary status before claiming completion.
