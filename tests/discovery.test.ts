import { describe, expect, it } from "vitest";
import { analyzeFolder, dedupeCandidates, findExisting, matchKnown, normalizeRemote, type FolderEvidence } from "@/domain/discovery";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const daysAgo = (d: number) => Math.floor((NOW - d * 86_400_000) / 1000);

const ev = (p: Partial<FolderEvidence> = {}): FolderEvidence => ({
  path: "/Users/me/code/app",
  rel_path: "app",
  dir_name: "app",
  is_git: false,
  git_remotes: [],
  git_branch: null,
  last_commit_ts: null,
  last_commit_msg: null,
  root_entries: [],
  files: {},
  readme: null,
  ...p,
});

describe("normalizeRemote", () => {
  it.each([
    ["git@github.com:Owner/Repo.git", "github.com/owner/repo"],
    ["git@github.com:owner/repo", "github.com/owner/repo"],
    ["https://github.com/owner/repo", "github.com/owner/repo"],
    ["https://github.com/owner/repo.git", "github.com/owner/repo"],
    ["https://github.com/Owner/Repo/", "github.com/owner/repo"],
    ["ssh://git@github.com/owner/repo", "github.com/owner/repo"],
    ["ssh://git@github.com:22/owner/repo.git", "github.com/owner/repo"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeRemote(input)).toBe(expected);
  });

  it("strips credentials embedded in the URL", () => {
    const out = normalizeRemote("https://user:token123@github.com/o/r.git");
    expect(out).toBe("github.com/o/r");
    expect(out).not.toContain("token123");
    expect(out).not.toContain("user");
  });

  it("returns null for non-remotes", () => {
    expect(normalizeRemote("/local/path/repo")).toBeNull();
    expect(normalizeRemote("ftp://example.com/x")).toBeNull();
    expect(normalizeRemote("https://github.com/")).toBeNull();
  });
});

describe("analyzeFolder", () => {
  it("detects Next.js + TypeScript + PostgreSQL + Vercel from manifests", () => {
    const c = analyzeFolder(
      ev({
        dir_name: "gastro-os",
        files: {
          "package.json": JSON.stringify({ name: "gastro-os", description: "Gestión gastronómica", dependencies: { next: "15", react: "19", pg: "8" }, devDependencies: { typescript: "5" } }),
          "vercel.json": "{}",
        },
      }),
      NOW,
    );
    expect(c.languages).toEqual(["TypeScript"]);
    expect(c.frameworks).toEqual(expect.arrayContaining(["Next.js", "React"]));
    expect(c.databaseTech).toBe("PostgreSQL");
    expect(c.hosting).toBe("Vercel");
    expect(c.description).toBe("Gestión gastronómica");
    expect(c.name).toBe("Gastro Os");
    expect(c.knownMatch).toBe("GastroOS");
    expect(c.key).toBe("local:/Users/me/code/app");
  });

  it("does not assume a host for Next.js without deploy config", () => {
    const c = analyzeFolder(ev({ files: { "package.json": JSON.stringify({ dependencies: { next: "15" } }) } }), NOW);
    expect(c.hosting).toBeNull();
    expect(c.languages).toEqual(["JavaScript"]);
  });

  it("detects Rust from Cargo.toml and Python frameworks from pyproject", () => {
    const rust = analyzeFolder(ev({ files: { "Cargo.toml": '[package]\nname = "trading-engine"\nversion = "0.1.0"' } }), NOW);
    expect(rust.languages).toEqual(["Rust"]);
    expect(rust.name).toBe("Trading Engine");

    const py = analyzeFolder(ev({ files: { "pyproject.toml": '[project]\ndependencies = ["fastapi", "ccxt"]' } }), NOW);
    expect(py.languages).toEqual(["Python"]);
    expect(py.frameworks).toEqual(expect.arrayContaining(["FastAPI", "CCXT"]));
    expect(py.type).toBe("bot");
  });

  it("infers type from evidence (mobile / desktop / api)", () => {
    expect(analyzeFolder(ev({ files: { "package.json": JSON.stringify({ dependencies: { expo: "1", "react-native": "1" } }) } }), NOW).type).toBe("mobile");
    expect(analyzeFolder(ev({ files: { "package.json": "{}", "src-tauri/tauri.conf.json": "{}" } }), NOW).type).toBe("desktop");
    expect(analyzeFolder(ev({ files: { "package.json": JSON.stringify({ dependencies: { express: "4" } }) } }), NOW).type).toBe("api");
  });

  it("suggests status only from evidence and never 'production'", () => {
    const recent = analyzeFolder(ev({ is_git: true, last_commit_ts: daysAgo(3), files: { "package.json": "{}", "vercel.json": "{}" } }), NOW);
    expect(recent.suggestedStatus).toBe("development");
    expect(recent.statusReasons.join(" ")).toMatch(/no implica que esté en producción/);

    const old = analyzeFolder(ev({ is_git: true, last_commit_ts: daysAgo(200) }), NOW);
    expect(old.suggestedStatus).toBe("paused");

    const noGit = analyzeFolder(ev({ files: { "go.mod": "module x" } }), NOW);
    expect(noGit.suggestedStatus).toBe("development");

    const empty = analyzeFolder(ev(), NOW);
    expect(empty.suggestedStatus).toBe("idea");

    for (const c of [recent, old, noGit, empty]) expect(["production", "launched"]).not.toContain(c.suggestedStatus);
  });

  it("uses the canonical remote as key and converts the commit timestamp", () => {
    const ts = daysAgo(1);
    const c = analyzeFolder(ev({ is_git: true, git_remotes: ["git@github.com:Sovare/Cerquita.git"], last_commit_ts: ts }), NOW);
    expect(c.canonicalRemote).toBe("github.com/sovare/cerquita");
    expect(c.key).toBe("github.com/sovare/cerquita");
    expect(c.lastCommitAt).toBe(new Date(ts * 1000).toISOString());
  });
});

