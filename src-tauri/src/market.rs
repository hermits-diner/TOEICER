//! What the locks on bought sets need from outside the webview (exam-market's buyer-only design): which PC this is, and
//! a place for secrets that does not travel with the app's data folder or its backups. The sealing itself is in
//! src/lib/sealed.ts.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::brand::PREFIX;

/// The same in every app, so a PC counts once on an account however many of the apps it has.
const DEVICE_SALT: &str = "moduEtest device v1";

/// Debug builds only: pretends to be another PC (another device id, another credential store), so two PCs can be tried
/// on one. A release build ignores it.
fn test_profile() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("MARKET_TEST_PROFILE").ok().filter(|p| !p.is_empty())
}

fn device_id_of(machine_guid: &str, profile: Option<&str>) -> String {
    let mut h = Sha256::new();
    h.update(machine_guid.trim().to_lowercase().as_bytes());
    h.update(DEVICE_SALT.as_bytes());
    if let Some(p) = profile {
        h.update(p.as_bytes());
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Windows keeps this across app reinstalls and clearing the app's data, so the same PC stays the same device. A new
/// Windows install is a new device, which only means signing in again.
#[cfg(windows)]
fn machine_guid() -> Result<String, String> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let mut buf = [0u16; 128];
    let mut size = (buf.len() * 2) as u32;
    let read = unsafe {
        RegGetValueW(HKEY_LOCAL_MACHINE, w!("SOFTWARE\\Microsoft\\Cryptography"), w!("MachineGuid"), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size))
    };
    if read.is_err() {
        return Err("이 PC의 식별값을 읽지 못했습니다.".into());
    }
    Ok(String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
}

#[cfg(not(windows))]
fn machine_guid() -> Result<String, String> {
    Err("구매한 세트는 Windows에서 열 수 있습니다.".into())
}

#[derive(Serialize)]
pub struct MarketDevice {
    id: String,
    name: String,
}

#[tauri::command]
pub fn market_device() -> Result<MarketDevice, String> {
    let profile = test_profile();
    let name = std::env::var("COMPUTERNAME").unwrap_or_default();
    Ok(MarketDevice {
        id: device_id_of(&machine_guid()?, profile.as_deref()),
        name: profile.map_or(name.clone(), |p| format!("{name} ({p})")),
    })
}

/// Only these names, so the commands cannot read the app's other credentials (the API keys in ai.rs have their own service).
fn check_name(name: &str) -> Result<(), String> {
    let token = name.strip_prefix("token:").is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()));
    if name == "device-key" || token {
        Ok(())
    } else {
        Err(format!("알 수 없는 이름입니다: {name}"))
    }
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    check_name(name)?;
    let service = test_profile().map_or(format!("{PREFIX}.market"), |p| format!("{PREFIX}.market.{p}"));
    keyring::Entry::new(&service, name).map_err(|e| format!("자격 증명 저장소를 열 수 없습니다: {e}"))
}

#[tauri::command]
pub fn market_secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("자격 증명을 읽지 못했습니다: {e}")),
    }
}

#[tauri::command]
pub fn market_secret_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(&value).map_err(|e| format!("자격 증명을 저장하지 못했습니다: {e}"))
}

#[tauri::command]
pub fn market_secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("자격 증명을 지우지 못했습니다: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_machine_guid_makes_the_same_id_in_every_app() {
        // Fixed: changing it would make every PC a new device on every account.
        assert_eq!(device_id_of("  1A2B3C4D-0000-1111-2222-333344445555\n", None), device_id_of("1a2b3c4d-0000-1111-2222-333344445555", None));
        assert_eq!(device_id_of("1a2b3c4d-0000-1111-2222-333344445555", None), "211263f671b01220677eff1ead4247061ac36bdfd1aa60a8d385acb24a0e8d13");
        assert_ne!(device_id_of("a", None), device_id_of("b", None));
        assert_ne!(device_id_of("a", None), device_id_of("a", Some("second")));
    }

    #[test]
    fn only_its_own_names_are_reachable() {
        assert!(check_name("device-key").is_ok());
        assert!(check_name(&format!("token:{}", "a".repeat(64))).is_ok());
        for bad in ["", "gemini", "token:", "token:abc", "../device-key", &format!("token:{}", "z".repeat(64))] {
            assert!(check_name(bad).is_err(), "{bad}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn reads_this_pcs_guid() {
        let guid = machine_guid().unwrap();
        assert_eq!(guid.len(), 36, "{guid}");
        assert_eq!(market_device().unwrap().id.len(), 64);
    }
}
