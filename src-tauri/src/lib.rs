mod db;
mod error;
mod files;
mod fsscan;
mod net;
mod secrets;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(db::DbState::new())
        .setup(|app| {
            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS convention: closing the window keeps the app alive in the menu bar / Dock.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_select,
            db::db_execute,
            db::db_batch,
            db::db_exec_script,
            db::db_backup,
            db::db_restore,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_status,
            net::http_secure,
            net::http_public,
            fsscan::fs_pick_root,
            fsscan::fs_list_roots,
            fsscan::fs_remove_root,
            fsscan::fs_scan_root,
            files::reveal_path,
            files::open_in_editor,
            files::open_url,
            files::save_file,
            files::attach_file,
            files::open_attachment,
            files::pick_text_file,
            files::app_info,
            tray::tray_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Sovare HQ")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::reopen(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
