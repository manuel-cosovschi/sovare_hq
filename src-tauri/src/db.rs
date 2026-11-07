//! SQLite storage. One connection guarded by a mutex (single user, local-first).
//! Two profiles are supported: "main" (real data) and "demo" (clearly separated demo data).
//! Schema migrations are versioned and executed by the frontend migration runner
//! (shared with the browser/PWA adapter) through `db_exec_script`.

use crate::error::{CmdError, CmdResult};
use base64::Engine;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as J};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct DbState {
    inner: Mutex<Option<OpenDb>>,
}

struct OpenDb {
    profile: String,
    path: PathBuf,
    conn: Connection,
}

impl DbState {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }
}

fn db_path(app: &AppHandle, profile: &str) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let file = match profile {
        "main" => "sovare.db",
        "demo" => "sovare-demo.db",
        _ => return Err(CmdError::new("invalid_profile", "unknown database profile")),
    };
    Ok(dir.join(file))
}

fn open_conn(path: &PathBuf) -> CmdResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
    )?;
    Ok(conn)
}

fn to_sql(v: &J) -> Value {
    match v {
        J::Null => Value::Null,
        J::Bool(b) => Value::Integer(*b as i64),
        J::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        J::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn to_json(v: ValueRef) -> J {
    match v {
        ValueRef::Null => J::Null,
        ValueRef::Integer(i) => J::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(J::Number).unwrap_or(J::Null),
        ValueRef::Text(t) => J::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => J::String(base64::engine::general_purpose::STANDARD.encode(b)),
    }
}

fn select(conn: &Connection, sql: &str, params: &[J]) -> CmdResult<Vec<Map<String, J>>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params.iter().map(to_sql)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut m = Map::with_capacity(names.len());
        for (i, n) in names.iter().enumerate() {
            m.insert(n.clone(), to_json(row.get_ref(i)?));
        }
        out.push(m);
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct ExecResult {
    changes: usize,
    last_id: i64,
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<J>,
}

macro_rules! with_db {
    ($state:expr, $db:ident, $body:block) => {{
        let mut guard = $state.inner.lock().map_err(|_| CmdError::new("db_lock", "database lock poisoned"))?;
        let $db = guard.as_mut().ok_or_else(|| CmdError::new("db_closed", "database is not open"))?;
        $body
    }};
}

#[tauri::command]
pub async fn db_open(app: AppHandle, state: State<'_, DbState>, profile: String) -> CmdResult<String> {
    let path = db_path(&app, &profile)?;
    let conn = open_conn(&path)?;
    let mut guard = state.inner.lock().map_err(|_| CmdError::new("db_lock", "lock poisoned"))?;
    *guard = Some(OpenDb { profile, path: path.clone(), conn });
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn db_select(state: State<'_, DbState>, sql: String, params: Vec<J>) -> CmdResult<Vec<Map<String, J>>> {
    with_db!(state, db, { select(&db.conn, &sql, &params) })
}

#[tauri::command]
pub async fn db_execute(state: State<'_, DbState>, sql: String, params: Vec<J>) -> CmdResult<ExecResult> {
    with_db!(state, db, {
        let changes = db.conn.execute(&sql, params_from_iter(params.iter().map(to_sql)))?;
        Ok(ExecResult { changes, last_id: db.conn.last_insert_rowid() })
    })
}

/// Executes several statements atomically (all or nothing).
#[tauri::command]
pub async fn db_batch(state: State<'_, DbState>, statements: Vec<Statement>) -> CmdResult<usize> {
    with_db!(state, db, {
        let tx = db.conn.transaction()?;
        let mut total = 0;
        for s in &statements {
            total += tx.execute(&s.sql, params_from_iter(s.params.iter().map(to_sql)))?;
        }
        tx.commit()?;
        Ok(total)
    })
}

/// Executes a multi-statement script (used for versioned migrations, wrapped in a transaction by the caller).
#[tauri::command]
pub async fn db_exec_script(state: State<'_, DbState>, sql: String) -> CmdResult<()> {
    with_db!(state, db, {
        db.conn.execute_batch(&sql)?;
        Ok(())
    })
}

#[derive(Serialize)]
pub struct BackupResult {
    path: String,
    integrity: String,
    bytes: u64,
}

fn integrity(conn: &Connection) -> CmdResult<String> {
    Ok(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))?)
}

/// Writes a consistent copy of the open database (VACUUM INTO) to a user-chosen location and verifies it.
#[tauri::command]
pub async fn db_backup(app: AppHandle, state: State<'_, DbState>, suggested_name: String) -> CmdResult<Option<BackupResult>> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Sovare HQ backup", &["sqlite"])
        .blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let dest = fp.into_path().map_err(|e| CmdError::new("path", e.to_string()))?;
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    with_db!(state, db, {
        db.conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])?;
        Ok::<(), CmdError>(())
    })?;
    let check = Connection::open(&dest)?;
    let integ = integrity(&check)?;
    let bytes = std::fs::metadata(&dest)?.len();
    Ok(Some(BackupResult { path: dest.to_string_lossy().into_owned(), integrity: integ, bytes }))
}

/// Restores a backup chosen by the user. The candidate must pass integrity_check and contain the
/// migrations table. The current database is preserved as a timestamped .pre-restore copy.
#[tauri::command]
pub async fn db_restore(app: AppHandle, state: State<'_, DbState>) -> CmdResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Sovare HQ backup", &["sqlite", "db"])
        .blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let src = fp.into_path().map_err(|e| CmdError::new("path", e.to_string()))?;
    {
        let cand = Connection::open(&src)?;
        let integ = integrity(&cand)?;
        if integ != "ok" {
            return Err(CmdError::new("backup_corrupt", format!("integrity_check failed: {integ}")));
        }
        let has: i64 = cand.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |r| r.get(0),
        )?;
        if has == 0 {
            return Err(CmdError::new("not_a_backup", "file is not a Sovare HQ database"));
        }
    }
    let mut guard = state.inner.lock().map_err(|_| CmdError::new("db_lock", "lock poisoned"))?;
    let current = guard.take().ok_or_else(|| CmdError::new("db_closed", "database is not open"))?;
    let OpenDb { profile, path, conn } = current;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();
    drop(conn);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let safety = path.with_extension(format!("pre-restore-{ts}.db"));
    std::fs::copy(&path, &safety)?;
    for ext in ["db-wal", "db-shm"] {
        let side = path.with_extension(ext);
        if side.exists() {
            std::fs::remove_file(side).ok();
        }
    }
    std::fs::copy(&src, &path)?;
    let conn = open_conn(&path)?;
    *guard = Some(OpenDb { profile, path, conn });
    Ok(Some(safety.to_string_lossy().into_owned()))
}
