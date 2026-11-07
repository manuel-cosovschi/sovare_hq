// End-to-end smoke test of the web build (PWA/browser adapter) with Playwright + Chromium.
// Usage: npm run build && npm run e2e   (screenshots → e2e-shots/)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

// Playwright is resolved from the environment (global install / NODE_PATH) or a local devDependency.
const { chromium } = createRequire(import.meta.url)("playwright");

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.SHOTS_DIR ?? "e2e-shots";
await mkdir(OUT, { recursive: true });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe", detached: true });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("preview server did not start")), 20000);
  server.stdout.on("data", (d) => String(d).includes("localhost") && (clearTimeout(t), resolve()));
});

const errors = [];
const failures = [];
const check = (cond, msg) => (cond ? console.log("✓", msg) : (failures.push(msg), console.log("✗", msg)));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text()) && errors.push(`console: ${m.text()}`));

  const t0 = Date.now();
  await page.goto(BASE);
  await page.getByText("Bienvenido a Sovare HQ").waitFor();
  console.log(`  first paint → onboarding in ${Date.now() - t0} ms`);
  await page.screenshot({ path: `${OUT}/01-onboarding.png` });
  check(true, "onboarding shown on first run");

  await page.getByRole("button", { name: "Omitir y abrir dashboard" }).click();
  await page.getByText("Indicadores", { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.getByText("What needs your attention?").waitFor();
  check(await page.getByText("Sin transacciones registradas").isVisible(), "empty overview shows explicit empty state (no fake numbers)");
  await page.screenshot({ path: `${OUT}/02-overview-empty.png` });

  // create a project through the quick action
  await page.keyboard.press("Control+Shift+P");
  await page.getByPlaceholder("p. ej. GastroOS").fill("Proyecto E2E");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("heading", { name: "Proyecto E2E" }).waitFor();
  check(true, "project created and detail page opened");

  // register an expense
  await page.keyboard.press("Control+Shift+E");
  await page.getByPlaceholder("0,00").fill("1.234,50");
  await page.getByPlaceholder("p. ej. Vercel Pro").fill("Hosting E2E");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.waitForTimeout(400);

  // create a task
  await page.keyboard.press("Control+Shift+T");
  await page.getByPlaceholder("¿Qué hay que hacer?").fill("Tarea E2E");
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await page.waitForTimeout(400);

  // persistence across reload
  await page.waitForTimeout(600);
  await page.reload();
  await page.goto(`${BASE}/#/finance?tab=transactions`);
  await page.getByText("Hosting E2E").waitFor({ timeout: 8000 });
  check(true, "transaction persisted after reload (IndexedDB SQLite)");
  await page.goto(`${BASE}/#/tasks`);
  check(await page.getByText("Tarea E2E").first().waitFor({ timeout: 6000 }).then(() => true, () => false), "task persisted after reload");

  // command palette search
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Buscar proyectos/).fill("E2E");
  await page.getByRole("option", { name: /Proyecto E2E/ }).first().waitFor();
  check(true, "global search finds the project");
  await page.keyboard.press("Escape");

  // demo mode
  await page.goto(`${BASE}/#/settings?tab=data`);
  await page.getByRole("button", { name: "Abrir modo demo" }).click();
  await page.getByText("Modo demo: todos los datos visibles son ficticios").waitFor({ timeout: 30000 });
  check(true, "demo mode shows an unmistakable banner");

  const routes = [["overview", "/"], ["projects", "/projects"], ["finance", "/finance"], ["finance-intel", "/finance?tab=intelligence"], ["analytics", "/analytics"], ["marketing", "/marketing"], ["development", "/development"], ["monitoring", "/development?tab=monitoring"], ["ai", "/ai"], ["weekly", "/ai?tab=weekly"], ["tasks", "/tasks"], ["kanban", "/tasks"], ["activity", "/activity"], ["integrations", "/integrations"], ["settings", "/settings"]];
  for (const [name, route] of routes) {
    if (name === "kanban") await page.evaluate(() => localStorage.setItem("sovare.tasks.view", "kanban"));
    await page.goto(`${BASE}/#${route}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/demo-${name}.png` });
  }
  await page.evaluate(() => localStorage.setItem("sovare.tasks.view", "list"));
  // project detail
  await page.goto(`${BASE}/#/projects`);
  await page.getByText("Atlas CRM (demo)").first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/demo-project-detail.png` });
  // weekly review generation
  await page.goto(`${BASE}/#/ai?tab=weekly`);
  await page.getByRole("button", { name: "Generar reporte semanal" }).click();
  await page.getByText("Prioridades para la próxima semana").waitFor();
  await page.screenshot({ path: `${OUT}/demo-weekly.png` });
  check(true, "weekly business review generated");

  // dark mode
  await page.evaluate(() => localStorage.setItem("sovare.theme", "dark"));
  for (const [name, route] of [["overview", "/"], ["finance", "/finance"], ["tasks", "/tasks"], ["integrations", "/integrations"]]) {
    await page.goto(`${BASE}/#${route}`);
    await page.reload();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/dark-${name}.png` });
  }

  // back to real data: demo data must not leak
  await page.evaluate(() => localStorage.setItem("sovare.theme", "light"));
  await page.goto(`${BASE}/#/settings?tab=data`);
  await page.getByRole("button", { name: "Volver a datos reales" }).click();
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/#/projects`);
  await page.waitForTimeout(800);
  check(!(await page.getByText("Atlas CRM (demo)").count()), "demo data does not leak into real data");
  check(await page.getByText("Proyecto E2E").first().waitFor({ timeout: 6000 }).then(() => true, () => false), "real data intact after leaving demo");
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already stopped */
  }
}
console.log(errors.length ? `\nRuntime errors:\n${errors.join("\n")}` : "\nNo runtime errors.");
process.exit(failures.length || errors.length ? 1 : 0);