describe("dedupeCandidates", () => {
  it("merges the same remote found in two folders", () => {
    const a = analyzeFolder(ev({ path: "/a/cerquita", dir_name: "cerquita", git_remotes: ["git@github.com:sovare/cerquita.git"], last_commit_ts: daysAgo(10), last_commit_msg: "old" }), NOW);
    const b = analyzeFolder(ev({ path: "/b/cerquita-copy", dir_name: "cerquita-copy", git_remotes: ["https://github.com/sovare/cerquita"], last_commit_ts: daysAgo(1), last_commit_msg: "new" }), NOW);
    const other = analyzeFolder(ev({ path: "/c/fitnow", dir_name: "fitnow" }), NOW);
    const out = dedupeCandidates([a, b, other]);
    expect(out).toHaveLength(2);
    const merged = out.find((c) => c.key === "github.com/sovare/cerquita")!;
    expect(merged.paths).toEqual(["/a/cerquita", "/b/cerquita-copy"]);
    expect(merged.lastCommitMsg).toBe("new");
    // input candidates are not mutated
    expect(a.paths).toEqual(["/a/cerquita"]);
  });
});

describe("findExisting", () => {
  const c = analyzeFolder(ev({ path: "/code/memo", dir_name: "memo", git_remotes: ["git@github.com:me/memo.git"] }), NOW);

  it("matches by canonical key, local path or slug", () => {
    expect(findExisting(c, [{ projectId: "x", slug: "other", canonicalKeys: ["github.com/me/memo"], localPath: null }])).toBe("x");
    expect(findExisting(c, [{ projectId: "y", slug: "other", canonicalKeys: [], localPath: "/code/memo" }])).toBe("y");
    expect(findExisting(c, [{ projectId: "z", slug: "memo", canonicalKeys: [], localPath: null }])).toBe("z");
    expect(findExisting(c, [{ projectId: "n", slug: "nope", canonicalKeys: ["github.com/me/other"], localPath: "/elsewhere" }])).toBeNull();
  });

  it("prefers a repo/path match over a slug match", () => {
    const existing = [
      { projectId: "slug", slug: "memo", canonicalKeys: [], localPath: null },
      { projectId: "repo", slug: "memo-app", canonicalKeys: ["github.com/me/memo"], localPath: null },
    ];
    expect(findExisting(c, existing)).toBe("repo");
  });
});

describe("matchKnown", () => {
  it.each([
    ["gastro-os", "GastroOS"],
    ["GastroOS", "GastroOS"],
    ["gastro-os-web", "GastroOS"],
    ["my-cerquita", "Cerquita"],
    ["Fit Now", "FitNow"],
    ["casaca_de_cancha", "Casaca de Cancha"],
  ])("%s → %s", (name, expected) => {
    expect(matchKnown(name)).toBe(expected);
  });

  it("does not match unrelated names", () => {
    expect(matchKnown("memorial")).toBeNull();
    expect(matchKnown("random-thing")).toBeNull();
  });
});
