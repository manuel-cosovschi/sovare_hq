/**
 * Authorized project folders. Native: roots are chosen with the macOS folder picker and stored by
 * Rust; scans are read-only and cannot escape those roots. Browser: File System Access API
 * (Chromium) with the same read-only heuristics.
 */
import type { FolderEvidence } from "@/domain/discovery";
import { isNative } from "./runtime";
import { idbGet, idbSet } from "./idb";

export interface FolderRoot {
  id: string;
  path: string;
  added_at: number;
}

export async function listRoots(): Promise<FolderRoot[]> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("fs_list_roots");
  }
  const handles = (await idbGet<Array<{ id: string; handle: FileSystemDirectoryHandle; added_at: number }>>("fs-roots")) ?? [];
  return handles.map((h) => ({ id: h.id, path: h.handle.name, added_at: h.added_at }));
}

export async function pickRoot(): Promise<FolderRoot | null> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("fs_pick_root");
  }
  const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador no permite elegir carpetas. Usá la app de macOS o Chrome.");
  const handle = await picker({ mode: "read" });
  const list = (await idbGet<Array<{ id: string; handle: FileSystemDirectoryHandle; added_at: number }>>("fs-roots")) ?? [];
  const entry = { id: crypto.randomUUID(), handle, added_at: Math.floor(Date.now() / 1000) };
  await idbSet("fs-roots", [...list, entry]);
  return { id: entry.id, path: handle.name, added_at: entry.added_at };
}

export async function removeRoot(id: string) {
  if (isNative()) {
    const { call } = await import("./native");
    return call("fs_remove_root", { id });
  }
  const list = (await idbGet<Array<{ id: string }>>("fs-roots")) ?? [];
  await idbSet("fs-roots", list.filter((r) => r.id !== id));
}

export async function scanRoot(id: string, maxDepth = 3): Promise<FolderEvidence[]> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("fs_scan_root", { id, maxDepth });
  }
  const list = (await idbGet<Array<{ id: string; handle: FileSystemDirectoryHandle }>>("fs-roots")) ?? [];
  const root = list.find((r) => r.id === id);
  if (!root) throw new Error("Carpeta no autorizada");
  return browserScan(root.handle, maxDepth);
}

const MARKERS = ["package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "go.mod", "Gemfile", "composer.json", "pubspec.yaml", "Package.swift", "Dockerfile"];
const READ = [...MARKERS, "vercel.json", "netlify.toml", "railway.json", "render.yaml", "fly.toml", "docker-compose.yml", "README.md"];
const SKIP = new Set(["node_modules", "target", "dist", "build", ".next", "vendor", "Pods", "venv", ".venv", "__pycache__", "coverage"]);

async function browserScan(rootHandle: FileSystemDirectoryHandle, maxDepth: number): Promise<FolderEvidence[]> {
  const out: FolderEvidence[] = [];
  const queue: Array<{ h: FileSystemDirectoryHandle; depth: number; path: string }> = [{ h: rootHandle, depth: 0, path: rootHandle.name }];
  let visited = 0;
  while (queue.length && visited < 5000) {
    const { h, depth, path } = queue.shift()!;
    visited++;
    const entries: Array<[string, FileSystemHandle]> = [];
    for await (const e of (h as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) entries.push(e);
    const names = entries.map(([n]) => n);
    const isProject = names.includes(".git") || MARKERS.some((m) => names.includes(m)) || names.some((n) => n.endsWith(".xcodeproj"));
    if (isProject) {
      const files: Record<string, string> = {};
      for (const f of READ) {
        const entry = entries.find(([n]) => n === f)?.[1];
        if (entry && entry.kind === "file") {
          const file = await (entry as FileSystemFileHandle).getFile();
          if (file.size < 64 * 1024) files[f] = await file.text();
        }
      }
      let remotes: string[] = [];
      let branch: string | null = null;
      const git = entries.find(([n]) => n === ".git")?.[1];
      if (git && git.kind === "directory") {
        try {
          const cfg = await (await (git as FileSystemDirectoryHandle).getFileHandle("config")).getFile();
          remotes = [...(await cfg.text()).matchAll(/url\s*=\s*(.+)/g)].map((m) => m[1].trim().replace(/\/\/[^@/]+@/, "//"));
          const head = await (await (git as FileSystemDirectoryHandle).getFileHandle("HEAD")).getFile();
          branch = (await head.text()).trim().replace("ref: refs/heads/", "");
        } catch {
          /* unreadable git metadata */
        }
      }
      const readme = files["README.md"] ?? null;
      delete files["README.md"];
      out.push({ path, rel_path: path, dir_name: h.name, is_git: !!git, git_remotes: remotes, git_branch: branch, last_commit_ts: null, last_commit_msg: null, root_entries: names.sort(), files, readme: readme?.slice(0, 4000) ?? null });
      continue;
    }
    if (depth >= maxDepth) continue;
    for (const [n, e] of entries) if (e.kind === "directory" && !n.startsWith(".") && !SKIP.has(n)) queue.push({ h: e as FileSystemDirectoryHandle, depth: depth + 1, path: `${path}/${n}` });
  }
  return out;
}
