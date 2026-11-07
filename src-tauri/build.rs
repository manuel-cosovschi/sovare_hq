// Every custom command must be listed here; the capability file then grants them
// explicitly to the main window (deny-by-default for anything not listed).
const COMMANDS: &[&str] = &[
    "db_open",
    "db_select",
    "db_execute",
    "db_batch",
    "db_exec_script",
    "db_backup",
    "db_restore",
    "secret_set",
    "secret_delete",
    "secret_status",
    "http_secure",
    "http_public",
    "fs_pick_root",
    "fs_list_roots",
    "fs_remove_root",
    "fs_scan_root",
    "reveal_path",
    "open_in_editor",
    "open_url",
    "save_file",
    "attach_file",
    "open_attachment",
    "pick_text_file",
    "app_info",
    "tray_update",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
