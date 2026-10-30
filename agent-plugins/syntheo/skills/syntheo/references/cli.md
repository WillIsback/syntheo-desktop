# CLI commands

Use `--json` for agent-readable output. The CLI reads only the local database; it has no account, sign-in, or remote source.

If `syntheo` starts the desktop app instead of the CLI (the `.deb` package installs the app as `/usr/bin/syntheo`), replace `syntheo` in the examples with the absolute CLI path, usually `~/.cargo/bin/syntheo`.

```bash
syntheo --json doctor
syntheo --json meetings list --query "planning" --limit 20 --offset 0
syntheo --json meetings folders --query "clients"
syntheo --json meetings list --folder "Clients/ACME" --limit 20
syntheo --json meetings get MEETING_ID
syntheo --json meetings note MEETING_ID --kind note
syntheo --json meetings note MEETING_ID --kind summary
syntheo --json meetings history MEETING_ID --limit 20 --offset 0
syntheo --json proposals list --meeting MEETING_ID
syntheo --json proposals create --meeting MEETING_ID --kind summary --content "Replacement markdown"
syntheo --json proposals show PROPOSAL_ID
syntheo --json proposals decline PROPOSAL_ID
```

`proposals create` stages a pending edit. Do not claim the meeting changed. A human applies or declines it in the Syntheo desktop app.

Meeting commands accept `--source` before their subcommand (or `SYNTHEO_SOURCE`). `local` is the default; `auto` is kept as an alias of `local`. There is no other source. Meetings include `folder_path`, or `null` outside a folder.

`doctor` exits with status 1 when its response contains `ready: false`.

Read transcripts in bounded word pages:

```bash
syntheo --json meetings transcript MEETING_ID --limit 200 --offset 0
```

JSON success responses contain `schema_version`, `command`, `data`, and optional `pagination`. Continue from `pagination.next_offset` only when more context is necessary.

Export is intended for an explicit user request to save or transfer a complete meeting:

```bash
syntheo meetings export MEETING_ID --format markdown --output meeting.md
syntheo meetings export MEETING_ID --format json --output meeting.json
```

Export refuses to replace an existing file. Pass `--force` only after the user explicitly approves overwriting that exact path.

Markdown exports label transcript paragraphs with speaker names when word-level speaker information is available. Exports without that information retain flat text. JSON exports can include optional `speakers` and `speaker_context` fields.

Global database overrides:

```bash
syntheo --db-path /path/to/app.db --json meetings list
syntheo --base /path/to/syntheo-data --json meetings list
```

### Managed local capture

These commands serve administered deployments (legal hold, usage measurement) and work only on the local database. Syntheo never stores audio files, so anything about recording files (`recording_locations`, recording removal) is normally empty or has no effect.

`syntheo meetings capabilities` reports managed capture capabilities without opening a database.

`meetings initialize-managed` (`syntheo --json meetings --source local initialize-managed`) creates or migrates the local database before first desktop launch. It requires `--source local`, a closed desktop app, and an existing version 1 `managed_settings.json` beside `app.db` (a `settings` object) that sets `intelligence_disabled: true`. Only supported capture settings are accepted, and secrets are rejected. Malformed policy prevents database startup.

`meetings hold-list` (`syntheo --json meetings --source local hold-list`) requires `--json` and enumerates, in ID order, the meeting IDs retained in the database, including soft-deleted rows. Use `--limit 1..200` and `--after ID` for keyset pagination; an empty `data.ids` array ends the inventory. `--database-only` skips filesystem discovery.

`meetings hold-export` (`syntheo --json meetings --source local hold-export MEETING_ID`) requires `--json` and streams the meeting's database cells and revisions from one read transaction as NDJSON. Each line is bounded, and a final SHA-256 covers every preceding line. An absent end line means an incomplete snapshot. The archive excludes global settings, provider credentials, and unrelated meetings. With `--database-only`, it skips filesystem discovery and sets `recording_files_separate: true`. This preservation archive is separate from normal meeting export and must not enter knowledge intake.

`meetings pilot-usage` requires `--json` and `--source local`. Supply `--from-ms` and `--until-ms` as Unix milliseconds for a half-open UTC window of at most 366 days. It returns capture intervals and coverage counts (`unmeasured_stops`, `invalid_metadata_records`, `pending_sessions`, `legacy_sessions_without_measurement`) without meeting identifiers, text, titles, or participants. Empty results do not prove no meetings occurred. Nothing is uploaded.

`syntheo meetings delete` permanently removes a completed local meeting: its document history, transcripts, and derived search index. It requires `--source local`, `--if-export-sha256` (the SHA-256 of the complete JSON export, either as printed to stdout with its final newline or as saved with `--output`), and `--require-transcription-complete`. Close the desktop app first. A changed export, an unfinished transcript, or a pending proposal prevents deletion. An interrupted deletion can be resumed with the same meeting ID and hash. Run it only on an explicit user request.

## Import local audio

Use `syntheo --json meetings --source local import FILE --request-key KEY` only when the user asks to import a recording. The desktop app must be open on the same database. The app reads the file in place (it is not copied, so it must not be moved or deleted before the job finishes), sends the audio to the transcription server the user configured, then generates the summary with the configured LLM. Supported formats: WAV, MP3, OGG, MP4, M4A, FLAC, WebM, AAC; subtitle and transcript files (SRT/VTT) are not accepted.

Optional `--title`, `--folder` (existing folder), and `--wait --timeout 3600` are supported. Save `meeting_id` and `job_id`. Poll `syntheo --json meetings import-status JOB_ID`, or inspect `processing_status` and `recording_import` in `meetings get`. Timeout exit 2 does not cancel work. A completed import may report a skipped summary (`skipped_no_model`, `skipped_too_short`). Reuse the request key for retries; never silently create a second job after failure.
