//! Text goes to a logged-in agent CLI (cli.rs); only the listening media (speech for Parts 1–4, photographs for
//! Part 1) call an API, Gemini's, with a key that lives in the OS credential store and never reaches the webview.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SERVICE: &str = "com.toeicer.app.ai";
/// Providers with a key in the credential store: Gemini alone, for listening speech and photographs.
const PROVIDERS: [&str; 1] = ["gemini"];

pub struct AiState {
    client: reqwest::Client,
}

impl AiState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("TOEICER-Study-App/", env!("CARGO_PKG_VERSION")))
            // A whole Part 3 conversation or a photograph can take a minute or two.
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client");
        Self { client }
    }
}

fn check_provider(p: &str) -> Result<(), String> {
    if PROVIDERS.contains(&p) || crate::cli::is_cli(p) { Ok(()) } else { Err(format!("알 수 없는 제공사: {p}")) }
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, provider).map_err(|e| format!("자격 증명 저장소를 열 수 없습니다: {e}"))
}

fn read_key(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("API 키를 읽지 못했습니다: {e}")),
    }
}

fn require_key(provider: &str) -> Result<String, String> {
    read_key(provider)?.ok_or_else(|| "Gemini API 키가 없습니다. 설정 › AI › Gemini에서 키를 저장하세요.".into())
}

#[tauri::command]
pub fn ai_key_status() -> Result<HashMap<String, bool>, String> {
    PROVIDERS.iter().map(|p| Ok((p.to_string(), read_key(p)?.is_some()))).collect()
}

/// Whether a CLI provider is installed and signed in.
#[tauri::command]
pub async fn ai_cli_status(provider: String, path: Option<String>) -> Result<crate::cli::CliStatus, String> {
    if !crate::cli::is_cli(&provider) {
        return Err(format!("CLI 제공사가 아닙니다: {provider}"));
    }
    crate::cli::status(&provider, path.as_deref()).await
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    if crate::cli::is_cli(&provider) {
        return Err("이 제공사는 API 키 대신 로그인된 CLI를 씁니다.".into());
    }
    check_provider(&provider)?;
    let key = key.trim();
    if key.is_empty() {
        return Err("키가 비어 있습니다.".into());
    }
    entry(&provider)?.set_password(key).map_err(|e| format!("API 키를 저장하지 못했습니다: {e}"))
}

#[tauri::command]
pub fn ai_delete_key(provider: String) -> Result<(), String> {
    check_provider(&provider)?;
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("API 키를 삭제하지 못했습니다: {e}")),
    }
}

