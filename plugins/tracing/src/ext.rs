use std::path::PathBuf;

pub struct Tracing<'a, R: tauri::Runtime, M: tauri::Manager<R>> {
    manager: &'a M,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<'a, R: tauri::Runtime, M: tauri::Manager<R>> Tracing<'a, R, M> {
    pub fn logs_dir(&self) -> Result<PathBuf, crate::Error> {
        let logs_dir = self
            .manager
            .path()
            .app_log_dir()
            .map_err(|e| crate::Error::PathResolver(e.to_string()))?;
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| crate::Error::PathResolver(format!("create logs dir: {}", e)))?;
        Ok(logs_dir)
    }

    pub fn do_log(&self, level: Level, data: Vec<serde_json::Value>) -> Result<(), crate::Error> {
        let argument_count = data.len();
        let diagnostic = diagnostic_message(&data);
        let diagnostic = diagnostic.as_deref();
        match level {
            Level::Trace => {
                tracing::trace!(target: super::WEBVIEW_CONSOLE_TARGET, argument_count, diagnostic, "webview_console_event");
            }
            Level::Debug => {
                tracing::debug!(target: super::WEBVIEW_CONSOLE_TARGET, argument_count, diagnostic, "webview_console_event");
            }
            Level::Info => {
                tracing::info!(target: super::WEBVIEW_CONSOLE_TARGET, argument_count, diagnostic, "webview_console_event");
            }
            Level::Warn => {
                tracing::warn!(target: super::WEBVIEW_CONSOLE_TARGET, argument_count, diagnostic, "webview_console_event");
            }
            Level::Error => {
                tracing::error!(target: super::WEBVIEW_CONSOLE_TARGET, argument_count, diagnostic, "webview_console_event");
            }
        }
        Ok(())
    }
}

// `[render-perf]` : résumé des rendus pendant l'écoute, émis par les seuls
// builds devtools (`devtools-bar/render-perf.ts`) et fait uniquement de noms
// de code et de nombres.
const DIAGNOSTIC_PREFIXES: &[&str] = &["[cloudsync]", "[render-perf]"];
const DIAGNOSTIC_MAX_LEN: usize = 200;
const CODE_LABEL_MAX_LEN: usize = 40;
const ERROR_IDENTIFIER_MAX_LEN: usize = 64;
const MAX_ERROR_KINDS: usize = 4;

/// Console payloads are dropped from app.log for privacy. What survives is
/// limited to what the code itself wrote, never data:
/// - the leading literal of an allowlisted subsystem (`[cloudsync] …`);
/// - otherwise only the code label of the first argument (`[speaker-context]`
///   out of `"[speaker-context] observation failed"`), the rest of that string
///   being dropped since it may be interpolated;
/// - the name and code of `Error` arguments (`error=Error(ERR_SQLITE_ERROR)`),
///   serialized as `{"$error": {name, code}}` by [`JS_INIT_SCRIPT`]. Their
///   message, string errors and any other argument are never recorded.
///
/// Labels, names and codes must look like code identifiers, so free text that
/// merely starts with brackets is not logged either.
fn diagnostic_message(data: &[serde_json::Value]) -> Option<String> {
    let first = data.first().and_then(serde_json::Value::as_str);
    let label = first.and_then(|first| {
        if DIAGNOSTIC_PREFIXES
            .iter()
            .any(|prefix| first.starts_with(prefix))
        {
            let end = first
                .char_indices()
                .nth(DIAGNOSTIC_MAX_LEN)
                .map_or(first.len(), |(index, _)| index);
            Some(&first[..end])
        } else {
            code_label(first)
        }
    });
    let errors: Vec<String> = data
        .iter()
        .filter_map(error_kind)
        .take(MAX_ERROR_KINDS)
        .collect();
    let errors = (!errors.is_empty()).then(|| format!("error={}", errors.join(",")));
    match (label, errors) {
        (Some(label), Some(errors)) => Some(format!("{label} {errors}")),
        (Some(label), None) => Some(label.to_string()),
        (None, errors) => errors,
    }
}

