//! Read-only project discovery restricted to folders the user explicitly authorized through
//! the native folder picker. Nothing is written inside scanned folders, no commands (git, etc.)
//! are executed: git metadata is read from plain files (.git/config, HEAD, logs/HEAD).

use crate::error::{CmdError, CmdResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone)]
pub struct Root {
    pub id: String,
    pub path: String,
    pub added_at: u64,
}

const MARKERS: &[&str] = &[
    "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "go.mod", "Gemfile",
    "composer.json", "pubspec.yaml", "Package.swift", "build.gradle", "build.gradle.kts",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "deno.json", "manage.py",
];
const READ_FILES: &[&str] = &[
    "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "go.mod", "Gemfile",
    "composer.json", "pubspec.yaml", "Package.swift", "build.gradle", "build.gradle.kts",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "deno.json", "vercel.json",
    "netlify.toml", "railway.json", "railway.toml", "render.yaml", "fly.toml", "app.json",
    "src-tauri/tauri.conf.json", "firebase.json", "supabase/config.toml", "prisma/schema.prisma",
    ".env.example",
];
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".next", "vendor", "Pods", "venv", ".venv",
    "__pycache__", "Library", "Applications", "DerivedData", ".build", "out", "coverage",
];
const MAX_FILE: u64 = 64 * 1024;
const MAX_DIRS: usize = 20_000;

#[derive(Serialize)]
pub struct Evidence {
    path: String,
    rel_path: String,
    dir_name: String,
    is_git: bool,
    git_remotes: Vec<String>,
    git_branch: Option<String>,
    last_commit_ts: Option<i64>,
    last_commit_msg: Option<String>,
    root_entries: Vec<String>,
    files: BTreeMap<String, String>,
    readme: Option<String>,
}

fn roots_file(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("authorized_roots.json"))
}

pub fn load_roots(app: &AppHandle) -> CmdResult<Vec<Root>> {
    let f = roots_file(app)?;
    if !f.exists() {
        return Ok(vec![]);
    }
    let txt = std::fs::read_to_string(f)?;
    Ok(serde_json::from_str(&txt).unwrap_or_default())
}

fn save_roots(app: &AppHandle, roots: &[Root]) -> CmdResult<()> {
    let f = roots_file(app)?;
    std::fs::write(f, serde_json::to_string_pretty(roots).unwrap_or_else(|_| "[]".into()))?;
    Ok(())
}

/// Returns the canonical path if it is inside one of the authorized roots.
pub fn ensure_authorized(app: &AppHandle, path: &str) -> CmdResult<PathBuf> {
    let canon = std::fs::canonicalize(path).map_err(|_| CmdError::new("not_found", "path not found"))?;
    for r in load_roots(app)? {
        if let Ok(root) = std::fs::canonicalize(&r.path) {
            if canon.starts_with(&root) {
                return Ok(canon);
            }
        }
    }
    Err(CmdError::new("not_authorized", "path is outside the authorized folders"))
}

#[tauri::command]
pub async fn fs_pick_root(app: AppHandle) -> CmdResult<Option<Root>> {
    let Some(fp) = app.dialog().file().set_title("Elegí una carpeta de proyectos").blocking_pick_folder() else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| CmdError::new("path", e.to_string()))?;
    let canon = std::fs::canonicalize(&path)?;
    if let Some(home) = app.path().home_dir().ok().and_then(|h| std::fs::canonicalize(h).ok()) {
        if canon == home || canon == Path::new("/") {
            return Err(CmdError::new("too_broad", "choose a specific projects folder, not the home or root directory"));
        }
    }
    let mut roots = load_roots(&app)?;
    let p = canon.to_string_lossy().into_owned();
    if let Some(existing) = roots.iter().find(|r| r.path == p) {
        return Ok(Some(existing.clone()));
    }
    let root = Root {
        id: uuid::Uuid::new_v4().to_string(),
        path: p,
        added_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    };
    roots.push(root.clone());
    save_roots(&app, &roots)?;
    Ok(Some(root))
}

#[tauri::command]
pub async fn fs_list_roots(app: AppHandle) -> CmdResult<Vec<Root>> {
    load_roots(&app)
}

#[tauri::command]
pub async fn fs_remove_root(app: AppHandle, id: String) -> CmdResult<()> {
    let roots: Vec<Root> = load_roots(&app)?.into_iter().filter(|r| r.id != id).collect();
    save_roots(&app, &roots)
}

fn read_small(p: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(p).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE {
        return None;
    }
    std::fs::read_to_string(p).ok()
}

