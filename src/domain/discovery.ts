/**
 * Project discovery: turns read-only folder evidence (collected by the native layer or the
 * browser File System Access API) into project candidates. Pure & deterministic.
 */
import type { ProjectStatus, ProjectType } from "./types";
import { slugify } from "@/lib/util";

export interface FolderEvidence {
  path: string;
  rel_path: string;
  dir_name: string;
  is_git: boolean;
  git_remotes: string[];
  git_branch: string | null;
  last_commit_ts: number | null;
  last_commit_msg: string | null;
  root_entries: string[];
  files: Record<string, string>;
  readme: string | null;
}

export interface Candidate {
  key: string; // dedupe key: canonical remote or local path
  name: string;
  slug: string;
  description: string | null;
  type: ProjectType;
  languages: string[];
  frameworks: string[];
  databaseTech: string | null;
  hosting: string | null;
  remotes: string[];
  canonicalRemote: string | null;
  paths: string[];
  branch: string | null;
  lastCommitAt: string | null;
  lastCommitMsg: string | null;
  suggestedStatus: ProjectStatus;
  statusReasons: string[];
  evidence: string[];
  knownMatch: string | null;
}

/** Normalizes git remotes so local clones and GitHub repos map to the same key. */
export function normalizeRemote(url: string): string | null {
  const s = url.trim();
  let m = s.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  m = s.match(/^(?:ssh:\/\/)?(?:git@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (s.startsWith("ssh://") && m) return `${m[1]}/${m[2]}`.toLowerCase();
  try {
    const u = new URL(s);
    if (!/^https?:|^git:/.test(u.protocol)) return null;
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!path) return null;
    return `${u.hostname}/${path}`.toLowerCase();
  } catch {
    return null;
  }
}

export const KNOWN_CANDIDATES: Array<{ name: string; aliases: string[]; type: ProjectType; category: string; description: string }> = [
  { name: "GastroOS", aliases: ["gastroos", "gastro-os", "gastro"], type: "saas", category: "Gastronomía", description: "Software de gestión gastronómica." },
  { name: "CosovGO", aliases: ["cosovgo", "cosov-go", "cosov"], type: "saas", category: "Gestión", description: "Sistema SaaS de gestión." },
  { name: "Cerquita", aliases: ["cerquita"], type: "marketplace", category: "Marketplace local", description: "Marketplace local." },
  { name: "FitNow", aliases: ["fitnow", "fit-now"], type: "mobile", category: "Salud y running", description: "Aplicación de actividad física y running." },
  { name: "MEMO", aliases: ["memo", "memo-app"], type: "mobile", category: "Productividad", description: "Memoria personal y recordatorios inteligentes." },
  { name: "PROFE", aliases: ["profe", "profe-ai"], type: "mobile", category: "Fitness / IA", description: "Entrenador personal con IA." },
  { name: "Casaca de Cancha", aliases: ["casaca-de-cancha", "casacadecancha", "casaca"], type: "ecommerce", category: "E-commerce", description: "Negocio de comercio electrónico." },
  { name: "Reservas de alojamientos", aliases: ["reservas", "booking", "alojamientos", "hospedaje"], type: "saas", category: "Hospitalidad", description: "Sistema de gestión de reservas para alojamientos." },
  { name: "Trading Bot", aliases: ["trading-bot", "tradingbot", "trading"], type: "bot", category: "Finanzas", description: "Sistema de trading y monitoreo financiero." },
  { name: "Sovare", aliases: ["sovare"], type: "brand", category: "Organización", description: "Marca y ecosistema de software (organización contenedora)." },
];

export function matchKnown(name: string): string | null {
  const n = slugify(name);
  for (const k of KNOWN_CANDIDATES) {
    if (k.aliases.some((a) => n === a || n.startsWith(a + "-") || n.endsWith("-" + a) || n.replace(/-/g, "") === a.replace(/-/g, ""))) return k.name;
  }
  return null;
}

const FRAMEWORK_DEPS: Array<[string, string]> = [
  ["next", "Next.js"], ["nuxt", "Nuxt"], ["@sveltejs/kit", "SvelteKit"], ["astro", "Astro"], ["@remix-run/react", "Remix"],
  ["react-native", "React Native"], ["expo", "Expo"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["@angular/core", "Angular"],
  ["express", "Express"], ["@nestjs/core", "NestJS"], ["fastify", "Fastify"], ["hono", "Hono"], ["@tauri-apps/api", "Tauri"], ["electron", "Electron"],
  ["tailwindcss", "Tailwind CSS"], ["vite", "Vite"], ["@supabase/supabase-js", "Supabase"], ["firebase", "Firebase"], ["stripe", "Stripe"],
  ["mercadopago", "Mercado Pago"], ["prisma", "Prisma"], ["@prisma/client", "Prisma"], ["drizzle-orm", "Drizzle"], ["ccxt", "CCXT"],
];
const DB_DEPS: Array<[string, string]> = [
  ["pg", "PostgreSQL"], ["postgres", "PostgreSQL"], ["mysql2", "MySQL"], ["mongoose", "MongoDB"], ["mongodb", "MongoDB"],
  ["better-sqlite3", "SQLite"], ["sqlite3", "SQLite"], ["@supabase/supabase-js", "PostgreSQL (Supabase)"], ["firebase", "Firestore"], ["redis", "Redis"],
];
const PY_FRAMEWORKS: Array<[RegExp, string]> = [
  [/django/i, "Django"], [/fastapi/i, "FastAPI"], [/flask/i, "Flask"], [/ccxt/i, "CCXT"], [/python-binance/i, "Binance API"], [/pandas/i, "pandas"],
];

function safeJson(s: string | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function prettify(dir: string): string {
  return dir.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function analyzeFolder(ev: FolderEvidence, now = Date.now()): Candidate {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const evidence: string[] = [];
  let databaseTech: string | null = null;
  let hosting: string | null = null;
  let type: ProjectType = "web";
  let name = prettify(ev.dir_name);
  let description: string | null = null;

  const pkg = safeJson(ev.files["package.json"]);
  if (pkg) {
    evidence.push("package.json");
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
    languages.add(deps.typescript || ev.root_entries.includes("tsconfig.json") ? "TypeScript" : "JavaScript");
    for (const [d, label] of FRAMEWORK_DEPS) if (d in deps) frameworks.add(label);
    for (const [d, label] of DB_DEPS) if (d in deps && !databaseTech) databaseTech = label;
    if (typeof pkg.name === "string" && pkg.name && !pkg.name.startsWith("@") && pkg.name !== "app") name = prettify(pkg.name);
    if (typeof pkg.description === "string" && pkg.description) description = pkg.description;
  }
  const cargo = ev.files["Cargo.toml"];
  if (cargo) {
    evidence.push("Cargo.toml");
    languages.add("Rust");
    const n = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (n && !pkg) name = prettify(n[1]);
  }
  const py = (ev.files["pyproject.toml"] ?? "") + (ev.files["requirements.txt"] ?? "");
  if (py) {
    evidence.push(ev.files["pyproject.toml"] ? "pyproject.toml" : "requirements.txt");
    languages.add("Python");
    for (const [re, label] of PY_FRAMEWORKS) if (re.test(py)) frameworks.add(label);
  }
  if (ev.files["go.mod"]) { languages.add("Go"); evidence.push("go.mod"); }
  if (ev.files["Gemfile"]) {
    languages.add("Ruby");
    evidence.push("Gemfile");
    if (/rails/.test(ev.files["Gemfile"])) frameworks.add("Rails");
  }
  if (ev.files["composer.json"]) {
    languages.add("PHP");
    evidence.push("composer.json");
    if (/laravel/.test(ev.files["composer.json"])) frameworks.add("Laravel");
  }
  if (ev.files["pubspec.yaml"]) { languages.add("Dart"); frameworks.add("Flutter"); evidence.push("pubspec.yaml"); }
  if (ev.files["Package.swift"] || ev.root_entries.some((e) => e.endsWith(".xcodeproj"))) {
    languages.add("Swift");
    evidence.push("Xcode / Swift package");
  }
  if (ev.files["build.gradle"] || ev.files["build.gradle.kts"]) { languages.add("Kotlin/Java"); evidence.push("Gradle"); }
  if (ev.files["Dockerfile"] || ev.files["docker-compose.yml"] || ev.files["docker-compose.yaml"]) evidence.push("Docker");
  if (ev.files["src-tauri/tauri.conf.json"]) frameworks.add("Tauri");
  if (ev.files["prisma/schema.prisma"]) {
    const p = ev.files["prisma/schema.prisma"].match(/provider\s*=\s*"(postgresql|mysql|sqlite|mongodb)"/);
    if (p) databaseTech = { postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite", mongodb: "MongoDB" }[p[1]] ?? databaseTech;
  }
  if (ev.files["supabase/config.toml"]) databaseTech = databaseTech ?? "PostgreSQL (Supabase)";

  if (ev.files["vercel.json"]) hosting = "Vercel";
  else if (ev.files["netlify.toml"]) hosting = "Netlify";
  else if (ev.files["railway.json"] || ev.files["railway.toml"]) hosting = "Railway";
  else if (ev.files["render.yaml"]) hosting = "Render";
  else if (ev.files["fly.toml"]) hosting = "Fly.io";
  else if (ev.files["firebase.json"]) hosting = "Firebase";
  else if (frameworks.has("Next.js")) hosting = null; // unknown: don't assume Vercel
  if (hosting) evidence.push(`Config de ${hosting}`);

  // Type inference (evidence-based, editable later)
  if (frameworks.has("React Native") || frameworks.has("Expo") || frameworks.has("Flutter") || languages.has("Swift")) type = "mobile";
  else if (frameworks.has("Tauri") || frameworks.has("Electron")) type = "desktop";
  else if (frameworks.has("CCXT") || frameworks.has("Binance API")) type = "bot";
  else if (pkg && !frameworks.has("React") && !frameworks.has("Vue") && !frameworks.has("Next.js") && (frameworks.has("Express") || frameworks.has("NestJS") || frameworks.has("Fastify"))) type = "api";

  if (!description && ev.readme) {
    const para = ev.readme
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^#.*$/gm, "").replace(/!\[.*?\]\(.*?\)/g, "").replace(/<[^>]+>/g, "").trim())
      .find((p) => p.length > 20 && !p.startsWith("```"));
    if (para) description = para.slice(0, 280);
  }
  if (ev.readme) evidence.push("README");
  if (ev.is_git) evidence.push("Repositorio Git");

  const remotes = ev.git_remotes;
  const canonicalRemote = remotes.map(normalizeRemote).find((r): r is string => !!r) ?? null;
  const lastCommitAt = ev.last_commit_ts ? new Date(ev.last_commit_ts * 1000).toISOString() : null;

  // Status suggestion: only from verifiable evidence; the user confirms.
  const statusReasons: string[] = [];
  let suggestedStatus: ProjectStatus = "idea";
  if (ev.last_commit_ts) {
    const days = Math.floor((now - ev.last_commit_ts * 1000) / 86_400_000);
    if (days <= 30) {
      suggestedStatus = "development";
      statusReasons.push(`Último commit hace ${days} día(s)`);
    } else if (days > 120) {
      suggestedStatus = "paused";
      statusReasons.push(`Sin commits hace ${days} días`);
    } else {
      suggestedStatus = "development";
      statusReasons.push(`Último commit hace ${days} días`);
    }
  } else if (evidence.length) {
    suggestedStatus = "development";
    statusReasons.push("Existe código fuente pero no hay historial Git legible");
  }
  if (hosting) statusReasons.push(`Tiene configuración de despliegue (${hosting}); no implica que esté en producción`);

  return {
    key: canonicalRemote ?? `local:${ev.path}`,
    name,
    slug: slugify(name),
    description,
    type,
    languages: [...languages],
    frameworks: [...frameworks],
    databaseTech,
    hosting,
    remotes,
    canonicalRemote,
    paths: [ev.path],
    branch: ev.git_branch,
    lastCommitAt,
    lastCommitMsg: ev.last_commit_msg,
    suggestedStatus,
    statusReasons,
    evidence,
    knownMatch: matchKnown(name) ?? matchKnown(ev.dir_name),
  };
}

/** Merges candidates that represent the same repository (same canonical remote). */
export function dedupeCandidates(cands: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of cands) {
    const existing = map.get(c.key);
    if (!existing) {
      map.set(c.key, { ...c });
      continue;
    }
    existing.paths = [...new Set([...existing.paths, ...c.paths])];
    if ((c.lastCommitAt ?? "") > (existing.lastCommitAt ?? "")) {
      existing.lastCommitAt = c.lastCommitAt;
      existing.lastCommitMsg = c.lastCommitMsg;
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface ExistingRef {
  projectId: string;
  slug: string;
  canonicalKeys: string[];
  localPath: string | null;
}

/** Finds an already-registered project for a candidate (by repo key, local path or slug). */
export function findExisting(c: Candidate, existing: ExistingRef[]): string | null {
  for (const e of existing) {
    if (c.canonicalRemote && e.canonicalKeys.includes(c.canonicalRemote)) return e.projectId;
    if (e.localPath && c.paths.includes(e.localPath)) return e.projectId;
  }
  const bySlug = existing.find((e) => e.slug === c.slug);
  return bySlug?.projectId ?? null;
}
