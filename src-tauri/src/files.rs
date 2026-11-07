//! File operations that always go through a native dialog chosen by the user, plus a private
//! attachments folder inside the app data directory.

use crate::error::{CmdError, CmdResult};
use crate::fsscan::ensure_authorized;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MAX_ATTACHMENT: u64 = 25 * 1024 * 1024;
const MAX_TEXT_IMPORT: u64 = 15 * 1024 * 1024;

#[tauri::command]
pub async fn save_file(
    app: AppHandle,
    suggested_name: String,
    content: String,
    base64: bool,
    extension: String,
) -> CmdResult<Option<String>> {
    let ext = extension.trim_start_matches('.').to_string();
    if !["csv", "pdf", "json", "txt", "md"].contains(&ext.as_str()) {
        return Err(CmdError::new("invalid_extension", "unsupported export format"));
    }
    let Some(fp) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| CmdError::new("path", e.to_string()))?;
    let bytes = if base64 {
        base64::engine::general_purpose::STANDARD
            .decode(content.as_bytes())
            .map_err(|_| CmdError::new("invalid_base64", "invalid content"))?
    } else {
        content.into_bytes()
    };
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[derive(Serialize)]
pub struct Attachment {
    name: String,
    original_name: String,
    bytes: u64,
}

fn attachments_dir(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    let d = app.path().app_data_dir()?.join("attachments");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

#[tauri::command]
pub async fn attach_file(app: AppHandle) -> CmdResult<Option<Attachment>> {
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("Comprobantes", &["pdf", "png", "jpg", "jpeg", "heic", "txt", "csv"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let src = fp.into_path().map_err(|e| CmdError::new("path", e.to_string()))?;
    let meta = std::fs::metadata(&src)?;
    if meta.len() > MAX_ATTACHMENT {
        return Err(CmdError::new("too_large", "attachment exceeds 25 MB"));
    }
    let ext = src.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| "bin".into());
    let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    std::fs::copy(&src, attachments_dir(&app)?.join(&name))?;
    Ok(Some(Attachment {
        name,
        original_name: src.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        bytes: meta.len(),
    }))
}

#[tauri::command]
pub async fn open_attachment(app: AppHandle, name: String) -> CmdResult<()> {
    let valid = name.len() < 80
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && !name.contains("..");
    if !valid {
        return Err(CmdError::new("invalid_name", "invalid attachment name"));
    }
    let p = attachments_dir(&app)?.join(&name);
    if !p.is_file() {
        return Err(CmdError::new("not_found", "attachment not found"));
    }
    app.opener()
        .open_path(p.to_string_lossy(), None::<&str>)
        .map_err(|e| CmdError::new("open", e.to_string()))
}

#[derive(Serialize)]
pub struct TextFile {
    name: String,
    content: String,
}

#[tauri::command]
pub async fn pick_text_file(app: AppHandle, extensions: Vec<String>) -> CmdResult<Option<TextFile>> {
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).filter(|e| ["csv", "tsv", "txt", "json"].contains(e)).collect();
    let Some(fp) = app.dialog().file().add_filter("Datos", &exts).blocking_pick_file() else {
        return Ok(None);
    };
    let p = fp.into_path().map_err(|e| CmdError::new("path", e.to_string()))?;
    if std::fs::metadata(&p)?.len() > MAX_TEXT_IMPORT {
        return Err(CmdError::new("too_large", "file exceeds 15 MB"));
    }
    let bytes = std::fs::read(&p)?;
    Ok(Some(TextFile {
        name: p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        content: String::from_utf8_lossy(&bytes).into_owned(),
    }))
}

#[tauri::command]
pub async fn reveal_path(app: AppHandle, path: String) -> CmdResult<()> {
    let p = ensure_authorized(&app, &path)?;
    app.opener().reveal_item_in_dir(p).map_err(|e| CmdError::new("open", e.to_string()))
}

#[tauri::command]
pub async fn open_in_editor(app: AppHandle, path: String) -> CmdResult<()> {
    let p = ensure_authorized(&app, &path)?;
    let mut u = url::Url::parse("vscode://file").map_err(|e| CmdError::new("url", e.to_string()))?;
    u.set_path(&p.to_string_lossy());
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| CmdError::new("open", e.to_string()))
}

#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> CmdResult<()> {
    let u = url::Url::parse(&url).map_err(|_| CmdError::new("invalid_url", "invalid URL"))?;
    if !["https", "http", "mailto"].contains(&u.scheme()) {
        return Err(CmdError::new("invalid_scheme", "only http(s) and mailto links can be opened"));
    }
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| CmdError::new("open", e.to_string()))
}

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    data_dir: String,
    platform: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> CmdResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: app.path().app_data_dir()?.to_string_lossy().into_owned(),
        platform: std::env::consts::OS.to_string(),
    })
}
