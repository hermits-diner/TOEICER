//! Reading the official exam pages for the trend brief (Studio), and text from PDFs the user picks.
//! Pages are fetched politely: robots.txt is honoured and each host is contacted at most once a second.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;
use texting_robots::Robot;
use tokio::sync::Mutex;
use url::Url;

const USER_AGENT: &str = concat!("TOEICER/", env!("CARGO_PKG_VERSION"), " (exam practice app; reads official notices)");
const ROBOTS_AGENT: &str = "TOEICER";
const MAX_BYTES: usize = 30 * 1024 * 1024;
const MIN_INTERVAL: Duration = Duration::from_secs(1);

pub struct WebState {
    client: reqwest::Client,
    next_allowed: Mutex<HashMap<String, Instant>>,
}

impl WebState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .expect("http client");
        Self { client, next_allowed: Mutex::new(HashMap::new()) }
    }

    async fn wait_turn(&self, host: &str) {
        let wait = {
            let mut hosts = self.next_allowed.lock().await;
            let now = Instant::now();
            let at = hosts.get(host).copied().unwrap_or(now).max(now);
            hosts.insert(host.to_string(), at + MIN_INTERVAL);
            at - now
        };
        tokio::time::sleep(wait).await;
    }

    async fn allowed(&self, url: &Url) -> Result<bool, String> {
        let robots = url.join("/robots.txt").map_err(|e| e.to_string())?;
        self.wait_turn(url.host_str().unwrap_or_default()).await;
        match self.client.get(robots).send().await {
            Ok(r) if r.status().is_success() => {
                let body = r.bytes().await.map_err(|e| e.to_string())?;
                Ok(Robot::new(ROBOTS_AGENT, &body).map(|rb| rb.allowed(url.as_str())).unwrap_or(true))
            }
            // RFC 9309: a missing robots.txt means no restrictions; an unreachable one means wait.
            Ok(r) if r.status().is_client_error() => Ok(true),
            Ok(r) => Err(format!("robots.txt를 확인할 수 없습니다 (HTTP {}).", r.status().as_u16())),
            Err(e) => Err(format!("robots.txt를 확인할 수 없습니다 ({e}).")),
        }
    }
}

#[derive(Serialize)]
pub struct Page {
    /// "html" | "pdf" | "text"
    kind: String,
    text: String,
}

fn decode_text(bytes: &[u8], content_type: &str) -> String {
    let enc = content_type
        .split(';')
        .find_map(|p| p.trim().strip_prefix("charset="))
        .and_then(|l| encoding_rs::Encoding::for_label(l.trim_matches('"').as_bytes()))
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

/// One page as text (HTML, plain text or PDF), if robots.txt allows reading it.
#[tauri::command]
pub async fn fetch_page(state: State<'_, WebState>, url: String) -> Result<Page, String> {
    let url = Url::parse(&url).map_err(|e| format!("잘못된 주소: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("http/https 주소만 읽을 수 있습니다.".into());
    }
    if !state.allowed(&url).await? {
        return Err("robots.txt에서 허용하지 않는 페이지입니다.".into());
    }
    state.wait_turn(url.host_str().unwrap_or_default()).await;
    let resp = state.client.get(url).send().await.map_err(|e| format!("연결 실패: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} 응답", resp.status().as_u16()));
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let bytes = resp.bytes().await.map_err(|e| format!("본문을 읽지 못했습니다: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("파일이 너무 큽니다 (30MB 초과).".into());
    }
    if ct.contains("pdf") || bytes.starts_with(b"%PDF") {
        return Ok(Page { kind: "pdf".into(), text: pdf_text(bytes.to_vec()).await? });
    }
    let kind = if ct.contains("html") || ct.contains("xml") { "html" } else { "text" };
    Ok(Page { kind: kind.into(), text: decode_text(&bytes, &ct) })
}

/// Text from a local PDF chosen by the user (bytes come from the file picker).
#[tauri::command]
pub async fn extract_pdf_bytes(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_BYTES {
        return Err("파일이 너무 큽니다 (30MB 초과).".into());
    }
    pdf_text(bytes).await
}
