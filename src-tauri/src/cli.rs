//! Logged-in agent CLIs (Claude Code, Codex, Antigravity) as text providers. The app runs the CLI in its
//! non-interactive print mode with every tool switched off and keeps only the final message, so a
//! subscription can write items without an API key. Nothing from the user's projects reaches the
//! model: the CLI runs in an empty temporary directory, without MCP servers or settings files.
//!
//! A call can belong to a generation job (src/lib/jobStore.ts). The job's CLI processes are kept per job, so cancelling
//! the job ends the one it is waiting on, with every process that one started, and refuses the job's later calls.
//! Runs outside a job are kept too (never cancelled), so the app's exit can end every CLI it started.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

pub const CLI_PROVIDERS: [&str; 3] = ["claude-cli", "codex-cli", "antigravity-cli"];
/// Agentic CLIs put tools in front of the model; headless mode cannot grant them, and a model that tries to count
/// words with a command ends the turn with no answer. Said once at the top of every prompt.
const NO_TOOLS: &str = "Answer directly in this one message. Do not use any tool, command, file, browser or search; do not count with a program, estimate the counts yourself. Your whole reply is the answer itself.";
/// Item writing with a thinking model can take a few minutes; a whole exam is many such calls.
const RUN_TIMEOUT: Duration = Duration::from_secs(600);
const STATUS_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

/// What a cancelled job's calls end with; the page shows it as is (src/lib/ai.ts has the same text).
pub const CANCELLED: &str = "취소했습니다.";
/// A job with no CLI running is forgotten after this long, in case the page never ends it (a reload mid-run).
const IDLE_JOB: Duration = Duration::from_secs(60 * 60);
/// Where CLI runs outside any job (explanations, the converter, status checks) are kept, so the app's exit can end
/// them too. Never cancelled or ended by name.
const UNTAGGED: &str = "\u{1}untagged";

struct JobEntry {
    cancelled: bool,
    pids: Vec<u32>,
    touched: Instant,
}

impl JobEntry {
    fn new(now: Instant) -> Self {
        JobEntry { cancelled: false, pids: Vec::new(), touched: now }
    }
}

/// The CLI processes of each generation job. A job is known from its first call until the page ends it.
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, JobEntry>>);

static JOBS: LazyLock<Jobs> = LazyLock::new(Jobs::default);

impl Jobs {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, JobEntry>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn prune_locked(map: &mut HashMap<String, JobEntry>, now: Instant) {
        map.retain(|_, e| !e.pids.is_empty() || now.saturating_duration_since(e.touched) < IDLE_JOB);
    }

    /// A call of the job is about to start: refused once the job is cancelled.
    fn begin(&self, job: &str) -> Result<(), String> {
        let now = Instant::now();
        let mut map = self.lock();
        Self::prune_locked(&mut map, now);
        let e = map.entry(job.to_string()).or_insert_with(|| JobEntry::new(now));
        if e.cancelled {
            return Err(CANCELLED.into());
        }
        e.touched = now;
        Ok(())
    }

    /// A CLI process started for the job; refused when the job was cancelled meanwhile (the caller ends the process).
    fn register(&self, job: &str, pid: u32) -> Result<(), String> {
        let now = Instant::now();
        let mut map = self.lock();
        let e = map.entry(job.to_string()).or_insert_with(|| JobEntry::new(now));
        if e.cancelled {
            return Err(CANCELLED.into());
        }
        e.pids.push(pid);
        e.touched = now;
        Ok(())
    }

    fn unregister(&self, job: &str, pid: u32) {
        if let Some(e) = self.lock().get_mut(job) {
            e.pids.retain(|&p| p != pid);
            e.touched = Instant::now();
        }
    }

    /// Marks the job cancelled and hands back the processes to end. A job not seen yet (cancelled before its first
    /// call) is recorded as cancelled, so that call is refused; the page's end, or the idle expiry, removes it.
    fn cancel(&self, job: &str) -> Vec<u32> {
        if job == UNTAGGED {
            return Vec::new();
        }
        let now = Instant::now();
        let mut map = self.lock();
        let e = map.entry(job.to_string()).or_insert_with(|| JobEntry::new(now));
        e.cancelled = true;
        e.touched = now;
        e.pids.clone()
    }

    fn is_cancelled(&self, job: &str) -> bool {
        self.lock().get(job).is_some_and(|e| e.cancelled)
    }

    /// Forgets an ended job. The untagged runs are not a job: dropping them would let the app's exit miss them.
    fn end(&self, job: &str) {
        if job == UNTAGGED {
            return;
        }
        self.lock().remove(job);
    }

    /// Cancels every job and hands back all their processes, for the app's exit.
    fn cancel_all(&self) -> Vec<u32> {
        self.lock()
            .values_mut()
            .flat_map(|e| {
                e.cancelled = true;
                e.pids.clone()
            })
            .collect()
    }

    #[cfg(test)]
    fn prune(&self, now: Instant) {
        Self::prune_locked(&mut self.lock(), now);
    }

    #[cfg(test)]
    fn pids(&self, job: &str) -> Vec<u32> {
        self.lock().get(job).map(|e| e.pids.clone()).unwrap_or_default()
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().len()
    }
}

/// Keeps a CLI process in its job's list for as long as the call runs, however the call ends.
struct Tracked<'a> {
    job: &'a str,
    pid: u32,
}

impl Drop for Tracked<'_> {
    fn drop(&mut self) {
        JOBS.unregister(self.job, self.pid);
    }
}

