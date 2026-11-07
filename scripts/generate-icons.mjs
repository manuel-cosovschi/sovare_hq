// Builds every icon from the Sovare isotype source (assets/brand/sovare-isotipo.svg).
//   public/icon.svg, public/icons/*.png       → favicon / PWA
//   src/assets/sovare-mark.svg                → in-app mark (sidebar, onboarding, splash)
//   src-tauri/icons/app-icon-1024.png         → input for `tauri icon` (.icns for Dock/Finder/Spotlight, .ico, pngs)
//   src-tauri/icons/tray-template.png         → macOS menu-bar template icon
// Run: npm run icons   (then: npx tauri icon src-tauri/icons/app-icon-1024.png -o src-tauri/icons)
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const src = await readFile(new URL("assets/brand/sovare-isotipo.svg", root), "utf8");
const group = src.match(/<g [\s\S]*?<\/g>/)[0]; // isotype paths in a 1284×1536 box
const NAVY_TOP = "#22344F";
const NAVY_BOTTOM = "#152238";
const CREAM = "#FBF8F1";

/** Isotype placed in a square canvas: `height` = isotype height, centered at (cx, cy). */
function placed(canvas, height, color, cx = canvas / 2, cy = canvas / 2) {
  const scale = height / 1536;
  const w = 1284 * scale;
  return `<g transform="translate(${cx - w / 2} ${cy - height / 2}) scale(${scale})" color="${color}">${group}</g>`;
}

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY_TOP}"/><stop offset="1" stop-color="${NAVY_BOTTOM}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.09"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#sheen)"/>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="3"/>
  ${placed(1024, 500, CREAM)}
</svg>`;
const maskable = appIcon.replace('<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>', '<rect width="1024" height="1024" fill="url(#bg)"/>');
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="15" fill="#1D2E47"/>${placed(64, 38, CREAM)}</svg>`;
const tray = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44">${placed(44, 34, "#000")}</svg>`;

const out = (p) => new URL(p, root).pathname;
await mkdir(out("public/icons"), { recursive: true });
await mkdir(out("src/assets"), { recursive: true });
await writeFile(out("public/icon.svg"), mark);
await writeFile(out("src/assets/sovare-mark.svg"), mark);
await writeFile(out("assets/brand/sovare-hq-app-icon.svg"), appIcon);
const png = (svg, size, path) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(out(path)).then(() => console.log("wrote", path));
await png(appIcon, 1024, "src-tauri/icons/app-icon-1024.png");
await png(appIcon, 512, "public/icons/icon-512.png");
await png(appIcon, 192, "public/icons/icon-192.png");
await png(maskable, 512, "public/icons/maskable-512.png");
await png(tray, 44, "src-tauri/icons/tray-template.png");
