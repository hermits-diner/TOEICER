//! Polite HTTP fetcher for the import pipeline: per-host rate limiting with jitter,
//! robots.txt (incl. crawl-delay), retries with backoff, conditional requests,
//! PDF text extraction and raw-file archiving. Parsing into tests happens in the frontend.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use texting_robots::Robot;
use tokio::sync::Mutex;
use url::Url;

const USER_AGENT: &str = concat!("TOEICER-Study-App/", env!("CARGO_PKG_VERSION"), " (personal study tool)");
const ROBOTS_AGENT: &str = "TOEICER-Study-App";
const MAX_BYTES: usize = 30 * 1024 * 1024;
const MAX_ATTEMPTS: u32 = 4;

struct HostState {
    next_allowed: Instant,
    /// Grows on 429/5xx, decays on success.
    penalty: f64,
}

#[derive(Clone)]
enum RobotsEntry {
    AllowAll,
    Rules(Arc<Robot>),
}

pub struct CrawlerState {
    client: reqwest::Client,
    hosts: Mutex<HashMap<String, HostState>>,
    robots: Mutex<HashMap<String, RobotsEntry>>,
}

impl CrawlerState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .cookie_store(true)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .expect("http client");
        Self { client, hosts: Mutex::new(HashMap::new()), robots: Mutex::new(HashMap::new()) }
    }

    /// Blocks until this host may be contacted again, then reserves the next slot.
    async fn wait_turn(&self, host: &str, min_interval: Duration) {
        loop {
            let wait = {
                let mut hosts = self.hosts.lock().await;
                let st = hosts
                    .entry(host.to_string())
                    .or_insert(HostState { next_allowed: Instant::now(), penalty: 1.0 });
                let now = Instant::now();
                if now >= st.next_allowed {
                    let base = min_interval.mul_f64(st.penalty);
                    st.next_allowed = now + base + jitter(base / 2);
                    return;
                }
                st.next_allowed - now
            };
            tokio::time::sleep(wait).await;
        }
    }

    async fn adjust_penalty(&self, host: &str, failed: bool) {
        if let Some(st) = self.hosts.lock().await.get_mut(host) {
            st.penalty = if failed { (st.penalty * 2.0).min(8.0) } else { (st.penalty / 2.0).max(1.0) };
        }
    }

    async fn robots_for(&self, url: &Url, min_interval: Duration) -> Result<RobotsEntry, String> {
        let origin = url.origin().ascii_serialization();
        if let Some(e) = self.robots.lock().await.get(&origin) {
            return Ok(e.clone());
        }
        let robots_url = format!("{origin}/robots.txt");
        self.wait_turn(url.host_str().unwrap_or_default(), min_interval).await;
        let entry = match self.client.get(&robots_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.bytes().await.map_err(|e| e.to_string())?;
                match Robot::new(ROBOTS_AGENT, &body) {
                    Ok(r) => RobotsEntry::Rules(Arc::new(r)),
                    Err(_) => RobotsEntry::AllowAll,
                }
            }
            // RFC 9309: 4xx means no restrictions.
            Ok(resp) if resp.status().is_client_error() => RobotsEntry::AllowAll,
            // 5xx / unreachable means "assume disallowed"; don't cache so it can be retried later.
            Ok(resp) => return Err(format!("robots.txt를 확인할 수 없어 수집을 보류합니다 (HTTP {}).", resp.status().as_u16())),
            Err(e) => return Err(format!("robots.txt를 확인할 수 없어 수집을 보류합니다 ({e}).")),
        };
        self.robots.lock().await.insert(origin, entry.clone());
        Ok(entry)
    }
}

fn jitter(max: Duration) -> Duration {
    let max_ms = max.as_millis() as u64;
    if max_ms == 0 {
        return Duration::ZERO;
    }
    let seed = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos() as u64).unwrap_or(0);
    Duration::from_millis(seed % max_ms)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    url: String,
    min_interval_ms: u64,
    respect_robots: bool,
    etag: Option<String>,
    last_modified: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    url: String,
    final_url: String,
    status: u16,
    not_modified: bool,
    content_type: String,
    /// "html" | "pdf" | "text" | "other"
    kind: String,
    text: Option<String>,
    raw_path: Option<String>,
    content_hash: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RobotsInfo {
    allowed: bool,
    crawl_delay_sec: Option<f32>,
    has_rules: bool,
}

