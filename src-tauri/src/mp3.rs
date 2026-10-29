//! WAV → MP3 through the MP3 encoder that ships with Windows (Media Foundation), so the app bundles no codec and
//! carries no codec licence. Speech from the TTS service arrives as 24 kHz 16-bit mono WAV; as MP3 at 64 kbps it is
//! about a tenth of the size, which matters for shared packages. The encoder's own ID3 tag is dropped from every MP3
//! the app hands out (see `strip_id3v2`).

use std::path::Path;

/// PCM 16-bit audio pulled out of a WAV file.
pub(crate) struct Pcm {
    pub channels: u16,
    pub rate: u32,
    pub data: Vec<u8>,
}

/// Reads a PCM 16-bit WAV (the only kind the app writes). Other encodings are refused.
pub(crate) fn parse_wav(bytes: &[u8]) -> Result<Pcm, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("WAV 파일이 아닙니다.".into());
    }
    let mut pos = 12;
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            let tag = u16::from_le_bytes([bytes[body], bytes[body + 1]]);
            let channels = u16::from_le_bytes([bytes[body + 2], bytes[body + 3]]);
            let rate = u32::from_le_bytes([bytes[body + 4], bytes[body + 5], bytes[body + 6], bytes[body + 7]]);
            let bits = u16::from_le_bytes([bytes[body + 14], bytes[body + 15]]);
            fmt = Some((tag, channels, rate, bits));
        } else if id == b"data" {
            let (tag, channels, rate, bits) = fmt.ok_or("WAV 형식 정보가 없습니다.")?;
            if tag != 1 || bits != 16 {
                return Err("16비트 PCM WAV만 변환할 수 있습니다.".into());
            }
            let end = (body + size).min(bytes.len());
            return Ok(Pcm { channels, rate, data: bytes[body..end].to_vec() });
        }
        pos = body + size + (size & 1);
    }
    Err("WAV 파일에 소리 데이터가 없습니다.".into())
}

/// Doubles the sample rate by linear interpolation, for encoders that refuse low rates.
pub(crate) fn upsample_x2(p: &Pcm) -> Pcm {
    let ch = p.channels as usize;
    let frames = p.data.len() / (2 * ch);
    let sample = |f: usize, c: usize| i16::from_le_bytes([p.data[(f * ch + c) * 2], p.data[(f * ch + c) * 2 + 1]]) as i32;
    let mut out = Vec::with_capacity(p.data.len() * 2);
    for f in 0..frames {
        for c in 0..ch {
            let a = sample(f, c);
            let b = if f + 1 < frames { sample(f + 1, c) } else { a };
            out.extend_from_slice(&(a as i16).to_le_bytes());
            out.extend_from_slice(&(((a + b) / 2) as i16).to_le_bytes());
        }
    }
    Pcm { channels: p.channels, rate: p.rate * 2, data: out }
}

#[cfg(windows)]
mod mf {
    use super::Pcm;
    use std::path::Path;
    use windows::core::HSTRING;
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    const MF_VERSION: u32 = (2 << 16) | 0x70;

    fn err(what: &str, e: windows::core::Error) -> String {
        format!("MP3 변환 실패 ({what}): {e}")
    }

