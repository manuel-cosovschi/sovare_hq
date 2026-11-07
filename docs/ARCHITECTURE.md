# Arquitectura

```
┌─────────────────────────── WebView (React 19 + TS) ───────────────────────────┐
│ features/* (pantallas) → app/hooks (TanStack Query) → repos/* (zod + SQL)      │
│ domain/* (lógica pura: finanzas, alertas, prioridades, ads, discovery, CSV)    │
│ integrations/* (adapters + runner)   ai/* (tools tipadas, providers, motor local)│
│ platform/* ─────────── abstracción nativa / navegador ───────────────────────── │
└──────────────┬────────────────────────────────────────────┬────────────────────┘
               │ invoke (solo comandos listados en           │ navegador / PWA:
               │ build.rs + capabilities/default.json)       │ sql.js + IndexedDB,
┌──────────────▼──────────── Rust (Tauri 2) ─────────────┐   │ WebCrypto, fetch
│ db.rs      SQLite (rusqlite, 1 conexión, WAL, FK)       │   └────────────────────
│ secrets.rs Llavero de macOS (write-only)                │
│ net.rs     HTTP: inyecta credenciales por host permitido│
│ fsscan.rs  descubrimiento read-only en carpetas elegidas│
│ files.rs   diálogos, adjuntos, abrir URL/Finder/VS Code │
│ tray.rs    menú en la barra de macOS                    │
└─────────────────────────────────────────────────────────┘
```

- **Local-first:** toda la información vive en SQLite local. Sin servidor propio. Offline: todo lo sincronizado se consulta sin red.
- **Mismo SQL en todos lados:** las migraciones (`src/db/migrations.ts`) se aplican con el mismo runner sobre el adaptador nativo, el de navegador (sql.js/IndexedDB) y el de tests (sql.js en memoria).
- **Perfiles:** `main` (datos reales) y `demo` (base separada). Cambiar de perfil reabre la base y limpia la caché de consultas.
- **CSP estricta:** el webview no puede abrir conexiones externas; todo sale por `net.rs`.

## Modelo de datos (migración v1)
`organizations`, `projects`, `project_links`, `repositories` (clave canónica `github.com/owner/repo` para deduplicar local↔remoto), `integrations`, `integration_mappings`, `sync_runs`, `exchange_rates`, `recurring_costs`, `financial_transactions` (únicas por `(source, external_id)`, borrado lógico), `budgets`, `metric_observations` (catálogo de métricas en código), `campaigns`, `ad_metrics`, `dev_items` (commits/PRs/issues/releases/workflows), `deployments`, `health_checks`, `health_results`, `milestones`, `tasks` (únicas por referencia externa), `activity_events` (idempotentes por `external_id`), `alert_rules`, `alerts` (fingerprint estable), `ai_insights`, `ai_messages`, `audit_log` (correcciones auditables), `user_preferences`.

Convenciones: IDs UUID texto · `*_at` ISO UTC · `*_on` `YYYY-MM-DD` · dinero en unidades menores + moneda · JSON en TEXT · origen del dato en `source` (`manual`, `csv`, `stripe`, `demo`, …).

## Definiciones financieras
| Concepto | Definición |
|---|---|
| Facturación bruta | Σ ingresos (cobrados + pendientes) |
| Cobrado | Σ ingresos con estado cobrado |
| Ingresos netos | Facturación bruta − reembolsos |
| Costos variables | Gastos en categorías variables (IA, publicidad, contratistas, mercadería, envíos, procesamiento) |
| Gastos fijos | Gastos en categorías fijas (hosting, herramientas, dominios, impuestos…) |
| Margen de contribución | Ingresos netos − comisiones − costos variables |
| Beneficio operativo | Ingresos netos − comisiones − gastos operativos |
| Inversión | Capital invertido (desarrollo, lanzamiento, equipamiento). **No** es gasto operativo |
| Flujo de caja | Movimientos cobrados/pagados: entradas − salidas (incluye inversión) |
| ROI | (Ingresos netos − comisiones − gastos − inversión) / (comisiones + gastos + inversión) |
| Burn rate | Promedio de flujo de caja negativo de los últimos 3 meses completos (estimación) |
| Break-even | Recupero de inversión + pérdidas acumuladas al ritmo de beneficio de los últimos 3 meses (estimación) |

Todo se calcula **por moneda**. Consolidar exige un tipo de cambio registrado; la UI muestra fuente y fecha.

## Alertas
Reglas puras en `domain/alertRules.ts` sobre un snapshot (`repos/alerts.ts#buildSnapshot`): deploy fallido, servicio caído, publicidad sin conversiones (solo si se reportan), umbral de gasto, proyecto sin actividad, aumento de costos, caída de ventas, tarea vencida, renovación próxima, error de integración, lanzamiento próximo, presupuesto excedido. Fingerprints estables evitan duplicados; las alertas se resuelven solas cuando la condición desaparece. Configurables en Settings.

## IA
- `ai/tools.ts`: herramientas `listProjects`, `getProjectDetails`, `getFinancialSummary`, `getTransactions`, `getRecurringCosts`, `getCampaignPerformance`, `getAnalytics`, `getDevelopmentActivity`, `getOutstandingTasks`, `getAlerts`, `comparePeriods`, `getExchangeRates`. Argumentos validados con zod; cada una pertenece a una categoría de privacidad.
- `ai/assistant.ts`: bucle de tool calling (máx. 6 rondas) con prompt que exige formato Recomendación/Razón/Evidencia/Impacto/Confianza/Acción y distinguir hechos, estimaciones e hipótesis.
- `ai/localEngine.ts`: recomendaciones deterministas sin API.

## Seguridad
- Credenciales: Llavero (Rust `keyring`), **write-only** desde la UI; `http_secure` valida HTTPS, host permitido por credencial, sin userinfo/puerto, sin redirecciones, encabezados de auth no sobreescribibles.
- Comandos nativos: deny-by-default (manifest en `build.rs` + capability explícita). CSP sin `connect-src` externo. (`freezePrototype` está desactivado: rompe dependencias que asignan `valueOf`.)
- Filesystem: solo carpetas elegidas en el diálogo nativo (se rechazan `~` y `/`); lectura de archivos < 64 KB; sin symlinks; sin ejecución de git ni comandos; credenciales en remotes Git se eliminan.
- Adjuntos copiados a la carpeta privada de la app; nombres validados.
- Errores de proveedores sanitizados antes de guardarse (`runner.ts#sanitize`).
- Backups verificados (`integrity_check`), restore con copia previa automática.
