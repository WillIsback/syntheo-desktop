# Errors

## Meeting not found

List or search meetings again and use the returned ID. Do not retry a guessed ID.

## No meetings returned

An empty list means no meetings matched the query in the local database. It does not mean the database is unavailable. Try a shorter or different fragment. Do not invent meetings.

## Database not found

Run `syntheo --json doctor`. Ask the user to open Syntheo once if the database does not exist. If they keep data in a custom location, use `--db-path FILE` or `SYNTHEO_DB_PATH` after they provide the path.

## Database operation failed

Confirm the desktop app and CLI come from compatible revisions. Report the error to the user. Do not run migrations or write SQL from the agent.

## `syntheo` starts the desktop app

The `.deb` package installs the app as `/usr/bin/syntheo`. Call the CLI by its absolute path, usually `~/.cargo/bin/syntheo`, and use that path in MCP client configuration.

## Recording import refused

`Open the updated Syntheo desktop app before importing recordings` means the app is not running on the same database. Ask the user to open it, then retry with the same `--request-key`. Unsupported formats and unknown folders are also refused; use WAV, MP3, OGG, MP4, M4A, FLAC, WebM, or AAC, and a folder returned by `meetings folders`.

## Export output exists

Choose a new path. Pass `--force` only when the user explicitly approves replacing that exact file.

## MCP server exits

Run `syntheo --json meetings list` to distinguish database access from client configuration. Confirm the MCP command points to the CLI (not the desktop app) and its only required argument is `mcp`. Missing meetings, proposals, and imports are invalid parameters. Validation and conflict failures, including declining a non-pending proposal, are internal MCP errors.

With `--json`, errors contain `schema_version` and an `error` object with `code`, `message`, and `exit_code`. CLI exit codes are `1` for an operation failure, `2` for missing data, `3` for a missing database, and `4` for an existing export target. Invalid CLI arguments use Clap's exit code and the `invalid_arguments` error code. An expired `meetings import --wait` also exits `2`, without an error object; the job continues.