    /// Encodes `pcm` to `dest` at `kbps`. Fails if the system encoder rejects the sample rate.
    pub(super) fn encode(pcm: &Pcm, dest: &Path, kbps: u32) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| err("시작", e))?;
            let result = write(pcm, dest, kbps);
            let _ = MFShutdown();
            result
        }
    }

    unsafe fn write(pcm: &Pcm, dest: &Path, kbps: u32) -> Result<(), String> {
        let channels = pcm.channels as u32;
        let writer: IMFSinkWriter = MFCreateSinkWriterFromURL(&HSTRING::from(dest.as_os_str()), None, None).map_err(|e| err("파일 열기", e))?;
        let out: IMFMediaType = MFCreateMediaType().map_err(|e| err("형식", e))?;
        out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(|e| err("형식", e))?;
        out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_MP3).map_err(|e| err("형식", e))?;
        out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels).map_err(|e| err("형식", e))?;
        out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, pcm.rate).map_err(|e| err("형식", e))?;
        out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, kbps * 1000 / 8).map_err(|e| err("형식", e))?;
        let stream = writer.AddStream(&out).map_err(|e| err("MP3 스트림", e))?;

        let inp: IMFMediaType = MFCreateMediaType().map_err(|e| err("입력 형식", e))?;
        inp.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(|e| err("입력 형식", e))?;
        inp.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM).map_err(|e| err("입력 형식", e))?;
        inp.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels).map_err(|e| err("입력 형식", e))?;
        inp.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, pcm.rate).map_err(|e| err("입력 형식", e))?;
        inp.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(|e| err("입력 형식", e))?;
        inp.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, channels * 2).map_err(|e| err("입력 형식", e))?;
        inp.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, pcm.rate * channels * 2).map_err(|e| err("입력 형식", e))?;
        inp.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1).map_err(|e| err("입력 형식", e))?;
        writer.SetInputMediaType(stream, &inp, None).map_err(|e| err("입력 형식 설정", e))?;
        writer.BeginWriting().map_err(|e| err("쓰기 시작", e))?;

        let bytes_per_sec = (pcm.rate * channels * 2) as usize;
        let mut pos = 0usize;
        let mut time: i64 = 0;
        while pos < pcm.data.len() {
            let n = bytes_per_sec.min(pcm.data.len() - pos);
            let buffer: IMFMediaBuffer = MFCreateMemoryBuffer(n as u32).map_err(|e| err("버퍼", e))?;
            let mut ptr: *mut u8 = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None).map_err(|e| err("버퍼", e))?;
            std::ptr::copy_nonoverlapping(pcm.data.as_ptr().add(pos), ptr, n);
            buffer.Unlock().map_err(|e| err("버퍼", e))?;
            buffer.SetCurrentLength(n as u32).map_err(|e| err("버퍼", e))?;
            let sample: IMFSample = MFCreateSample().map_err(|e| err("샘플", e))?;
            sample.AddBuffer(&buffer).map_err(|e| err("샘플", e))?;
            let duration = (n as i64) * 10_000_000 / bytes_per_sec as i64;
            sample.SetSampleTime(time).map_err(|e| err("샘플", e))?;
            sample.SetSampleDuration(duration).map_err(|e| err("샘플", e))?;
            writer.WriteSample(stream, &sample).map_err(|e| err("쓰기", e))?;
            time += duration;
            pos += n;
        }
        writer.Finalize().map_err(|e| err("마무리", e))?;
        Ok(())
    }
}