/// Ends a process and every process it started (an npm `.cmd` shim runs node, which runs the CLI).
fn kill_tree(pid: u32) -> Result<(), String> {
    let mut cmd;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        cmd = std::process::Command::new("kill");
        cmd.args(["-9", &pid.to_string()]);
    }
    // A process that ended by itself meanwhile makes the command fail, which is fine; only a command that cannot
    // run at all is an error.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|_| ())
        .map_err(|e| format!("실행 중인 AI를 끝내지 못했습니다: {e}"))
}

/// `kill_tree` waits for taskkill; off the async workers.
async fn end_trees(pids: Vec<u32>) -> Result<(), String> {
    let errors = tauri::async_runtime::spawn_blocking(move || pids.into_iter().filter_map(|p| kill_tree(p).err()).collect::<Vec<_>>())
        .await
        .map_err(|e| format!("실행 중인 AI를 끝내지 못했습니다: {e}"))?;
    if errors.is_empty() { Ok(()) } else { Err(errors.join(" ")) }
}

/// Cancels a generation job: ends the CLI it runs (with what that CLI started) and refuses its later calls.
#[tauri::command]
pub async fn ai_cancel_job(job: String) -> Result<(), String> {
    end_trees(JOBS.cancel(&job)).await
}

/// Forgets a job that has ended.
#[tauri::command]
pub fn ai_end_job(job: String) {
    JOBS.end(&job);
}

/// For the app's exit: the window's event loop ends the process with `std::process::exit`, so running tasks are never
/// dropped and `kill_on_drop` never fires; a CLI would run on (and spend quota) after the window closed. Ends the
/// generation jobs' CLIs and the untagged ones.
pub fn end_all_jobs() {
    for pid in JOBS.cancel_all() {
        if let Err(e) = kill_tree(pid) {
            eprintln!("{e}");
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CliRun {
    pub text: String,
    pub model: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub path: String,
    pub version: Option<String>,
    /// None when the CLI gave no usable answer.
    pub logged_in: Option<bool>,
    pub account: Option<String>,
    /// Models the CLI lists, when it has a listing command (Codex, Antigravity); checked in the same pass.
    pub models: Option<Vec<String>>,
}

pub fn is_cli(provider: &str) -> bool {
    CLI_PROVIDERS.contains(&provider)
}

fn label(provider: &str) -> &'static str {
    match provider {
        "codex-cli" => "Codex CLI",
        "antigravity-cli" => "Antigravity CLI",
        _ => "Claude Code",
    }
}

fn exe_names(provider: &str) -> &'static [&'static str] {
    match provider {
        "codex-cli" => &["codex.exe", "codex.cmd", "codex"],
        "antigravity-cli" => &["agy.exe", "agy.cmd", "agy"],
        _ => &["claude.exe", "claude.cmd", "claude"],
    }
}

/// Where the official installers put the binaries when they are not on PATH.
fn known_locations(provider: &str) -> Vec<PathBuf> {
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let mut out = Vec::new();
    if provider == "codex-cli" {
        if let Some(d) = var("LOCALAPPDATA") {
            out.push(d.join("Programs").join("OpenAI").join("Codex").join("bin").join("codex.exe"));
        }
        if let Some(d) = var("APPDATA") {
            out.push(d.join("npm").join("codex.cmd"));
        }
    } else if provider == "antigravity-cli" {
        if let Some(d) = var("LOCALAPPDATA") {
            out.push(d.join("agy").join("bin").join("agy.exe"));
        }
    } else {
        if let Some(d) = var("USERPROFILE") {
            out.push(d.join(".local").join("bin").join("claude.exe"));
        }
        if let Some(d) = var("APPDATA") {
            out.push(d.join("npm").join("claude.cmd"));
        }
    }
    out
}

fn install_hint(provider: &str) -> String {
    if provider == "codex-cli" {
        "Codex CLI 실행 파일을 찾을 수 없습니다. `npm install -g @openai/codex`로 설치하고 `codex login`으로 로그인하거나, 설정에서 실행 파일 경로를 직접 입력해 주십시오.".into()
    } else if provider == "antigravity-cli" {
        "Antigravity CLI(agy) 실행 파일을 찾을 수 없습니다. Antigravity를 설치하고 터미널에서 `agy`를 실행해 로그인하거나, 설정에서 실행 파일 경로를 직접 입력해 주십시오.".into()
    } else {
        "Claude Code 실행 파일을 찾을 수 없습니다. https://claude.com/claude-code 에서 설치하고 `claude`를 실행해 로그인하거나, 설정에서 실행 파일 경로를 직접 입력해 주십시오.".into()
    }
}

/// The executable for a provider: the explicit path when given, otherwise PATH, then the usual install locations.
pub fn resolve(provider: &str, explicit: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(p);
        return if path.is_file() { Ok(path) } else { Err(format!("{} 실행 파일이 없습니다: {p}", label(provider))) };
    }
    let names = exe_names(provider);
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for n in names {
                let cand = dir.join(n);
                if cand.is_file() {
                    return Ok(cand);
                }
            }
        }
    }
    known_locations(provider).into_iter().find(|p| p.is_file()).ok_or_else(|| install_hint(provider))
}

fn command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    // Claude Code refuses to nest inside another Claude Code session; the app is not one.
    cmd.env_remove("CLAUDECODE");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

struct Output {
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

async fn read_all<R: AsyncRead + Unpin>(pipe: Option<R>) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    if let Some(mut p) = pipe {
        p.read_to_end(&mut buf).await?;
    }
    Ok(buf)
}