/// `[module]` at the start of a console message, followed by more text.
fn code_label(message: &str) -> Option<&str> {
    let end = message.find(']')?;
    let inner = message.strip_prefix('[')?.get(..end - 1)?;
    let valid = !inner.is_empty()
        && inner.len() <= CODE_LABEL_MAX_LEN
        && inner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/".contains(&byte))
        && message[end + 1..].starts_with(' ');
    valid.then(|| &message[..=end])
}

fn error_kind(value: &serde_json::Value) -> Option<String> {
    let error = value.get("$error")?;
    let name = error.get("name")?.as_str().filter(|name| {
        name.len() <= ERROR_IDENTIFIER_MAX_LEN
            && name.starts_with(|first: char| first.is_ascii_alphabetic())
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    })?;
    let code = match error.get("code") {
        Some(serde_json::Value::Number(code)) => code.as_i64().map(|code| code.to_string()),
        Some(serde_json::Value::String(code))
            if !code.is_empty()
                && code.len() <= ERROR_IDENTIFIER_MAX_LEN
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)) =>
        {
            Some(code.clone())
        }
        _ => None,
    };
    Some(match code {
        Some(code) => format!("{name}({code})"),
        None => name.to_string(),
    })
}

impl<R: tauri::Runtime, M: tauri::Manager<R>> Tracing<'_, R, M> {
    pub fn log_content(&self) -> Result<Option<String>, crate::Error> {
        self.filtered_log_content(false)
    }

    pub fn filtered_log_content(
        &self,
        cloudsync_only: bool,
    ) -> Result<Option<String>, crate::Error> {
        let logs_dir = self.logs_dir()?;
        Ok(read_log_content(&logs_dir, cloudsync_only))
    }
}

const LOG_READ_CHUNK_BYTES: u64 = 64 * 1024;
const MAX_CONTINUATION_LINES: usize = 50;

fn read_log_content(logs_dir: &std::path::Path, cloudsync_only: bool) -> Option<String> {
    let target_records = if cloudsync_only { 100 } else { 300 };
    const MAX_ROTATED_FILES: usize = 5;

    let log_files = std::iter::once(logs_dir.join("app.log"))
        .chain((1..=MAX_ROTATED_FILES).map(|i| logs_dir.join(format!("app.log.{}", i))));

    let mut records: Vec<String> = Vec::new();

    'files: for log_path in log_files {
        let Ok(lines) = ReverseLines::open(&log_path) else {
            continue;
        };
        let mut continuation = std::collections::VecDeque::new();
        for line in lines {
            if line.is_empty() {
                continue;
            }
            if !is_record_start(&line) {
                continuation.push_back(line);
                if continuation.len() > MAX_CONTINUATION_LINES {
                    continuation.pop_front();
                }
                continue;
            }
            if cloudsync_only && !is_cloudsync_line(&line) {
                continuation.clear();
                continue;
            }
            let mut record = line;
            for continued in continuation.drain(..).rev() {
                record.push('\n');
                record.push_str(&continued);
            }
            records.push(record);
            if records.len() >= target_records {
                break 'files;
            }
        }
    }

    if records.is_empty() {
        return None;
    }

    records.reverse();
    Some(records.join("\n"))
}

fn is_record_start(line: &str) -> bool {
    let bytes = line.as_bytes();
    bytes.len() > 10
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
}

struct ReverseLines {
    file: std::fs::File,
    pos: u64,
    carry: Vec<u8>,
    lines: Vec<String>,
}

impl ReverseLines {
    fn open(path: &std::path::Path) -> std::io::Result<Self> {
        let file = std::fs::File::open(path)?;
        let pos = file.metadata()?.len();
        Ok(Self {
            file,
            pos,
            carry: Vec::new(),
            lines: Vec::new(),
        })
    }