fn header(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    resp.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

fn retry_after(resp: &reqwest::Response) -> Option<Duration> {
    header(resp, reqwest::header::RETRY_AFTER)?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

fn decode_text(bytes: &[u8], content_type: &str) -> String {
    let label = content_type
        .split(';')
        .find_map(|p| p.trim().strip_prefix("charset="))
        .map(|c| c.trim_matches('"').to_string());
    let enc = label
        .and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    enc.decode(bytes).0.into_owned()
}

/// pdf-extract can panic on malformed files, so isolate it.
async fn pdf_text(bytes: Vec<u8>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(&bytes))
            .map_err(|_| "PDF를 해석하지 못했습니다.".to_string())?
            .map_err(|e| format!("PDF 텍스트 추출 실패: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_raw(app: &AppHandle, hash: &str, ext: &str, bytes: &[u8]) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{hash}.{ext}"));
    if !path.exists() {
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn crawl_robots(state: State<'_, CrawlerState>, url: String) -> Result<RobotsInfo, String> {
    let url = Url::parse(&url).map_err(|e| format!("잘못된 URL: {e}"))?;
    Ok(match state.robots_for(&url, Duration::from_secs(1)).await? {
        RobotsEntry::AllowAll => RobotsInfo { allowed: true, crawl_delay_sec: None, has_rules: false },
        RobotsEntry::Rules(r) => RobotsInfo { allowed: r.allowed(url.as_str()), crawl_delay_sec: r.delay, has_rules: true },
    })
}

#[tauri::command]
pub async fn crawl_fetch(app: AppHandle, state: State<'_, CrawlerState>, req: FetchRequest) -> Result<FetchResult, String> {
    let url = Url::parse(&req.url).map_err(|e| format!("잘못된 URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("http/https 주소만 수집할 수 있습니다.".into());
    }
    let host = url.host_str().unwrap_or_default().to_string();
    let mut interval = Duration::from_millis(req.min_interval_ms.max(500));

    if req.respect_robots {
        if let RobotsEntry::Rules(r) = state.robots_for(&url, interval).await? {
            if !r.allowed(url.as_str()) {
                return Err("robots.txt에서 수집을 허용하지 않는 경로입니다.".into());
            }
            if let Some(d) = r.delay {
                interval = interval.max(Duration::from_secs_f32(d));
            }
        }
    }

    let mut last_err = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        state.wait_turn(&host, interval).await;
        let mut rb = state.client.get(url.clone());
        if let Some(e) = &req.etag {
            rb = rb.header(reqwest::header::IF_NONE_MATCH, e);
        }
        if let Some(lm) = &req.last_modified {
            rb = rb.header(reqwest::header::IF_MODIFIED_SINCE, lm);
        }
        let backoff = Duration::from_secs(2u64.pow(attempt + 1));

        let resp = match rb.send().await {
            Ok(r) => r,
            Err(e) if e.is_timeout() || e.is_connect() => {
                last_err = format!("연결 실패: {e}");
                state.adjust_penalty(&host, true).await;
                tokio::time::sleep(backoff).await;
                continue;
            }
            Err(e) => return Err(format!("요청 실패: {e}")),
        };

        let status = resp.status();
        if status.as_u16() == 429 || status.is_server_error() {
            last_err = format!("서버가 요청을 거부했습니다 (HTTP {}).", status.as_u16());
            state.adjust_penalty(&host, true).await;
            tokio::time::sleep(retry_after(&resp).unwrap_or(backoff).min(Duration::from_secs(120))).await;
            continue;
        }
        state.adjust_penalty(&host, false).await;

        let mut out = FetchResult {
            url: req.url.clone(),
            final_url: resp.url().to_string(),
            status: status.as_u16(),
            etag: header(&resp, reqwest::header::ETAG),
            last_modified: header(&resp, reqwest::header::LAST_MODIFIED),
            content_type: header(&resp, reqwest::header::CONTENT_TYPE).unwrap_or_default(),
            ..Default::default()
        };
        if status.as_u16() == 304 {
            out.not_modified = true;
            return Ok(out);
        }
        if !status.is_success() {
            return Err(match status.as_u16() {
                401 | 403 => format!("접근이 거부되었습니다 (HTTP {}). 자동 수집을 막은 사이트일 수 있습니다.", status.as_u16()),
                404 => "페이지를 찾을 수 없습니다 (HTTP 404).".into(),
                s => format!("HTTP {s} 응답"),
            });
        }
        if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
            return Err("파일이 너무 큽니다 (30MB 초과).".into());
        }
        let bytes = resp.bytes().await.map_err(|e| format!("본문을 읽지 못했습니다: {e}"))?;
        if bytes.len() > MAX_BYTES {
            return Err("파일이 너무 큽니다 (30MB 초과).".into());
        }

        let ct = out.content_type.to_ascii_lowercase();
        let is_pdf = ct.contains("pdf") || bytes.starts_with(b"%PDF");
        let is_html = !is_pdf && (ct.contains("html") || ct.contains("xml") || bytes.iter().take(512).any(|&b| b == b'<'));
        let is_text = !is_pdf && !is_html && (ct.starts_with("text/") || ct.is_empty());
        let hash = hex(&Sha256::digest(&bytes));
        let (kind, ext) = if is_pdf { ("pdf", "pdf") } else if is_html { ("html", "html") } else if is_text { ("text", "txt") } else { ("other", "bin") };

        out.kind = kind.into();
        out.bytes = bytes.len();
        out.raw_path = Some(save_raw(&app, &hash, ext, &bytes)?);
        out.content_hash = Some(hash);
        out.text = match kind {
            "pdf" => Some(pdf_text(bytes.to_vec()).await?),
            "html" | "text" => Some(decode_text(&bytes, &ct)),
            _ => None,
        };
        return Ok(out);
    }
    Err(format!("{MAX_ATTEMPTS}회 시도 후 실패: {last_err}"))
}

#[derive(Serialize)]
pub struct RawText {
    /// "html" | "pdf" | "text"
    kind: String,
    text: String,
}

/// Text of an archived original, so a draft can be rebuilt without contacting the site again.
#[tauri::command]
pub async fn read_raw(app: AppHandle, path: String) -> Result<RawText, String> {
    // Only the file name is used: nothing outside the archive folder can be read.
    let name = std::path::Path::new(&path).file_name().ok_or("잘못된 경로입니다.")?.to_owned();
    let file = app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw").join(name);
    let bytes = std::fs::read(&file).map_err(|_| "보관된 원본 파일을 찾을 수 없습니다.".to_string())?;
    if bytes.starts_with(b"%PDF") {
        return Ok(RawText { kind: "pdf".into(), text: pdf_text(bytes).await? });
    }
    let kind = if file.extension().is_some_and(|e| e == "html") { "html" } else { "text" };
    Ok(RawText { kind: kind.into(), text: decode_text(&bytes, "") })
}

/// A kind of file kept beside the pages it belongs to: pictures and recordings.
struct AssetKind {
    /// File name prefix in the archive ("img", "aud").
    prefix: &'static str,
    max_bytes: usize,
    /// File extension and MIME type of the accepted formats.
    types: &'static [(&'static str, &'static str)],
    detect: fn(&str, &[u8]) -> Option<&'static str>,
    not_this: &'static str,
}

const IMAGE: AssetKind = AssetKind {
    prefix: "img",
    max_bytes: 8 * 1024 * 1024,
    types: &[("png", "image/png"), ("jpg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp"), ("svg", "image/svg+xml")],
    detect: image_ext,
    not_this: "그림 파일이 아닙니다.",
};

const AUDIO: AssetKind = AssetKind {
    prefix: "aud",
    max_bytes: 100 * 1024 * 1024,
    types: &[("mp3", "audio/mpeg"), ("ogg", "audio/ogg"), ("m4a", "audio/mp4"), ("wav", "audio/wav")],
    detect: audio_ext,
    not_this: "음성 파일이 아닙니다.",
};

fn by_mime(types: &'static [(&'static str, &'static str)], content_type: &str) -> Option<&'static str> {
    let ct = content_type.to_ascii_lowercase();
    types.iter().find(|(_, mime)| ct.starts_with(mime)).map(|(ext, _)| *ext)
}

fn image_ext(content_type: &str, bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG") {
        return Some("png");
    }
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("gif");
    }
    if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    by_mime(IMAGE.types, content_type).or_else(|| content_type.to_ascii_lowercase().starts_with("image/jpg").then_some("jpg"))
}

fn audio_ext(content_type: &str, bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"ID3") || (bytes.len() > 2 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0) {
        return Some("mp3");
    }
    if bytes.starts_with(b"OggS") {
        return Some("ogg");
    }
    if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        return Some("m4a");
    }
    if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("wav");
    }
    by_mime(AUDIO.types, content_type).or_else(|| content_type.to_ascii_lowercase().starts_with("audio/mp3").then_some("mp3"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRequest {
    url: String,
    min_interval_ms: u64,
    respect_robots: bool,
}

/// Archives a file that belongs to a collected page and returns its file name.
/// The name derives from the address, so a file already in the archive is not requested again.
async fn archive_asset(app: &AppHandle, state: &CrawlerState, req: AssetRequest, kind: &AssetKind) -> Result<String, String> {
    let url = Url::parse(&req.url).map_err(|e| format!("잘못된 URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("http/https 주소만 수집할 수 있습니다.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw");
    let stem = format!("{}-{}", kind.prefix, &hex(&Sha256::digest(url.as_str().as_bytes()))[..32]);
    if let Some((ext, _)) = kind.types.iter().find(|(ext, _)| dir.join(format!("{stem}.{ext}")).exists()) {
        return Ok(format!("{stem}.{ext}"));
    }

    let host = url.host_str().unwrap_or_default().to_string();
    let mut interval = Duration::from_millis(req.min_interval_ms.max(500));
    if req.respect_robots {
        if let RobotsEntry::Rules(r) = state.robots_for(&url, interval).await? {
            if !r.allowed(url.as_str()) {
                return Err("robots.txt에서 수집을 허용하지 않는 경로입니다.".into());
            }
            if let Some(d) = r.delay {
                interval = interval.max(Duration::from_secs_f32(d));
            }
        }
    }
    state.wait_turn(&host, interval).await;
    // A recording can take longer than a page; the client's default timeout would cut it off.
    let resp = state.client.get(url.clone()).timeout(Duration::from_secs(300)).send().await.map_err(|e| format!("요청 실패: {e}"))?;
    let status = resp.status();
    state.adjust_penalty(&host, status.as_u16() == 429 || status.is_server_error()).await;
    if !status.is_success() {
        return Err(format!("HTTP {} 응답", status.as_u16()));
    }
    let content_type = header(&resp, reqwest::header::CONTENT_TYPE).unwrap_or_default();
    let bytes = resp.bytes().await.map_err(|e| format!("본문을 읽지 못했습니다: {e}"))?;
    if bytes.len() > kind.max_bytes {
        return Err(format!("파일이 너무 큽니다 ({}MB 초과).", kind.max_bytes / 1024 / 1024));
    }
    let ext = (kind.detect)(&content_type, &bytes).ok_or(kind.not_this)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{stem}.{ext}");
    std::fs::write(dir.join(&name), &bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Path and MIME type of an archived asset. Only the file name is used: nothing outside the archive can be read.
pub(crate) fn archived_audio(app: &AppHandle, name: &str) -> Result<(std::path::PathBuf, &'static str), String> {
    archived(app, name, &AUDIO)
}

fn archived(app: &AppHandle, name: &str, kind: &AssetKind) -> Result<(std::path::PathBuf, &'static str), String> {
    let file = std::path::Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let mime = kind
        .types
        .iter()
        .find(|(ext, _)| file.starts_with(&format!("{}-", kind.prefix)) && file.ends_with(&format!(".{ext}")))
        .map(|(_, mime)| *mime)
        .ok_or("보관된 파일 이름이 아닙니다.")?;
    Ok((app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw").join(file), mime))
}

#[tauri::command]
pub async fn crawl_image(app: AppHandle, state: State<'_, CrawlerState>, req: AssetRequest) -> Result<String, String> {
    archive_asset(&app, &state, req, &IMAGE).await
}

/// Recordings are large, so they are fetched when first played rather than with the page.
#[tauri::command]
pub async fn crawl_audio(app: AppHandle, state: State<'_, CrawlerState>, req: AssetRequest) -> Result<String, String> {
    archive_asset(&app, &state, req, &AUDIO).await
}

/// An archived picture as a data URL, ready to embed in a stored test or show in review.
#[tauri::command]
pub async fn read_image(app: AppHandle, name: String) -> Result<String, String> {
    let (path, mime) = archived(&app, &name, &IMAGE)?;
    let bytes = std::fs::read(path).map_err(|_| format!("보관된 그림을 찾을 수 없습니다: {name}"))?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// The bytes of an archived recording, for the player.
#[tauri::command]
pub async fn read_audio(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let (path, _) = archived(&app, &name, &AUDIO)?;
    let bytes = std::fs::read(path).map_err(|_| format!("보관된 음성을 찾을 수 없습니다: {name}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Keeps the user's own speaking recording (WAV from the speaking screen) in the archive; returns its name for `read_audio`.
#[tauri::command]
pub async fn save_recording(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    // Sent as the raw request body: a two-minute recording is ~4 MB, far too much for JSON.
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("녹음 데이터가 전달되지 않았습니다.".into());
    };
    archive_wav(&app, bytes)
}

/// Keeps a picture made in the app (an AI Writing Task 1 chart, PNG) in the archive; returns its name for `read_image`.
/// The bytes travel as the raw request body.
#[tauri::command]
pub async fn save_image(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("그림 데이터가 전달되지 않았습니다.".into());
    };
    archive_image(&app, bytes)
}

/// Keeps a PNG/JPEG/WebP in the archive under its content-hash name; returns the name `read_image` serves.
pub(crate) fn archive_image(app: &AppHandle, bytes: &[u8]) -> Result<String, String> {
    let Some(ext) = image_ext("", bytes) else {
        return Err("그림 파일 형식이 올바르지 않습니다.".into());
    };
    if bytes.len() > IMAGE.max_bytes {
        return Err("그림 파일이 너무 큽니다.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{}-{}.{ext}", IMAGE.prefix, &hex(&Sha256::digest(bytes))[..32]);
    std::fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Keeps a WAV (a speaking recording or synthesized listening audio) in the archive under a content-hash name
/// that `read_audio` serves.
pub(crate) fn archive_wav(app: &AppHandle, bytes: &[u8]) -> Result<String, String> {
    if audio_ext("", bytes) != Some("wav") {
        return Err("음성 파일 형식이 올바르지 않습니다.".into());
    }
    archive_audio(app, bytes)
}

/// Keeps any accepted recording (WAV, MP3, …) in the archive under its content-hash name; returns the name.
pub(crate) fn archive_audio(app: &AppHandle, bytes: &[u8]) -> Result<String, String> {
    let ext = audio_ext("", bytes).ok_or("음성 파일 형식이 올바르지 않습니다.")?;
    if bytes.len() > AUDIO.max_bytes {
        return Err("음성 파일이 너무 깁니다.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{}-{}.{ext}", AUDIO.prefix, &hex(&Sha256::digest(bytes))[..32]);
    std::fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Text from a local PDF chosen by the user (bytes come from the file picker).
#[tauri::command]
pub async fn extract_pdf_bytes(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_BYTES {
        return Err("파일이 너무 큽니다 (30MB 초과).".into());
    }
    pdf_text(bytes).await
}
