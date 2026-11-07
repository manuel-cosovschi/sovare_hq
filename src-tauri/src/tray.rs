//! macOS menu bar (tray) access: quick navigation, quick actions and a compact summary
//! pushed by the frontend (`tray_update`).

use crate::error::{CmdError, CmdResult};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const TRAY_ID: &str = "sovare-tray";

fn build_menu<R: Runtime>(app: &AppHandle<R>, summary: &[String]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    if !summary.is_empty() {
        for (i, line) in summary.iter().take(8).enumerate() {
            menu.append(&MenuItem::with_id(app, format!("info-{i}"), line, false, None::<&str>)?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(app, "show", "Abrir Sovare HQ", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "nav:/", "Overview", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "nav:/tasks", "Tareas de hoy", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "action:expense", "Registrar gasto…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "action:income", "Registrar ingreso…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "action:task", "Nueva tarea…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "action:search", "Buscar…", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Salir de Sovare HQ", true, None::<&str>)?)?;
    Ok(menu)
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Sovare HQ")
        .menu(&build_menu(app, &[])?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "quit" => app.exit(0),
                "show" => show_main(app),
                _ => {
                    show_main(app);
                    let _ = app.emit("tray-action", id.to_string());
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn reopen<R: Runtime>(app: &AppHandle<R>) {
    show_main(app);
}

#[tauri::command]
pub async fn tray_update(app: AppHandle, summary: Vec<String>) -> CmdResult<()> {
    let clean: Vec<String> = summary.into_iter().map(|s| s.chars().take(80).collect()).collect();
    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| CmdError::new("tray", "tray not available"))?;
    tray.set_menu(Some(build_menu(&app, &clean)?))?;
    Ok(())
}
