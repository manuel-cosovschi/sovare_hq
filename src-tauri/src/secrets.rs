//! Credentials live in the macOS Keychain (via the `keyring` crate), never in SQLite.
//! Secrets are WRITE-ONLY from the UI: the frontend can store, delete and check presence,
//! but can never read a token back. Tokens are injected by `net::http_secure` only into
//! requests addressed to the hosts allowed for that credential.

use crate::error::{CmdError, CmdResult};
use std::collections::HashMap;

const SERVICE: &str = "com.sovare.hq";

/// Allowed credential slots and the only hosts each credential may be sent to.
pub fn allowed_hosts(key: &str) -> Option<&'static [&'static str]> {
    match key {
        "github" => Some(&["api.github.com"]),
        "vercel" => Some(&["api.vercel.com"]),
        "netlify" => Some(&["api.netlify.com"]),
        "render" => Some(&["api.render.com"]),
        "stripe" => Some(&["api.stripe.com"]),
        "mercadopago" => Some(&["api.mercadopago.com"]),
        "meta_ads" => Some(&["graph.facebook.com"]),
        "ga4" => Some(&["analyticsdata.googleapis.com", "analyticsadmin.googleapis.com"]),
        "openai" => Some(&["api.openai.com"]),
        "anthropic" => Some(&["api.anthropic.com"]),
        _ => None,
    }
}

fn entry(key: &str) -> CmdResult<keyring::Entry> {
    if allowed_hosts(key).is_none() {
        return Err(CmdError::new("invalid_secret_key", "unknown credential slot"));
    }
    keyring::Entry::new(SERVICE, key).map_err(|e| CmdError::new("keychain", e.to_string()))
}

pub fn get_secret(key: &str) -> CmdResult<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(CmdError::new("keychain", e.to_string())),
    }
}

#[tauri::command]
pub async fn secret_set(key: String, value: String) -> CmdResult<()> {
    let v = value.trim();
    if v.is_empty() || v.len() > 8192 || v.chars().any(|c| c.is_control()) {
        return Err(CmdError::new("invalid_secret", "credential is empty or malformed"));
    }
    entry(&key)?
        .set_password(v)
        .map_err(|e| CmdError::new("keychain", e.to_string()))
}

#[tauri::command]
pub async fn secret_delete(key: String) -> CmdResult<()> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(CmdError::new("keychain", e.to_string())),
    }
}

#[tauri::command]
pub async fn secret_status(keys: Vec<String>) -> CmdResult<HashMap<String, bool>> {
    let mut out = HashMap::new();
    for k in keys {
        let present = matches!(get_secret(&k), Ok(Some(_)));
        out.insert(k, present);
    }
    Ok(out)
}