/// Converts a WAV to MP3 at `dest`. Tries the WAV's own rate first; if the system encoder refuses it, doubles the
/// rate (24 kHz speech becomes 48 kHz) and tries again.
pub(crate) fn wav_to_mp3(wav: &[u8], dest: &Path, kbps: u32) -> Result<(), String> {
    let pcm = parse_wav(wav)?;
    #[cfg(windows)]
    {
        match mf::encode(&pcm, dest, kbps) {
            Ok(()) => Ok(()),
            Err(first) => {
                let _ = std::fs::remove_file(dest);
                mf::encode(&upsample_x2(&pcm), dest, kbps).map_err(|second| format!("{first} / 48 kHz 재시도: {second}"))
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (pcm, dest, kbps);
        Err("MP3 변환은 Windows에서만 지원합니다.".into())
    }
}

/// Drops any ID3v2 tag at the start of an MP3, returning the bare MPEG stream. The Windows encoder prefixes a tag
/// whose UTF-16 text begins with FF FE, which naive decoders take for a frame header with reserved sample-rate bits
/// ("unknown mp3 frequency header"); a stream that starts at its first frame plays everywhere.
pub(crate) fn strip_id3v2(mut bytes: &[u8]) -> &[u8] {
    while bytes.len() >= 10 && &bytes[..3] == b"ID3" {
        let size = bytes[6..10].iter().fold(0usize, |n, &b| (n << 7) | (b & 0x7f) as usize);
        let footer = if bytes[5] & 0x10 != 0 { 10 } else { 0 };
        bytes = &bytes[(10 + size + footer).min(bytes.len())..];
    }
    bytes
}

/// Scratch file for the system encoder, which writes to a path; removed after reading back.
fn scratch(app: &tauri::AppHandle, stem: &str) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{stem}-{}.mp3", std::process::id())))
}

/// WAV bytes → MP3 bytes (64 kbps), off the async runtime.
pub(crate) async fn wav_bytes_to_mp3(app: &tauri::AppHandle, wav: &[u8]) -> Result<Vec<u8>, String> {
    let dest = scratch(app, "tts")?;
    let wav = wav.to_vec();
    let path = dest.clone();
    tauri::async_runtime::spawn_blocking(move || wav_to_mp3(&wav, &path, 64)).await.map_err(|e| e.to_string())??;
    let mp3 = std::fs::read(&dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&dest);
    Ok(strip_id3v2(&mp3).to_vec())
}

/// Saves an archived recording to `dest`; a WAV becomes MP3 unless `dest` ends with .wav. MP3s go out without an
/// ID3 tag, so they load in every player.
#[tauri::command]
pub async fn save_audio_as(app: tauri::AppHandle, name: String, dest: String) -> Result<u64, String> {
    let (path, _) = crate::media::archived(&app, &name, "aud")?;
    let bytes = std::fs::read(&path).map_err(|_| "음성 파일을 찾을 수 없습니다.".to_string())?;
    let dest_path = std::path::PathBuf::from(&dest);
    let out = if dest.to_lowercase().ends_with(".wav") {
        bytes
    } else if name.ends_with(".wav") {
        wav_bytes_to_mp3(&app, &bytes).await?
    } else {
        strip_id3v2(&bytes).to_vec()
    };
    std::fs::write(&dest_path, &out).map_err(|e| format!("파일을 저장하지 못했습니다: {e}"))?;
    Ok(out.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(rate: u32, channels: u16, frames: usize) -> Vec<u8> {
        let data: Vec<u8> = (0..frames * channels as usize).map(|i| (((i as f32) * 0.1).sin() * 12000.0) as i16).flat_map(|s| s.to_le_bytes()).collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&((36 + data.len()) as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn parses_pcm16_and_upsamples() {
        let p = parse_wav(&wav(24000, 1, 2400)).unwrap();
        assert_eq!((p.channels, p.rate, p.data.len()), (1, 24000, 4800));
        let u = upsample_x2(&p);
        assert_eq!((u.rate, u.data.len()), (48000, 9600));
        assert!(parse_wav(b"not a wav").is_err());
    }

    #[test]
    fn strips_id3v2_tags() {
        // ID3v2.3, no flags, 6-byte body: a UTF-16 BOM that looks like a frame sync, as the Windows encoder writes
        let mut tagged = b"ID3     ".to_vec();
        tagged.extend_from_slice(&[0xFF, 0xFE, b'M', 0, b'P', 0]);
        tagged.extend_from_slice(&[0xFF, 0xFB, 0x54, 0xC0, 1, 2, 3]);
        assert_eq!(strip_id3v2(&tagged), &[0xFF, 0xFB, 0x54, 0xC0, 1, 2, 3]);
        assert_eq!(strip_id3v2(&[0xFF, 0xFB, 0x54, 0xC0]), &[0xFF, 0xFB, 0x54, 0xC0]);
        // the footer flag (bit 4) adds ten bytes; a truncated tag leaves nothing rather than panicking
        let mut footed = b"ID3    ".to_vec();
        footed.extend_from_slice(&[0; 12]);
        footed.push(0xFF);
        assert_eq!(strip_id3v2(&footed), &[0xFF]);
        assert_eq!(strip_id3v2(b"ID3    "), &[] as &[u8]);
    }

    /// Uses the system encoder: 2 seconds of 24 kHz mono speech-like tone → a real MP3 a fraction of the size.
    #[cfg(windows)]
    #[test]
    fn encodes_with_windows_media_foundation() {
        let dir = std::env::temp_dir().join(format!("toeicer-mp3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = wav(24000, 1, 48000);
        let dest = dir.join("t.mp3");
        wav_to_mp3(&src, &dest, 64).unwrap();
        let mp3 = std::fs::read(&dest).unwrap();
        println!("wav {} bytes -> mp3 {} bytes", src.len(), mp3.len());
        assert!(mp3.len() > 4000 && mp3.len() < src.len() / 4);
        let frame = mp3.iter().position(|&b| b == 0xFF).unwrap();
        assert_eq!(mp3[frame + 1] & 0xE0, 0xE0, "no MPEG frame sync");
        // without the encoder's tag the stream starts at a real frame header whose sample-rate bits are valid
        let bare = strip_id3v2(&mp3);
        assert_eq!((bare[0], bare[1] & 0xE0), (0xFF, 0xE0), "stripped stream must start at a frame sync");
        assert_ne!((bare[2] >> 2) & 3, 3, "reserved sample-rate bits");
        assert_ne!((bare[1] >> 1) & 3, 0, "reserved layer bits");
        std::fs::remove_dir_all(&dir).ok();
    }
}