async fn run(mut cmd: Command, stdin_text: Option<&str>, timeout: Duration, what: &str, job: Option<&str>) -> Result<Output, String> {
    let mut child = cmd.spawn().map_err(|e| format!("{what}을(를) 실행하지 못했습니다: {e}"))?;
    let pid = child.id();
    // Every run is listed (a job's under its id, the rest untagged) so a cancel or the app's exit can end it.
    // Declared after the child so it is dropped first: the PID leaves the list while this handle still holds the
    // process, so nothing can end an unrelated process that was given the same number.
    let _tracked = match pid {
        Some(pid) => {
            let key = job.unwrap_or(UNTAGGED);
            if let Err(e) = JOBS.register(key, pid) {
                let _ = end_trees(vec![pid]).await;
                return Err(e);
            }
            Some(Tracked { job: key, pid })
        }
        None => None,
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(text) = stdin_text {
            // A CLI that exits early (not logged in) closes the pipe; the exit status says why.
            let _ = stdin.write_all(text.as_bytes()).await;
        }
        drop(stdin);
    }
    let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
    let waited = tokio::time::timeout(timeout, async { tokio::try_join!(child.wait(), read_all(stdout), read_all(stderr)) }).await;
    if waited.is_err() {
        // kill_on_drop ends only the direct child; under an npm `.cmd` shim, node (the CLI itself) would run on.
        if let Some(pid) = pid {
            let _ = end_trees(vec![pid]).await;
        }
    }
    // The job's cancel ended this CLI on purpose; what it printed on the way out is no answer.
    if job.is_some_and(|j| JOBS.is_cancelled(j)) {
        return Err(CANCELLED.into());
    }
    let (status, stdout, stderr) = waited
        .map_err(|_| format!("{what}이(가) {}초 안에 끝나지 않아 중단했습니다.", timeout.as_secs()))?
        .map_err(|e| format!("{what} 실행 중 오류: {e}"))?;
    Ok(Output {
        status: status.code(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// An empty working directory per run, so the CLI finds no project files and leaves none behind.
fn scratch_dir() -> Result<PathBuf, String> {
    let n = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("toeicer-cli-{}-{stamp}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("임시 폴더를 만들지 못했습니다: {e}"))?;
    Ok(dir)
}

fn tail(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= n { t.to_string() } else { t.chars().rev().take(n).collect::<Vec<_>>().into_iter().rev().collect() }
}

fn login_hint(provider: &str, text: &str) -> Option<String> {
    let t = text.to_ascii_lowercase();
    if !(t.contains("not logged in")
        || t.contains("please log in")
        || t.contains("login required")
        || t.contains("not authenticated")
        || t.contains("unauthenticated")
        || t.contains("please sign in"))
    {
        return None;
    }
    Some(if provider == "codex-cli" {
        "Codex CLI에 로그인되어 있지 않습니다. 터미널에서 `codex login`을 실행한 뒤 다시 시도해 주십시오.".into()
    } else if provider == "antigravity-cli" {
        "Antigravity CLI에 로그인되어 있지 않습니다. 터미널에서 `agy`를 실행해 Google 계정으로 로그인한 뒤 다시 시도해 주십시오.".into()
    } else {
        "Claude Code에 로그인되어 있지 않습니다. 터미널에서 `claude`를 실행하고 /login으로 로그인한 뒤 다시 시도해 주십시오.".into()
    })
}

/// How hard and how fast the model works: `effort` is low/medium/high/xhigh/max (every CLI takes it), `speed` is
/// Codex's service tier (priority, flex); empty means the CLI's own default.
#[derive(Debug, Default, Clone)]
pub struct Tuning {
    pub effort: String,
    pub speed: String,
}

/// The command-line switches for a tuning, per CLI.
fn tuning_args(provider: &str, t: &Tuning) -> Vec<String> {
    let effort = t.effort.trim();
    let speed = t.speed.trim();
    let mut args = Vec::new();
    match provider {
        "codex-cli" => {
            if !effort.is_empty() {
                args.extend(["-c".to_string(), format!("model_reasoning_effort=\"{effort}\"")]);
            }
            if !speed.is_empty() {
                args.extend(["-c".to_string(), format!("service_tier=\"{speed}\"")]);
            }
        }
        _ => {
            if !effort.is_empty() {
                args.extend(["--effort".to_string(), effort.to_string()]);
            }
        }
    }
    args
}

/// One completion through the chosen CLI; `job` makes it part of a generation job that can be cancelled.
pub async fn complete(provider: &str, explicit_path: Option<&str>, model: &str, tuning: &Tuning, system: &str, prompt: &str, job: Option<&str>) -> Result<CliRun, String> {
    // A cancelled job's calls stop here, before anything is started.
    if let Some(j) = job {
        JOBS.begin(j)?;
    }
    let path = resolve(provider, explicit_path)?;
    let dir = scratch_dir()?;
    let result = match provider {
        "codex-cli" => codex(&path, &dir, model, tuning, system, prompt, job).await,
        "antigravity-cli" => antigravity(&path, &dir, model, tuning, system, prompt, job).await,
        _ => claude(&path, &dir, model, tuning, system, prompt, job).await,
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

async fn claude(path: &Path, dir: &Path, model: &str, tuning: &Tuning, system: &str, prompt: &str, job: Option<&str>) -> Result<CliRun, String> {
    let mut cmd = command(path);
    cmd.current_dir(dir);
    // Print mode, one turn, no tools, no MCP servers, no settings files, nothing saved: a plain model call.
    cmd.args(["-p", "--no-session-persistence", "--output-format", "json", "--tools", "", "--max-turns", "1", "--strict-mcp-config", "--setting-sources", ""]);
    cmd.args(tuning_args("claude-cli", tuning));
    if !model.trim().is_empty() {
        cmd.args(["--model", model.trim()]);
    }
    if !system.trim().is_empty() {
        // A file, so neither the command-line length limit nor quoting touches the prompt.
        let sys_file = dir.join("system.txt");
        std::fs::write(&sys_file, system).map_err(|e| format!("시스템 프롬프트 파일을 쓰지 못했습니다: {e}"))?;
        cmd.arg("--system-prompt-file").arg(&sys_file);
    }
    let out = run(cmd, Some(prompt), RUN_TIMEOUT, "Claude Code", job).await?;
    parse_claude(&out.stdout, &out.stderr, out.status, model)
}

fn parse_claude(stdout: &str, stderr: &str, status: Option<i32>, requested: &str) -> Result<CliRun, String> {
    let v: Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(_) => {
            let detail = tail(if stderr.trim().is_empty() { stdout } else { stderr }, 400);
            return Err(login_hint("claude-cli", &detail).unwrap_or_else(|| format!("Claude Code가 결과를 돌려주지 않았습니다 (종료 코드 {status:?}). {detail}")));
        }
    };
    let text = v["result"].as_str().unwrap_or("").to_string();
    if v["is_error"].as_bool() == Some(true) || status.is_some_and(|c| c != 0) {
        let detail = tail(if text.is_empty() { stderr } else { &text }, 400);
        return Err(login_hint("claude-cli", &detail).unwrap_or_else(|| format!("Claude Code 오류: {detail}")));
    }
    let model = v["modelUsage"]
        .as_object()
        .and_then(|m| m.keys().next().cloned())
        .unwrap_or_else(|| if requested.trim().is_empty() { "claude (기본 모델)".into() } else { requested.trim().into() });
    let u = &v["usage"];
    let sum = |keys: &[&str]| -> Option<u64> {
        let vals: Vec<u64> = keys.iter().filter_map(|k| u[*k].as_u64()).collect();
        if vals.is_empty() { None } else { Some(vals.iter().sum()) }
    };
    Ok(CliRun {
        text,
        model,
        input_tokens: sum(&["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]),
        output_tokens: sum(&["output_tokens"]),
    })
}

async fn codex(path: &Path, dir: &Path, model: &str, tuning: &Tuning, system: &str, prompt: &str, job: Option<&str>) -> Result<CliRun, String> {
    let last = dir.join("last.txt");
    let mut cmd = command(path);
    cmd.current_dir(dir);
    // Non-interactive, nothing persisted, a read-only sandbox in an empty folder, events as JSON lines.
    cmd.args(["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--json"]);
    cmd.args(tuning_args("codex-cli", tuning));
    cmd.arg("-C").arg(dir).arg("-o").arg(&last);
    if !model.trim().is_empty() {
        cmd.args(["-m", model.trim()]);
    }
    cmd.arg("-");
    // Codex exec has no system prompt switch; the instructions lead the single user message.
    let stdin = if system.trim().is_empty() { format!("{NO_TOOLS}\n\n{prompt}") } else { format!("{}\n\n{NO_TOOLS}\n\n{prompt}", system.trim()) };
    let out = run(cmd, Some(&stdin), RUN_TIMEOUT, "Codex CLI", job).await?;
    let last_text = std::fs::read_to_string(&last).unwrap_or_default();
    parse_codex(&out.stdout, &out.stderr, out.status, &last_text, model)
}

fn parse_codex(stdout: &str, stderr: &str, status: Option<i32>, last_message: &str, requested: &str) -> Result<CliRun, String> {
    let mut text = last_message.trim().to_string();
    let mut input_tokens = None;
    let mut output_tokens = None;
    let mut error = None;
    for line in stdout.lines().filter(|l| l.trim_start().starts_with('{')) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match v["type"].as_str() {
            Some("item.completed") if v["item"]["type"] == "agent_message" => {
                if text.is_empty() {
                    text = v["item"]["text"].as_str().unwrap_or("").trim().to_string();
                }
            }
            Some("turn.completed") => {
                let u = &v["usage"];
                input_tokens = u["input_tokens"].as_u64().map(|n| n + u["cached_input_tokens"].as_u64().unwrap_or(0));
                output_tokens = u["output_tokens"].as_u64().map(|n| n + u["reasoning_output_tokens"].as_u64().unwrap_or(0));
            }
            Some("error") | Some("turn.failed") => {
                error = v["message"].as_str().or_else(|| v["error"]["message"].as_str()).map(String::from);
            }
            _ => {}
        }
    }
    if text.is_empty() {
        let detail = error.unwrap_or_else(|| tail(if stderr.trim().is_empty() { stdout } else { stderr }, 400));
        return Err(login_hint("codex-cli", &detail).unwrap_or_else(|| format!("Codex CLI가 결과를 돌려주지 않았습니다 (종료 코드 {status:?}). {detail}")));
    }
    Ok(CliRun {
        text,
        model: if requested.trim().is_empty() { "codex (기본 모델)".into() } else { requested.trim().into() },
        input_tokens,
        output_tokens,
    })
}

async fn antigravity(path: &Path, dir: &Path, model: &str, tuning: &Tuning, system: &str, prompt: &str, job: Option<&str>) -> Result<CliRun, String> {
    let mut cmd = command(path);
    cmd.current_dir(dir);
    // One user message as JSON on stdin (no command-line length limit), events as JSON lines, no slash expansion.
    cmd.args(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]);
    cmd.args(tuning_args("antigravity-cli", tuning));
    if !model.trim().is_empty() {
        cmd.args(["--model", model.trim()]);
    }
    let content = if system.trim().is_empty() { format!("{NO_TOOLS}\n\n{prompt}") } else { format!("{}\n\n{NO_TOOLS}\n\n{prompt}", system.trim()) };
    let line = format!("{}\n", serde_json::json!({ "event": "user", "message": { "role": "user", "content": content } }));
    let out = run(cmd, Some(&line), RUN_TIMEOUT, "Antigravity CLI", job).await?;
    parse_antigravity(&out.stdout, &out.stderr, out.status, model)
}

fn parse_antigravity(stdout: &str, stderr: &str, status: Option<i32>, requested: &str) -> Result<CliRun, String> {
    let result = stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .filter(|v| v["event"] == "result")
        .last()
        .map(|v| v["result"].clone());
    let Some(r) = result else {
        let detail = tail(if stderr.trim().is_empty() { stdout } else { stderr }, 400);
        return Err(login_hint("antigravity-cli", &detail).unwrap_or_else(|| format!("Antigravity CLI가 결과를 돌려주지 않았습니다 (종료 코드 {status:?}). {detail}")));
    };
    let text = r["response"].as_str().unwrap_or("").trim().to_string();
    if r["status"] != "SUCCESS" || text.is_empty() {
        let detail = r["error"].as_str().filter(|s| !s.trim().is_empty()).map(String::from).unwrap_or_else(|| tail(if stderr.trim().is_empty() { stdout } else { stderr }, 400));
        if let Some(hint) = login_hint("antigravity-cli", &detail) {
            return Err(hint);
        }
        if detail.contains("permission") {
            return Err("Antigravity CLI의 모델이 도구를 쓰려다 멈춰 답을 내지 못했습니다(비대화형에서는 도구가 허용되지 않음). 다시 시도해 주십시오.".into());
        }
        return Err(format!("Antigravity CLI 오류: {detail}"));
    }
    let u = &r["usage"];
    Ok(CliRun {
        text,
        model: if requested.trim().is_empty() { "antigravity (기본 모델)".into() } else { requested.trim().into() },
        input_tokens: u["input_tokens"].as_u64().map(|n| n + u["cache_read_tokens"].as_u64().unwrap_or(0)),
        output_tokens: u["output_tokens"].as_u64(),
    })
}

/// The models a CLI can list (Antigravity only: `agy models` prints "id<TAB>label" lines).
pub async fn models(provider: &str, explicit_path: Option<&str>) -> Result<Vec<String>, String> {
    let path = resolve(provider, explicit_path)?;
    let what = label(provider);
    let mut cmd = command(&path);
    let ids = match provider {
        "antigravity-cli" => {
            cmd.arg("models");
            let out = run(cmd, None, STATUS_TIMEOUT, what, None).await?;
            let ids = parse_model_list(&out.stdout);
            if ids.is_empty() {
                let detail = tail(if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr }, 300);
                return Err(login_hint(provider, &detail).unwrap_or_else(|| format!("{what}가 모델 목록을 주지 않았습니다. {detail}")));
            }
            ids
        }
        "codex-cli" => {
            cmd.args(["debug", "models"]);
            let out = run(cmd, None, STATUS_TIMEOUT, what, None).await?;
            let ids = parse_codex_catalog(&out.stdout, codex_config_model().as_deref());
            if ids.is_empty() {
                let detail = tail(if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr }, 300);
                return Err(login_hint(provider, &detail).unwrap_or_else(|| format!("{what}가 모델 목록을 주지 않았습니다. {detail}")));
            }
            ids
        }
        // Claude Code has no listing command; it takes the size aliases, which the app suggests itself.
        _ => return Err("Claude Code는 모델 목록을 제공하지 않습니다. fable·opus·sonnet·haiku 별칭이나 전체 이름을 입력하세요.".into()),
    };
    Ok(ids)
}

fn parse_model_list(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|l| l.split_once('\t').map(|(id, _)| id.trim().to_string()))
        .filter(|id| !id.is_empty() && !id.contains(' '))
        .collect()
}

/// `codex debug models` prints `{"models":[{slug, visibility, priority, …}]}`. Listed models first by priority;
/// hidden ones (internal, review-only) are left out. The config's own default goes first when it is not listed,
/// since Codex accepts it even when the catalog does not show it.
fn parse_codex_catalog(stdout: &str, config_model: Option<&str>) -> Vec<String> {
    let start = stdout.find('{').unwrap_or(0);
    let v: Value = match serde_json::from_str(&stdout[start..]) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut listed: Vec<(i64, String)> = v["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|m| m["visibility"].as_str().map(|s| s != "hide").unwrap_or(true))
                .filter_map(|m| m["slug"].as_str().map(|s| (m["priority"].as_i64().unwrap_or(i64::MAX), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    listed.sort();
    let mut ids: Vec<String> = Vec::new();
    if let Some(c) = config_model.map(str::trim).filter(|c| !c.is_empty()) {
        ids.push(c.to_string());
    }
    for (_, s) in listed {
        if !ids.contains(&s) {
            ids.push(s);
        }
    }
    ids
}

/// `model = "…"` from ~/.codex/config.toml (or $CODEX_HOME), the model Codex uses when the app names none.
fn codex_config_model() -> Option<String> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join(".codex")))?;
    let text = std::fs::read_to_string(home.join("config.toml")).ok()?;
    parse_toml_model(&text)
}

fn parse_toml_model(text: &str) -> Option<String> {
    // Only the top-level key counts: `[profiles.x]` sections also carry `model =`.
    text.lines()
        .take_while(|l| !l.trim_start().starts_with('['))
        .filter_map(|l| l.split_once('='))
        .find(|(k, _)| k.trim() == "model")
        .map(|(_, v)| v.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|v| !v.is_empty())
}

/// Whether the CLI is installed and signed in; cheap commands only, no model call.
pub async fn status(provider: &str, explicit_path: Option<&str>) -> Result<CliStatus, String> {
    let path = resolve(provider, explicit_path)?;
    let what = label(provider);
    let mut cmd = command(&path);
    cmd.arg("--version");
    let version = run(cmd, None, STATUS_TIMEOUT, what, None).await.ok().map(|o| o.stdout.trim().to_string()).filter(|s| !s.is_empty());
    let mut st = CliStatus { path: path.to_string_lossy().into_owned(), version, logged_in: None, account: None, models: None };
    let mut cmd = command(&path);
    if provider == "antigravity-cli" {
        // No status command: listing the models needs the login, and shows nothing without it.
        cmd.arg("models");
        if let Ok(o) = run(cmd, None, STATUS_TIMEOUT, what, None).await {
            let ids = parse_model_list(&o.stdout);
            st.logged_in = Some(o.status == Some(0) && !ids.is_empty());
            st.account = if ids.is_empty() { None } else { Some(format!("모델 {}개 사용 가능", ids.len())) };
            st.models = if ids.is_empty() { None } else { Some(ids) };
        }
    } else if provider == "codex-cli" {
        cmd.args(["login", "status"]);
        if let Ok(o) = run(cmd, None, STATUS_TIMEOUT, what, None).await {
            let text = format!("{}\n{}", o.stdout, o.stderr);
            let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string();
            st.logged_in = Some(text.to_ascii_lowercase().contains("logged in") && !text.to_ascii_lowercase().contains("not logged in"));
            st.account = if line.is_empty() { None } else { Some(line) };
        }
        // The catalog needs no login and tells which names this Codex version accepts.
        let mut cmd = command(&path);
        cmd.args(["debug", "models"]);
        if let Ok(o) = run(cmd, None, STATUS_TIMEOUT, what, None).await {
            let ids = parse_codex_catalog(&o.stdout, codex_config_model().as_deref());
            st.models = if ids.is_empty() { None } else { Some(ids) };
        }
    } else {
        cmd.args(["auth", "status", "--json"]);
        if let Ok(o) = run(cmd, None, STATUS_TIMEOUT, what, None).await {
            if let Ok(v) = serde_json::from_str::<Value>(o.stdout.trim()) {
                st.logged_in = v["loggedIn"].as_bool();
                let email = v["email"].as_str().unwrap_or("");
                let plan = v["subscriptionType"].as_str().unwrap_or("");
                let account = [email, plan].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(" · ");
                st.account = if account.is_empty() { None } else { Some(account) };
            }
        }
    }
    Ok(st)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_print_output() {
        let out = r#"{"type":"result","is_error":false,"result":"{\"title\":\"Bees\"}","usage":{"input_tokens":2,"cache_creation_input_tokens":300,"cache_read_input_tokens":100,"output_tokens":50},"modelUsage":{"claude-sonnet-5-5":{}}}"#;
        let r = parse_claude(out, "", Some(0), "sonnet").unwrap();
        assert_eq!(r.text, "{\"title\":\"Bees\"}");
        assert_eq!(r.model, "claude-sonnet-5-5");
        assert_eq!((r.input_tokens, r.output_tokens), (Some(402), Some(50)));
        // the requested name stands in when the CLI reports no model
        assert_eq!(parse_claude(r#"{"result":"x"}"#, "", Some(0), "opus").unwrap().model, "opus");
        assert_eq!(parse_claude(r#"{"result":"x"}"#, "", Some(0), "").unwrap().model, "claude (기본 모델)");
    }

    #[test]
    fn claude_errors_are_explained() {
        let e = parse_claude(r#"{"is_error":true,"result":"Not logged in · Please run /login"}"#, "", Some(1), "").unwrap_err();
        assert!(e.contains("로그인되어 있지 않습니다") && e.contains("/login"));
        let e = parse_claude("", "Error: something broke", Some(1), "").unwrap_err();
        assert!(e.contains("결과를 돌려주지 않았습니다") && e.contains("something broke"));
        let e = parse_claude(r#"{"is_error":true,"result":"Rate limit reached"}"#, "", Some(0), "").unwrap_err();
        assert_eq!(e, "Claude Code 오류: Rate limit reached");
    }

    #[test]
    fn reads_codex_events_and_last_message() {
        let events = concat!(
            "{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n",
            "{\"type\":\"turn.started\"}\n",
            "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"from events\"}}\n",
            "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":14832,\"cached_input_tokens\":100,\"cache_write_input_tokens\":0,\"output_tokens\":5,\"reasoning_output_tokens\":7}}\n"
        );
        let r = parse_codex(events, "", Some(0), "  from file \n", "").unwrap();
        assert_eq!(r.text, "from file");
        assert_eq!(r.model, "codex (기본 모델)");
        assert_eq!((r.input_tokens, r.output_tokens), (Some(14932), Some(12)));
        // without the file the message comes from the events
        let r = parse_codex(events, "", Some(0), "", "gpt-6-astra").unwrap();
        assert_eq!((r.text.as_str(), r.model.as_str()), ("from events", "gpt-6-astra"));
        let e = parse_codex("", "Not logged in. Run `codex login`.", Some(1), "", "").unwrap_err();
        assert!(e.contains("codex login"));
        let e = parse_codex("{\"type\":\"error\",\"message\":\"model not found\"}\n", "", Some(1), "", "").unwrap_err();
        assert!(e.contains("model not found"));
    }

    #[test]
    fn tuning_becomes_the_right_switches() {
        let t = Tuning { effort: "high".into(), speed: "priority".into() };
        assert_eq!(tuning_args("claude-cli", &t), vec!["--effort", "high"]);
        assert_eq!(tuning_args("antigravity-cli", &t), vec!["--effort", "high"]);
        assert_eq!(tuning_args("codex-cli", &t), vec!["-c", "model_reasoning_effort=\"high\"", "-c", "service_tier=\"priority\""]);
        assert!(tuning_args("claude-cli", &Tuning::default()).is_empty());
        assert_eq!(tuning_args("codex-cli", &Tuning { effort: " ".into(), speed: "flex".into() }), vec!["-c", "service_tier=\"flex\""]);
    }

    #[test]
    fn reads_codex_catalog() {
        let json = r#"Fetching…
{"models":[
 {"slug":"gpt-reserve","visibility":"hide","priority":4},
 {"slug":"gpt-5.6-luna","visibility":"list","priority":9},
 {"slug":"gpt-5.6-terra","visibility":"list","priority":8},
 {"slug":"codex-auto-review","visibility":"hide","priority":43},
 {"slug":"no-visibility-field","priority":20}
]}"#;
        assert_eq!(parse_codex_catalog(json, None), vec!["gpt-5.6-terra", "gpt-5.6-luna", "no-visibility-field"]);
        // the config default leads, once, even when the catalog does not list it
        assert_eq!(parse_codex_catalog(json, Some("gpt-5.6-sol"))[..2], ["gpt-5.6-sol", "gpt-5.6-terra"]);
        assert_eq!(parse_codex_catalog(json, Some("gpt-5.6-luna")).iter().filter(|s| *s == "gpt-5.6-luna").count(), 1);
        assert!(parse_codex_catalog("not json", None).is_empty());
        assert!(parse_codex_catalog("{\"models\":[]}", Some("  ")).is_empty());
    }

    #[test]
    fn reads_codex_config_model() {
        assert_eq!(parse_toml_model("model = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"high\"\n").as_deref(), Some("gpt-5.6-sol"));
        // a profile's model is not the default
        assert_eq!(parse_toml_model("[profiles.fast]\nmodel = \"gpt-5.5\"\n"), None);
        assert_eq!(parse_toml_model("model = \"\"\n"), None);
    }

    #[test]
    fn reads_antigravity_events_and_models() {
        let events = concat!(
            "{\"event\":\"init\",\"conversation_id\":\"c\",\"init\":{\"cwd\":\"x\",\"tools\":[\"run_command\"]}}\n",
            "{\"event\":\"step_update\",\"step_update\":{\"step_index\":1,\"state\":\"ACTIVE\",\"step_type\":\"agent_response\",\"text_delta\":\"OK\"}}\n",
            "{\"event\":\"result\",\"result\":{\"conversation_id\":\"c\",\"status\":\"SUCCESS\",\"response\":\"OK\\n\",\"duration_seconds\":10.1,\"num_turns\":1,\"usage\":{\"input_tokens\":13710,\"output_tokens\":858,\"thinking_tokens\":857,\"cache_read_tokens\":40,\"total_tokens\":14568}}}\n"
        );
        let r = parse_antigravity(events, "", Some(0), "").unwrap();
        assert_eq!((r.text.as_str(), r.model.as_str()), ("OK", "antigravity (기본 모델)"));
        assert_eq!((r.input_tokens, r.output_tokens), (Some(13750), Some(858)));
        assert_eq!(parse_antigravity(events, "", Some(0), "gemini-3.8-flash-high").unwrap().model, "gemini-3.8-flash-high");
        // a model that reached for a tool ends with an empty response and a note on stderr
        let empty = "{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\",\"response\":\"\",\"usage\":{}}}\n";
        let e = parse_antigravity(empty, "jetski: no output produced — a tool required the \"command\" permission that headless mode cannot prompt for", Some(0), "").unwrap_err();
        assert!(e.contains("도구를 쓰려다"));
        let e = parse_antigravity("{\"event\":\"result\",\"result\":{\"status\":\"ERROR\",\"response\":\"\",\"error\":\"model not found\"}}\n", "", Some(1), "").unwrap_err();
        assert_eq!(e, "Antigravity CLI 오류: model not found");
        let e = parse_antigravity("", "please sign in to continue", Some(1), "").unwrap_err();
        assert!(e.contains("Google 계정으로 로그인"));
        assert_eq!(
            parse_model_list("Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\n"),
            vec!["gemini-3.8-flash-high", "claude-opus-5-5-high"]
        );
    }

    #[test]
    fn resolves_only_existing_executables() {
        let e = resolve("claude-cli", Some("C:/nowhere/claude.exe")).unwrap_err();
        assert!(e.contains("실행 파일이 없습니다"));
        // an empty explicit path falls back to the search; either outcome is fine here, only no panic
        let _ = resolve("codex-cli", Some("   "));
        assert!(is_cli("claude-cli") && is_cli("codex-cli") && is_cli("antigravity-cli") && !is_cli("anthropic"));
    }

    /// Live: runs the installed CLIs. cargo test --lib cli::tests::live -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "runs the logged-in CLIs and spends subscription quota"]
    async fn live_status_and_one_word_reply() {
        for provider in CLI_PROVIDERS {
            let st = status(provider, None).await.unwrap();
            println!("{provider}: {st:?}");
            assert!(st.logged_in == Some(true));
            let model = match provider {
                "claude-cli" => "haiku",
                "antigravity-cli" => "gemini-3.8-flash-low",
                _ => "",
            };
            let r = complete(provider, None, model, &Tuning::default(), "Reply with exactly one word.", "Say OK.", None).await.unwrap();
            println!("{provider}: {r:?}");
            assert!(r.text.to_ascii_uppercase().contains("OK"));
        }
    }

    #[test]
    fn job_registry_tracks_processes_until_they_exit() {
        let jobs = Jobs::default();
        jobs.begin("j").unwrap();
        jobs.register("j", 10).unwrap();
        jobs.register("j", 11).unwrap();
        assert_eq!(jobs.pids("j"), vec![10, 11]);
        jobs.unregister("j", 10);
        assert_eq!(jobs.pids("j"), vec![11]);
        jobs.unregister("j", 11);
        assert!(jobs.pids("j").is_empty());
        // the job stays known between its calls, so a cancel then still counts
        assert_eq!(jobs.len(), 1);
        jobs.end("j");
        assert_eq!(jobs.len(), 0);
    }

    #[test]
    fn a_cancelled_job_hands_back_its_processes_and_refuses_new_ones() {
        let jobs = Jobs::default();
        jobs.begin("j").unwrap();
        jobs.register("j", 42).unwrap();
        jobs.begin("other").unwrap();
        jobs.register("other", 7).unwrap();
        assert_eq!(jobs.cancel("j"), vec![42]);
        assert!(jobs.is_cancelled("j"));
        assert_eq!(jobs.begin("j").unwrap_err(), "취소했습니다.");
        assert_eq!(jobs.register("j", 43).unwrap_err(), "취소했습니다.");
        assert_eq!(CANCELLED, "취소했습니다.");
        // another job is not touched
        assert!(!jobs.is_cancelled("other"));
        assert_eq!(jobs.pids("other"), vec![7]);
        jobs.end("j");
        assert!(!jobs.is_cancelled("j"));
        assert_eq!(jobs.len(), 1);
    }

    #[test]
    fn a_cancel_before_the_first_call_still_refuses_the_job() {
        let jobs = Jobs::default();
        // the page may cancel while it is still reading references or the official pages, before any CLI call
        assert!(jobs.cancel("early").is_empty());
        assert_eq!(jobs.begin("early").unwrap_err(), "취소했습니다.");
        assert_eq!(jobs.register("early", 3).unwrap_err(), "취소했습니다.");
        jobs.end("early");
        assert_eq!(jobs.len(), 0);
        assert!(jobs.begin("early").is_ok());
        // a cancelled entry nobody ends is forgotten after a while
        jobs.cancel("orphan");
        jobs.unregister("nope", 3);
        jobs.prune(Instant::now() + IDLE_JOB + Duration::from_secs(1));
        assert_eq!(jobs.len(), 0);
    }

    #[test]
    fn untagged_runs_are_ended_on_exit_but_never_cancelled_or_forgotten() {
        let jobs = Jobs::default();
        jobs.register(UNTAGGED, 9).unwrap();
        assert!(jobs.cancel(UNTAGGED).is_empty());
        assert!(!jobs.is_cancelled(UNTAGGED));
        // ending a job by that name must not drop the runs outside any job: the app's exit still has to end them
        jobs.end(UNTAGGED);
        assert_eq!(jobs.pids(UNTAGGED), vec![9]);
        jobs.register(UNTAGGED, 10).unwrap();
        jobs.begin("j").unwrap();
        jobs.register("j", 4).unwrap();
        let mut all = jobs.cancel_all();
        all.sort();
        assert_eq!(all, vec![4, 9, 10]);
    }

    #[test]
    fn idle_jobs_are_forgotten_and_every_job_ends_on_exit() {
        let jobs = Jobs::default();
        jobs.begin("left").unwrap();
        jobs.begin("busy").unwrap();
        jobs.register("busy", 5).unwrap();
        // a page reloaded mid-run never ends its job; an entry with no CLI running goes after a while
        jobs.prune(Instant::now() + IDLE_JOB + Duration::from_secs(1));
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs.cancel_all(), vec![5]);
        assert!(jobs.is_cancelled("busy"));
    }

    #[tokio::test]
    async fn a_call_for_a_cancelled_job_is_refused_before_anything_starts() {
        let job = "test-refused-before-spawn";
        JOBS.begin(job).unwrap();
        JOBS.cancel(job);
        // the path does not exist: reaching the spawn would give a different error
        let e = complete("claude-cli", Some("C:/nowhere/claude.exe"), "", &Tuning::default(), "", "hi", Some(job)).await.unwrap_err();
        assert_eq!(e, "취소했습니다.");
        JOBS.end(job);
    }

    #[test]
    fn tail_keeps_the_end() {
        assert_eq!(tail("  abcdef  ", 3), "def");
        assert_eq!(tail("ab", 3), "ab");
    }
}