/// Turns an HTTP failure into a message the user can act on, keeping the provider's own text.
async fn http_error(provider: &str, resp: reqwest::Response) -> String {
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let detail = body
        .pointer("/error/message")
        .or_else(|| body.pointer("/message"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let head = match status {
        401 | 403 => "API 키가 올바르지 않거나 권한이 없습니다.".to_string(),
        404 => "모델 또는 주소를 찾을 수 없습니다. 모델 이름을 확인해 주십시오.".to_string(),
        429 => "요청 한도를 초과했거나 크레딧이 부족합니다. 잠시 후 다시 시도해 주십시오.".to_string(),
        529 | 503 => "제공사 서버가 혼잡합니다. 잠시 후 다시 시도해 주십시오.".to_string(),
        s => format!("{provider} 요청 실패 (HTTP {s})."),
    };
    if detail.is_empty() { head } else { format!("{head} ({detail})") }
}

fn send_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "응답 시간이 초과되었습니다.".into()
    } else if e.is_connect() {
        "서버에 연결할 수 없습니다. 인터넷 연결이나 서버 주소, 서버가 켜져 있는지 확인해 주십시오.".into()
    } else {
        format!("연결 실패: {e}")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    provider: String,
    model: String,
    /// Executable of a CLI provider; empty means search PATH and the usual install locations.
    cli_path: Option<String>,
    /// Reasoning effort (low … max) and, for Codex, the service tier; empty for the CLI's default.
    #[serde(default)]
    effort: String,
    #[serde(default)]
    speed: String,
    system: String,
    prompt: String,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResult {
    text: String,
    /// The model that actually answered (may differ after a server-side fallback).
    model: String,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[tauri::command]
pub async fn ai_complete(req: CompleteRequest) -> Result<CompleteResult, String> {
    if !crate::cli::is_cli(&req.provider) {
        return Err(format!("텍스트 제공사가 아닙니다: {}", req.provider));
    }
    // An empty model name uses the CLI's own default.
    let tuning = crate::cli::Tuning { effort: req.effort.clone(), speed: req.speed.clone() };
    let r = crate::cli::complete(&req.provider, req.cli_path.as_deref(), &req.model, &tuning, &req.system, &req.prompt).await?;
    let out = CompleteResult { text: r.text, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens };
    if out.text.trim().is_empty() {
        return Err("모델이 빈 답변을 보냈습니다.".into());
    }
    Ok(out)
}

/// The models a CLI lists, or the Gemini models the key can use (for the TTS and image pickers).
#[tauri::command]
pub async fn ai_list_models(
    state: tauri::State<'_, AiState>,
    provider: String,
    cli_path: Option<String>,
) -> Result<Vec<String>, String> {
    check_provider(&provider)?;
    if crate::cli::is_cli(&provider) {
        return crate::cli::models(&provider, cli_path.as_deref()).await;
    }
    let mut ids: Vec<String> = match provider.as_str() {
        "gemini" => {
            let resp = state
                .client
                .get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000")
                .header("x-goog-api-key", require_key("gemini")?)
                .send()
                .await
                .map_err(send_error)?;
            if !resp.status().is_success() {
                return Err(http_error("Gemini", resp).await);
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"].as_array().is_some_and(|a| a.iter().any(|x| x == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str().map(|n| n.trim_start_matches("models/").to_string()))
                .collect()
        }
        _ => return Err(format!("알 수 없는 제공사: {provider}")),
    };
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_store_round_trip() {
        // A throwaway service name so the user's saved keys are never touched.
        let e = keyring::Entry::new("com.toeicer.app.ai.test", "roundtrip").unwrap();
        e.set_password("secret-123").unwrap();
        assert_eq!(e.get_password().unwrap(), "secret-123");
        e.delete_credential().unwrap();
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
    }

    #[test]
    fn only_gemini_and_the_clis_are_providers() {
        assert!(check_provider("gemini").is_ok());
        assert!(check_provider("claude-cli").is_ok());
        assert!(check_provider("anthropic").is_err());
        assert!(check_provider("openai").is_err());
    }
}

/* ---------- Gemini speech synthesis for listening parts ---------- */

#[derive(Deserialize, Serialize, Clone)]
pub struct TtsTurn {
    speaker: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    model: String,
    turns: Vec<TtsTurn>,
    /// speaker → Gemini prebuilt voice name ("Kore", "Puck", …)
    voices: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsResult {
    /// Archive name for `read_audio`.
    name: String,
    duration: f64,
}

/// Request body for Gemini's TTS models. One speaker uses the plain single-voice form. Two speakers tag every turn
/// with its speaker and name a voice per speaker, which is the form gemini-3.8-flash-tts requires (the older
/// "Speaker: line" text form is rejected there).
pub(crate) fn gemini_tts_body(turns: &[TtsTurn], voices: &HashMap<String, String>) -> Result<Value, String> {
    let turns: Vec<&TtsTurn> = turns.iter().filter(|t| !t.text.trim().is_empty()).collect();
    if turns.is_empty() {
        return Err("읽을 대본이 비어 있습니다.".into());
    }
    let mut speakers: Vec<&str> = Vec::new();
    for t in &turns {
        if !speakers.contains(&t.speaker.as_str()) {
            speakers.push(&t.speaker);
        }
    }
    let voice = |s: &str| -> Result<&str, String> {
        voices
            .get(s)
            .map(String::as_str)
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| format!("화자 {s}의 목소리가 정해지지 않았습니다."))
    };
    let (contents, speech) = match speakers.as_slice() {
        [one] => {
            let text = turns.iter().map(|t| t.text.trim()).collect::<Vec<_>>().join("\n\n");
            (
                json!([{ "parts": [{ "text": text }] }]),
                json!({ "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice(one)? } } }),
            )
        }
        [_, _] => {
            let parts: Vec<Value> = turns
                .iter()
                .map(|t| json!({ "text": t.text.trim(), "speechMetadata": { "speaker": t.speaker } }))
                .collect();
            let configs = speakers
                .iter()
                .map(|s| Ok(json!({ "speaker": s, "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice(s)? } } })))
                .collect::<Result<Vec<Value>, String>>()?;
            (json!([{ "parts": parts }]), json!({ "multiSpeakerVoiceConfig": { "speakerVoiceConfigs": configs } }))
        }
        _ => return Err("Gemini 음성은 화자를 둘까지만 지원합니다.".into()),
    };
    Ok(json!({ "contents": contents, "generationConfig": { "responseModalities": ["AUDIO"], "speechConfig": speech } }))
}

/// Wraps raw 16-bit mono PCM in a WAV header.
pub(crate) fn wav_from_pcm(pcm: &[u8], rate: u32) -> Vec<u8> {
    let data_len = pcm.len() as u32;
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes()); // bytes per second
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// Gemini's audio as a WAV plus its duration in seconds. gemini-3.8 already returns a WAV file; gemini-3.1 returns
/// raw L16 PCM with the rate in the MIME type ("audio/l16; rate=24000").
pub(crate) fn wav_from_gemini(mime: &str, bytes: Vec<u8>) -> (Vec<u8>, f64) {
    if bytes.len() > 44 && bytes.starts_with(b"RIFF") {
        let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]).max(1) as f64;
        let duration = (bytes.len() - 44) as f64 / 2.0 / rate;
        return (bytes, duration);
    }
    let rate = mime
        .split(';')
        .filter_map(|p| p.trim().strip_prefix("rate="))
        .filter_map(|r| r.trim().parse::<u32>().ok())
        .next()
        .unwrap_or(24000);
    let duration = bytes.len() as f64 / 2.0 / rate as f64;
    (wav_from_pcm(&bytes, rate), duration)
}

/// Calls the model and returns the audio as WAV bytes with its duration.
async fn gemini_tts_fetch(client: &reqwest::Client, key: &str, model: &str, body: &Value) -> Result<(Vec<u8>, f64), String> {
    let resp = client
        .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
        .header("x-goog-api-key", key)
        .json(body)
        .send()
        .await
        .map_err(send_error)?;
    if !resp.status().is_success() {
        return Err(http_error("Gemini", resp).await);
    }
    let v: Value = resp.json().await.map_err(|e| format!("응답을 해석하지 못했습니다: {e}"))?;
    if let Some(reason) = v.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(format!("Gemini가 요청을 차단했습니다 ({reason})."));
    }
    let part = v
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .and_then(|ps| ps.iter().find(|p| p.get("inlineData").is_some()))
        .cloned();
    let Some(part) = part else {
        let reason = v.pointer("/candidates/0/finishReason").and_then(Value::as_str).unwrap_or("알 수 없음");
        return Err(format!("Gemini가 음성을 보내지 않았습니다 ({reason})."));
    };
    use base64::Engine;
    let data = part.pointer("/inlineData/data").and_then(Value::as_str).unwrap_or("");
    let mime = part.pointer("/inlineData/mimeType").and_then(Value::as_str).unwrap_or("");
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("음성 데이터를 읽지 못했습니다: {e}"))?;
    Ok(wav_from_gemini(mime, bytes))
}

/// Speech for a listening part through Gemini's TTS models, kept in the archive as MP3.
#[tauri::command]
pub async fn ai_tts(app: tauri::AppHandle, state: tauri::State<'_, AiState>, req: TtsRequest) -> Result<TtsResult, String> {
    let model = req.model.trim().trim_start_matches("models/");
    if model.is_empty() {
        return Err("Gemini 음성 모델이 선택되지 않았습니다. 설정 › AI › Gemini에서 골라 주십시오.".into());
    }
    let key = require_key("gemini")?;
    let body = gemini_tts_body(&req.turns, &req.voices)?;
    let (wav, duration) = gemini_tts_fetch(&state.client, &key, model, &body).await?;
    // Kept as MP3: a tenth of the WAV, which matters once sets are shared as packages.
    let mp3 = crate::mp3::wav_bytes_to_mp3(&app, &wav).await?;
    let name = crate::media::archive_audio(&app, &mp3)?;
    Ok(TtsResult { name, duration })
}

#[derive(Deserialize)]
pub struct ImageRequest {
    model: String,
    prompt: String,
}

/// The request body for a Gemini image model: one prompt, an image back.
pub(crate) fn gemini_image_body(prompt: &str) -> Result<Value, String> {
    if prompt.trim().is_empty() {
        return Err("그림 설명이 비어 있습니다.".into());
    }
    Ok(json!({
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
    }))
}

/// A photograph for an AI-written TOEIC Part 1 item, made by a Gemini image model; kept in the archive.
#[tauri::command]
pub async fn ai_image(app: tauri::AppHandle, state: tauri::State<'_, AiState>, req: ImageRequest) -> Result<String, String> {
    let model = req.model.trim().trim_start_matches("models/");
    if model.is_empty() {
        return Err("Gemini 그림 모델이 선택되지 않았습니다. 설정 › AI › Gemini에서 골라 주십시오.".into());
    }
    let key = require_key("gemini")?;
    let body = gemini_image_body(&req.prompt)?;
    let resp = state
        .client
        .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
        .header("x-goog-api-key", &key)
        .json(&body)
        .send()
        .await
        .map_err(send_error)?;
    if !resp.status().is_success() {
        return Err(http_error("Gemini", resp).await);
    }
    let v: Value = resp.json().await.map_err(|e| format!("응답을 해석하지 못했습니다: {e}"))?;
    if let Some(reason) = v.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(format!("Gemini가 요청을 차단했습니다 ({reason})."));
    }
    let data = v
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .and_then(|ps| ps.iter().find_map(|p| p.pointer("/inlineData/data").and_then(Value::as_str)))
        .ok_or_else(|| {
            let reason = v.pointer("/candidates/0/finishReason").and_then(Value::as_str).unwrap_or("알 수 없음");
            format!("Gemini가 그림을 보내지 않았습니다 ({reason}).")
        })?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("그림 데이터를 읽지 못했습니다: {e}"))?;
    crate::media::archive_image(&app, &bytes)
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[test]
    fn asks_for_an_image_and_rejects_an_empty_prompt() {
        let b = gemini_image_body("A man is reading a newspaper.").unwrap();
        assert_eq!(b["generationConfig"]["responseModalities"][1], "IMAGE");
        assert_eq!(b["contents"][0]["parts"][0]["text"], "A man is reading a newspaper.");
        assert!(gemini_image_body("  ").is_err());
    }
}

#[cfg(test)]
mod tts_tests {
    use super::*;

    fn turns(pairs: &[(&str, &str)]) -> Vec<TtsTurn> {
        pairs.iter().map(|(s, t)| TtsTurn { speaker: s.to_string(), text: t.to_string() }).collect()
    }
    fn voices(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(s, v)| (s.to_string(), v.to_string())).collect()
    }

    #[test]
    fn one_speaker_uses_the_single_voice_form() {
        let b = gemini_tts_body(&turns(&[("A", "First. "), ("A", ""), ("A", "Second.")]), &voices(&[("A", "Kore")])).unwrap();
        assert_eq!(b["contents"][0]["parts"][0]["text"], "First.\n\nSecond.");
        assert!(b["contents"][0]["parts"][0].get("speechMetadata").is_none());
        assert_eq!(b["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"], "Kore");
        assert_eq!(b["generationConfig"]["responseModalities"][0], "AUDIO");
    }

    #[test]
    fn two_speakers_tag_every_turn() {
        let b = gemini_tts_body(&turns(&[("A", "Hi."), ("B", "Hello."), ("A", "Bye.")]), &voices(&[("A", "Kore"), ("B", "Puck")])).unwrap();
        let parts = b["contents"][0]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1]["speechMetadata"]["speaker"], "B");
        let cfg = b["generationConfig"]["speechConfig"]["multiSpeakerVoiceConfig"]["speakerVoiceConfigs"].as_array().unwrap();
        assert_eq!((cfg[0]["speaker"].as_str(), cfg[1]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"].as_str()), (Some("A"), Some("Puck")));
    }

    #[test]
    fn rejects_three_speakers_missing_voices_and_empty_scripts() {
        assert!(gemini_tts_body(&turns(&[("A", "x"), ("B", "y"), ("C", "z")]), &voices(&[("A", "Kore"), ("B", "Puck"), ("C", "Leda")])).is_err());
        assert!(gemini_tts_body(&turns(&[("A", "x"), ("B", "y")]), &voices(&[("A", "Kore")])).unwrap_err().contains("B"));
        assert!(gemini_tts_body(&turns(&[("A", "  ")]), &voices(&[("A", "Kore")])).is_err());
    }

    #[test]
    fn wraps_pcm_and_passes_wav_through() {
        let pcm = vec![0u8; 48000]; // one second at 24 kHz
        let (wav, dur) = wav_from_gemini("audio/l16; rate=24000; channels=1", pcm);
        assert!(wav.starts_with(b"RIFF") && &wav[8..16] == b"WAVEfmt " && wav.len() == 44 + 48000);
        assert_eq!(u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]), 24000);
        assert!((dur - 1.0).abs() < 1e-9);
        let (same, dur2) = wav_from_gemini("audio/wav", wav.clone());
        assert_eq!(same, wav);
        assert!((dur2 - 1.0).abs() < 1e-9);
    }

    /// Live: uses the Gemini key in Credential Manager. cargo test --lib tts_tests -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "calls Gemini and spends tokens"]
    async fn synthesizes_a_dialogue_and_a_monologue() {
        let key = require_key("gemini").unwrap();
        let client = AiState::new().client;
        let dialogue = gemini_tts_body(
            &turns(&[("A", "Good morning. How can I help you today?"), ("B", "Hi. I'd like to book a table for 4 on the 21st, please.")]),
            &voices(&[("A", "Kore"), ("B", "Puck")]),
        )
        .unwrap();
        let (wav, dur) = gemini_tts_fetch(&client, &key, "gemini-3.8-flash-tts", &dialogue).await.unwrap();
        println!("dialogue: {} bytes, {dur:.1}s", wav.len());
        assert!(wav.starts_with(b"RIFF") && dur > 3.0);
        let monologue = gemini_tts_body(&turns(&[("A", "Welcome to the museum. Today's tour starts at the main entrance.")]), &voices(&[("A", "Charon")])).unwrap();
        let (wav, dur) = gemini_tts_fetch(&client, &key, "gemini-3.8-flash-tts", &monologue).await.unwrap();
        println!("monologue: {} bytes, {dur:.1}s", wav.len());
        assert!(wav.starts_with(b"RIFF") && dur > 2.0);
    }
}