    fn read_previous_chunk(&mut self) -> std::io::Result<()> {
        use std::io::{Read, Seek, SeekFrom};

        let len = self.pos.min(LOG_READ_CHUNK_BYTES);
        self.pos -= len;
        self.file.seek(SeekFrom::Start(self.pos))?;
        let mut chunk = vec![0; len as usize];
        self.file.read_exact(&mut chunk)?;
        chunk.append(&mut self.carry);

        let mut parts = chunk.split(|byte| *byte == b'\n');
        self.carry = parts.next().unwrap_or_default().to_vec();
        self.lines = parts.map(decode_line).collect();
        Ok(())
    }
}

impl Iterator for ReverseLines {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            if let Some(line) = self.lines.pop() {
                return Some(line);
            }
            if self.pos == 0 {
                return (!self.carry.is_empty())
                    .then(|| decode_line(&std::mem::take(&mut self.carry)));
            }
            self.read_previous_chunk().ok()?;
        }
    }
}

fn decode_line(bytes: &[u8]) -> String {
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

fn is_cloudsync_line(line: &str) -> bool {
    let Some((header, message)) = line.split_once(": ") else {
        return false;
    };
    let Some(target) = header.split_whitespace().last() else {
        return false;
    };
    ["db_core::cloudsync", "cloudsync"].iter().any(|namespace| {
        target == *namespace
            || target
                .strip_prefix(namespace)
                .is_some_and(|suffix| suffix.starts_with("::"))
    }) || ((target == "tauri_plugin_db" || target.starts_with("tauri_plugin_db::"))
        && message.to_ascii_lowercase().contains("cloudsync"))
        || (super::is_webview_console_target(target)
            && message.contains("diagnostic=\"[cloudsync]"))
}

pub trait TracingPluginExt<R: tauri::Runtime> {
    fn tracing(&self) -> Tracing<'_, R, Self>
    where
        Self: tauri::Manager<R> + Sized;
}

impl<R: tauri::Runtime, T: tauri::Manager<R>> TracingPluginExt<R> for T {
    fn tracing(&self) -> Tracing<'_, R, Self>
    where
        Self: Sized,
    {
        Tracing {
            manager: self,
            _runtime: std::marker::PhantomData,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub enum Level {
    #[serde(rename = "TRACE")]
    Trace,
    #[serde(rename = "DEBUG")]
    Debug,
    #[serde(rename = "INFO")]
    Info,
    #[serde(rename = "WARN")]
    Warn,
    #[serde(rename = "ERROR")]
    Error,
}

pub const JS_INIT_SCRIPT: &str = r#"
(function() {
    function initConsoleOverride() {
        if (typeof window.__TAURI__ === 'undefined' || 
            typeof window.__TAURI__.core === 'undefined' ||
            typeof window.__TAURI__.core.invoke === 'undefined') {
            setTimeout(initConsoleOverride, 10);
            return;
        }
        
        const originalLog = console.log.bind(console);
        const originalDebug = console.debug.bind(console);
        const originalInfo = console.info.bind(console);
        const originalWarn = console.warn.bind(console);
        const originalError = console.error.bind(console);
        
        const invoke = window.__TAURI__.core.invoke;
        // An Error only keeps its name and code: its message may quote meeting
        // content and is never logged (see `diagnostic_message`).
        const describe = (arg) => {
            if (!(arg instanceof Error)) return arg;
            const code = typeof arg.code === 'string' || typeof arg.code === 'number' ? arg.code : undefined;
            return { $error: { name: String(arg.name), code } };
        };
        const log = (level, ...args) => invoke('plugin:tracing|do_log', { level, data: args.map(describe) });
        
        console.log = (...args) => { originalLog(...args); log('INFO', ...args); };
        console.debug = (...args) => { originalDebug(...args); log('DEBUG', ...args); };
        console.info = (...args) => { originalInfo(...args); log('INFO', ...args); };
        console.warn = (...args) => { originalWarn(...args); log('WARN', ...args); };
        console.error = (...args) => { originalError(...args); log('ERROR', ...args); };
    }
    
    initConsoleOverride();
})();
"#;

#[cfg(test)]
mod tests {
    use rquickjs::{Context, Runtime};

    #[test]
    fn cloudsync_log_filters_before_limiting_and_reads_rotated_activity() {
        let temp = tempfile::tempdir().unwrap();
        let native =
            "2026-10-01T00:00:00Z INFO db_core::cloudsync::runtime::background: sync completed";
        let recovery = "2026-10-01T00:00:01Z WARN tauri_plugin_db::runtime::recovery: CloudSync recovery delayed";
        let console = "2026-10-01T00:00:02Z WARN syntheo.webview.console: webview_console_event diagnostic=\"[cloudsync] local sync configuration failed\"";
        let multiline = "2026-10-01T00:00:03Z WARN db_core::cloudsync::runtime: CloudSync failed\n  caused by: timed out";
        std::fs::write(
            temp.path().join("app.log.1"),
            (0..110)
                .map(|i| format!("{native} sequence={i}\n"))
                .collect::<String>(),
        )
        .unwrap();
        std::fs::write(
            temp.path().join("app.log"),
            format!(
                "{recovery}\n{console}\n{multiline}\n{}",
                "2026-10-01T00:00:04Z INFO unrelated: cloudsync mentioned in unrelated message\n  unrelated continuation\n"
                    .repeat(2_000)
            ),
        )
        .unwrap();
        let filtered = super::read_log_content(temp.path(), true).unwrap();
        let lines: Vec<_> = filtered.lines().collect();
        assert_eq!(lines.len(), 101);
        assert_eq!(lines[0], format!("{native} sequence=13"));
        assert_eq!(
            filtered.split_once(recovery).unwrap().1,
            format!("\n{console}\n{multiline}")
        );
        assert!(lines.iter().all(|line| !line.contains("unrelated")));
        let unfiltered = super::read_log_content(temp.path(), false).unwrap();
        assert_eq!(unfiltered.lines().count(), 600);
        assert!(unfiltered.lines().all(|line| line.contains("unrelated")));
    }

    #[test]
    fn diagnostic_message_keeps_only_allowlisted_leading_literal() {
        let data = vec![
            serde_json::json!("[cloudsync] local sync configuration failed; retrying"),
            serde_json::json!({ "message": "secret" }),
        ];
        assert_eq!(
            super::diagnostic_message(&data).as_deref(),
            Some("[cloudsync] local sync configuration failed; retrying")
        );

        assert_eq!(
            super::diagnostic_message(&[serde_json::json!("user typed something")]),
            None
        );
        assert_eq!(
            super::diagnostic_message(&[serde_json::json!({ "message": "[cloudsync] x" })]),
            None
        );
        assert_eq!(super::diagnostic_message(&[]), None);

        let long = [serde_json::json!(format!(
            "[cloudsync] {}",
            "é".repeat(400)
        ))];
        let truncated = super::diagnostic_message(&long).unwrap();
        assert_eq!(truncated.chars().count(), super::DIAGNOSTIC_MAX_LEN);
    }

    #[test]
    fn diagnostic_message_keeps_render_perf_summaries() {
        let summary =
            "[render-perf] component seq=3 name=SessionLevelMeter zone=capsule renders=100";
        assert_eq!(
            super::diagnostic_message(&[serde_json::json!(summary)]).as_deref(),
            Some(summary)
        );
    }

    #[test]
    fn diagnostic_message_keeps_code_labels_and_error_kinds_only() {
        // A periodic `console.error("[speaker-context] observation failed", error)`
        // must say where it comes from and what failed (issue #268)…
        let data = vec![
            serde_json::json!("[speaker-context] observation failed for Réunion Alice"),
            serde_json::json!({ "$error": { "name": "Error", "code": "ERR_SQLITE_ERROR" } }),
        ];
        assert_eq!(
            super::diagnostic_message(&data).as_deref(),
            Some("[speaker-context] error=Error(ERR_SQLITE_ERROR)")
        );
        // …without the rest of the message, string errors or anything that
        // does not look like a code identifier.
        assert_eq!(
            super::diagnostic_message(&[
                serde_json::json!("[listener] audio recovery deferred"),
                serde_json::json!("no such table: Réunion Alice"),
                serde_json::json!({ "$error": { "name": "Bonjour Alice", "code": "a b" } }),
                serde_json::json!({ "$error": { "name": "AbortError", "code": 20 } }),
            ])
            .as_deref(),
            Some("[listener] error=AbortError(20)")
        );
        assert_eq!(
            super::diagnostic_message(&[
                serde_json::json!("query failed"),
                serde_json::json!({ "$error": { "name": "TypeError" } }),
            ])
            .as_deref(),
            Some("error=TypeError")
        );
        for not_a_label in [
            "[Réunion avec Alice] notes",
            "[alice bob] x",
            "[] x",
            "[speaker-context]",
            "speaker-context] x",
        ] {
            assert_eq!(
                super::diagnostic_message(&[serde_json::json!(not_a_label)]),
                None,
                "{not_a_label}"
            );
        }
        assert_eq!(
            super::diagnostic_message(&[
                serde_json::json!("[cloudsync] local sync configuration failed"),
                serde_json::json!({ "$error": { "name": "Error" } }),
            ])
            .as_deref(),
            Some("[cloudsync] local sync configuration failed error=Error")
        );
    }

    #[test]
    fn console_override_sends_error_kind_but_not_error_message() {
        let (_rt, ctx) = setup_runtime();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(
                r#"
                globalThis.window = globalThis;
                globalThis.setTimeout = function(fn) { fn(); };
                globalThis.console = { log() {}, debug() {}, info() {}, warn() {}, error() {} };
                globalThis.sent = [];
                globalThis.window.__TAURI__ = { core: { invoke: function(_cmd, payload) {
                    globalThis.sent.push(payload);
                    return Promise.resolve();
                } } };
            "#,
            )
            .unwrap();
            ctx.eval::<(), _>(super::JS_INIT_SCRIPT).unwrap();
            let sent: String = ctx
                .eval(
                    r#"
                    const error = new TypeError("secret meeting title");
                    error.code = "ERR_X";
                    console.error("[speaker-context] observation failed", error);
                    JSON.stringify(globalThis.sent)
                "#,
                )
                .unwrap();
            assert_eq!(
                sent,
                r#"[{"level":"ERROR","data":["[speaker-context] observation failed",{"$error":{"name":"TypeError","code":"ERR_X"}}]}]"#
            );
        });
    }

    fn setup_runtime() -> (Runtime, Context) {
        let runtime = Runtime::new().unwrap();
        let context = Context::full(&runtime).unwrap();
        context.with(|_ctx| {});
        (runtime, context)
    }

    #[test]
    fn test_js_init_script() {
        let (_rt, ctx) = setup_runtime();
        ctx.with(|ctx| {
            let setup = r#"
                globalThis.window = globalThis;
                globalThis.setTimeout = function(fn, delay) { fn(); };
                
                if (typeof globalThis.console === 'undefined') {
                    globalThis.console = {
                        log: function() {},
                        debug: function() {},
                        info: function() {},
                        warn: function() {},
                        error: function() {}
                    };
                }
                
                globalThis.window.__TAURI__ = {
                    core: {
                        invoke: function() { return Promise.resolve(); }
                    }
                };
            "#;
            ctx.eval::<(), _>(setup).unwrap();
            ctx.eval::<(), _>(super::JS_INIT_SCRIPT).unwrap();

            let console_methods_exist: bool = ctx
                .eval(
                    r#"
                    typeof console !== 'undefined' && 
                    typeof console.log === 'function' &&
                    typeof console.debug === 'function' &&
                    typeof console.info === 'function' &&
                    typeof console.warn === 'function' &&
                    typeof console.error === 'function'
                "#,
                )
                .unwrap();

            assert!(
                console_methods_exist,
                "All console methods should be defined"
            );
        });
    }
}
