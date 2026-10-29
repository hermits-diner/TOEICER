//! The media archive (app data › raw): listening recordings and Part 1 photographs, each kept under a content-hash
//! name ("aud-<32 hex>.mp3", "img-<32 hex>.png"), so the same file is never stored twice and a set file carrying it
//! lands under the same name on another PC. Only names of this form are ever read, so nothing outside the archive
//! can be reached from the page.

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const IMAGE_TYPES: [(&str, &str); 5] =
    [("png", "image/png"), ("jpg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp"), ("svg", "image/svg+xml")];
const AUDIO_TYPES: [(&str, &str); 4] = [("mp3", "audio/mpeg"), ("ogg", "audio/ogg"), ("m4a", "audio/mp4"), ("wav", "audio/wav")];
const MAX_IMAGE: usize = 8 * 1024 * 1024;
const MAX_AUDIO: usize = 100 * 1024 * 1024;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Archive name for these bytes: "<prefix>-<first 32 hex of sha256>.<ext>".
pub(crate) fn hashed_name(prefix: &str, bytes: &[u8], ext: &str) -> String {
    format!("{prefix}-{}.{ext}", &hex(&Sha256::digest(bytes))[..32])
}

/// Splits "img-<32 hex>.png" / "aud-<32 hex>.mp3" into (prefix, hash, ext); anything else is not an archive name.
pub(crate) fn parse_media_name(name: &str) -> Option<(&str, &str, &str)> {
    let (prefix, rest) = name.split_once('-')?;
    let (hash, ext) = rest.rsplit_once('.')?;
    let hex_ok = hash.len() == 32 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    let ext_ok = match prefix {
        "img" => IMAGE_TYPES.iter().any(|(e, _)| *e == ext),
        "aud" => AUDIO_TYPES.iter().any(|(e, _)| *e == ext),
        _ => false,
    };
    (hex_ok && ext_ok).then_some((prefix, hash, ext))
}

fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG") {
        Some("png")
    } else if bytes.starts_with(b"\xFF\xD8\xFF") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn audio_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"ID3") || (bytes.len() > 2 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0) {
        Some("mp3")
    } else if bytes.starts_with(b"OggS") {
        Some("ogg")
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        Some("m4a")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        Some("wav")
    } else {
        None
    }
}

pub(crate) fn raw_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("raw");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn store(app: &AppHandle, prefix: &str, ext: &str, bytes: &[u8]) -> Result<String, String> {
    let name = hashed_name(prefix, bytes, ext);
    let path = raw_dir(app)?.join(&name);
    if !path.exists() {
        fs::write(path, bytes).map_err(|e| format!("파일을 보관하지 못했습니다: {e}"))?;
    }
    Ok(name)
}

/// Keeps a PNG/JPEG/GIF/WebP in the archive; returns the name `read_image` serves.
pub(crate) fn archive_image(app: &AppHandle, bytes: &[u8]) -> Result<String, String> {
    let ext = image_ext(bytes).ok_or("그림 파일 형식이 올바르지 않습니다.")?;
    if bytes.len() > MAX_IMAGE {
        return Err("그림 파일이 너무 큽니다.".into());
    }
    store(app, "img", ext, bytes)
}

/// Keeps a recording (MP3, OGG, M4A or WAV) in the archive; returns the name `read_audio` serves.
pub(crate) fn archive_audio(app: &AppHandle, bytes: &[u8]) -> Result<String, String> {
    let ext = audio_ext(bytes).ok_or("음성 파일 형식이 올바르지 않습니다.")?;
    if bytes.len() > MAX_AUDIO {
        return Err("음성 파일이 너무 깁니다.".into());
    }
    store(app, "aud", ext, bytes)
}

/// Path and MIME type of an archived file of the given kind ("img" or "aud").
pub(crate) fn archived(app: &AppHandle, name: &str, prefix: &str) -> Result<(PathBuf, &'static str), String> {
    let (p, _, ext) = parse_media_name(name).filter(|(p, _, _)| *p == prefix).ok_or("보관된 파일 이름이 아닙니다.")?;
    let types: &[(&str, &'static str)] = if p == "img" { &IMAGE_TYPES } else { &AUDIO_TYPES };
    let mime = types.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m).unwrap_or("application/octet-stream");
    Ok((raw_dir(app)?.join(name), mime))
}

/// An archived picture as a data URL, ready to embed in a stored test.
#[tauri::command]
pub async fn read_image(app: AppHandle, name: String) -> Result<String, String> {
    let (path, mime) = archived(&app, &name, "img")?;
    let bytes = fs::read(path).map_err(|_| format!("보관된 그림을 찾을 수 없습니다: {name}"))?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// The bytes of an archived recording, for the player.
#[tauri::command]
pub async fn read_audio(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let (path, _) = archived(&app, &name, "aud")?;
    let bytes = fs::read(path).map_err(|_| format!("보관된 음성을 찾을 수 없습니다: {name}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_archive_names() {
        assert_eq!(parse_media_name("img-0123456789abcdef0123456789abcdef.png"), Some(("img", "0123456789abcdef0123456789abcdef", "png")));
        assert!(parse_media_name("aud-0123456789abcdef0123456789abcdef.mp3").is_some());
        assert!(parse_media_name("img-0123456789abcdef0123456789abcdef.mp3").is_none());
        assert!(parse_media_name("img-0123456789ABCDEF0123456789abcdef.png").is_none());
        assert!(parse_media_name("../img-0123456789abcdef0123456789abcdef.png").is_none());
        assert!(parse_media_name("doc-0123456789abcdef0123456789abcdef.png").is_none());
    }

    #[test]
    fn tells_formats_by_their_bytes() {
        assert_eq!(image_ext(b"\x89PNG\r\n\x1a\n...."), Some("png"));
        assert_eq!(image_ext(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_ext(b"<svg>"), None);
        assert_eq!(audio_ext(b"ID3\x04\0\0\0\0\0\0"), Some("mp3"));
        assert_eq!(audio_ext(b"RIFF\0\0\0\0WAVEfmt "), Some("wav"));
        assert_eq!(audio_ext(b"hello"), None);
        assert_eq!(hashed_name("img", b"x", "png").len(), "img-".len() + 32 + ".png".len());
    }
}