fn parse_git(dir: &Path, ev: &mut Evidence) {
    let git = dir.join(".git");
    if !git.is_dir() {
        return;
    }
    if let Some(cfg) = read_small(&git.join("config")) {
        for line in cfg.lines() {
            let l = line.trim();
            if let Some(rest) = l.strip_prefix("url") {
                if let Some(v) = rest.trim_start().strip_prefix('=') {
                    let url = v.trim().to_string();
                    // Strip credentials possibly embedded in remotes (https://user:token@host/...).
                    let cleaned = match url::Url::parse(&url) {
                        Ok(mut u) if !u.username().is_empty() || u.password().is_some() => {
                            let _ = u.set_username("");
                            let _ = u.set_password(None);
                            u.to_string()
                        }
                        _ => url,
                    };
                    ev.git_remotes.push(cleaned);
                }
            }
        }
    }
    if let Some(head) = read_small(&git.join("HEAD")) {
        ev.git_branch = head.trim().strip_prefix("ref: refs/heads/").map(|s| s.to_string());
    }
    // Last line of logs/HEAD: "<old> <new> Name <email> <ts> <tz>\t<message>"
    if let Ok(meta) = std::fs::metadata(git.join("logs/HEAD")) {
        if meta.len() < 50 * 1024 * 1024 {
            if let Ok(txt) = std::fs::read_to_string(git.join("logs/HEAD")) {
                if let Some(last) = txt.lines().rev().find(|l| !l.trim().is_empty()) {
                    let (meta_part, msg) = last.split_once('\t').unwrap_or((last, ""));
                    let parts: Vec<&str> = meta_part.split_whitespace().collect();
                    if parts.len() >= 2 {
                        ev.last_commit_ts = parts[parts.len() - 2].parse::<i64>().ok();
                    }
                    ev.last_commit_msg = Some(msg.chars().take(200).collect());
                }
            }
        }
    }
}

fn evidence_for(dir: &Path, root: &Path) -> Evidence {
    let mut ev = Evidence {
        path: dir.to_string_lossy().into_owned(),
        rel_path: dir.strip_prefix(root).unwrap_or(dir).to_string_lossy().into_owned(),
        dir_name: dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        is_git: dir.join(".git").exists(),
        git_remotes: vec![],
        git_branch: None,
        last_commit_ts: None,
        last_commit_msg: None,
        root_entries: vec![],
        files: BTreeMap::new(),
        readme: None,
    };
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten().take(500) {
            ev.root_entries.push(e.file_name().to_string_lossy().into_owned());
        }
    }
    ev.root_entries.sort();
    for f in READ_FILES {
        if let Some(c) = read_small(&dir.join(f)) {
            ev.files.insert((*f).to_string(), c);
        }
    }
    for name in ["README.md", "readme.md", "Readme.md", "README"] {
        if let Some(c) = read_small(&dir.join(name)) {
            ev.readme = Some(c.chars().take(4000).collect());
            break;
        }
    }
    parse_git(dir, &mut ev);
    ev
}

fn is_candidate(dir: &Path) -> bool {
    if dir.join(".git").exists() {
        return true;
    }
    if MARKERS.iter().any(|m| dir.join(m).is_file()) {
        return true;
    }
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().ends_with(".xcodeproj")))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn fs_scan_root(app: AppHandle, id: String, max_depth: Option<usize>) -> CmdResult<Vec<Evidence>> {
    let root = load_roots(&app)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| CmdError::new("not_authorized", "unknown folder"))?;
    let root_path = std::fs::canonicalize(&root.path)?;
    let depth_limit = max_depth.unwrap_or(3).min(5);
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut queue = VecDeque::from([(root_path.clone(), 0usize)]);
        let mut visited = 0usize;
        while let Some((dir, depth)) = queue.pop_front() {
            visited += 1;
            if visited > MAX_DIRS {
                break;
            }
            if is_candidate(&dir) {
                out.push(evidence_for(&dir, &root_path));
                continue; // do not descend into a project (monorepo packages belong to it)
            }
            if depth >= depth_limit {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let Ok(ft) = e.file_type() else { continue };
                if !ft.is_dir() || ft.is_symlink() {
                    continue;
                }
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                queue.push_back((e.path(), depth + 1));
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| CmdError::new("scan", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sovare-test-{}-{}", name, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_manifests_and_git_metadata_without_leaking_credentials() {
        let root = tmp("scan");
        let repo = root.join("gastro-os");
        std::fs::create_dir_all(repo.join(".git/logs")).unwrap();
        std::fs::write(repo.join("package.json"), r#"{"name":"gastro-os"}"#).unwrap();
        std::fs::write(repo.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(repo.join(".git/config"), "[remote \"origin\"]\n\turl = https://user:ghp_secret@github.com/Org/Gastro-OS.git\n").unwrap();
        std::fs::write(repo.join(".git/logs/HEAD"), "0000 abcd Dev <d@x> 1700000000 +0000\tcommit: first\n").unwrap();
        assert!(is_candidate(&repo));
        let ev = evidence_for(&repo, &root);
        assert!(ev.is_git);
        assert_eq!(ev.git_branch.as_deref(), Some("main"));
        assert_eq!(ev.last_commit_ts, Some(1700000000));
        assert!(ev.files.contains_key("package.json"));
        assert_eq!(ev.git_remotes.len(), 1);
        assert!(!ev.git_remotes[0].contains("ghp_secret"), "token leaked: {}", ev.git_remotes[0]);
        assert!(!ev.git_remotes[0].contains("user@"));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn large_files_are_not_read() {
        let root = tmp("large");
        std::fs::write(root.join("package.json"), vec![b' '; (MAX_FILE + 1) as usize]).unwrap();
        assert!(read_small(&root.join("package.json")).is_none());
        std::fs::remove_dir_all(root).ok();
    }
}
