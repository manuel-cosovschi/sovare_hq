# Guía de configuración

## 1. Instalar la app en tu Mac

**Opción A — compilar en tu Mac** (macOS 11+, Xcode Command Line Tools, Node 20+, Rust):

```bash
xcode-select --install                       # si no lo tenés
curl https://sh.rustup.rs -sSf | sh          # Rust
git clone <este repo> && cd sovare_hq
./scripts/build-mac.sh                        # o --universal para Intel + Apple Silicon
./scripts/install-mac.sh                      # copia a /Applications
```

**Opción B — GitHub Actions:** Actions → *Build macOS app* → *Run workflow*. Descargá el artefacto (`.dmg`), abrilo y arrastrá *Sovare HQ* a Aplicaciones.

La app no está firmada con un Developer ID: la primera vez abrila con clic derecho → *Abrir* (o usá `install-mac.sh`, que quita la cuarentena).

Después de instalar: aparece en Launchpad, Spotlight (“Sovare HQ”) y podés fijarla en el Dock. Cerrar la ventana la deja en la barra de menú (ícono del isotipo); *Salir* desde ese menú la cierra.

### Dónde quedan tus datos
- Base de datos: `~/Library/Application Support/com.sovare.hq/sovare.db` (demo: `sovare-demo.db`). Actualizar la app no la toca.
- Credenciales: Llavero de macOS, servicio `com.sovare.hq`.
- Carpetas autorizadas: `~/Library/Application Support/com.sovare.hq/authorized_roots.json` (config dir).
- Comprobantes adjuntos: `…/com.sovare.hq/attachments/`.
- Backups: Settings → Datos → *Guardar backup…* (verificado con `PRAGMA integrity_check`).

## 2. Primer uso (onboarding)
1. Bienvenida (o “explorar con datos demo”).
2. Carpetas de proyectos → elegí p. ej. `~/Developer`. No se aceptan tu carpeta personal completa ni `/`.
3. GitHub (opcional) → fine-grained token read-only.
4. Revisar proyectos: escaneo + candidatos conocidos.
5. Moneda principal (USD/ARS).
6. Fuentes financieras/comerciales (podés hacerlo después).
7. IA, privacidad y sincronización (por defecto: sin IA externa).
8. Dashboard.

Todo es omitible; nada bloquea la app.

## 3. Conectar integraciones
Integrations → elegí una → seguí la guía → *Guardar y probar*. Detalle por proveedor en [INTEGRATIONS.md](INTEGRATIONS.md).

## 4. IA (opcional)
Settings → IA y privacidad:
- **Ninguno**: solo motor local (recomendaciones, preguntas frecuentes, Weekly Review).
- **OpenAI / Anthropic**: pegá la API key (Llavero), elegí modelo con tool calling, activá *análisis externo* y las categorías a compartir.
- **Modelo local** (Ollama/LM Studio): URL `http://localhost:11434`; los datos no salen de la Mac.

## 5. Desarrollo
```bash
npm run dev          # UI en navegador (SQLite WASM + IndexedDB)
npm run tauri:dev    # app nativa con hot reload
npm run check        # tsc + eslint + vitest
npm run build && npm run e2e   # smoke test E2E (Playwright)
cd src-tauri && cargo test     # tests Rust
npm run icons        # regenerar íconos desde assets/brand/sovare-isotipo.svg
```

## Versión web / PWA
`npm run build && npm run preview` sirve una PWA instalable (Chrome → Instalar). Guarda datos en IndexedDB, funciona offline. Limitaciones: credenciales cifradas en el navegador (menos seguro que el Llavero) y algunos proveedores bloquean CORS (Stripe, Mercado Pago, Vercel). La app nativa no tiene esas limitaciones.
