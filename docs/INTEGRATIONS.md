# Integraciones

Arquitectura: cada integración es un `ConnectorDef` (`src/integrations/connectors/*`) registrado en `registry.ts`. El runner (`runner.ts`) gestiona estado, historial (`sync_runs`), reintentos con backoff, errores sin secretos y sincronización automática mientras la app está abierta. Los datos se normalizan con upserts idempotentes (claves de proveedor) y se mapean a proyectos con `integration_mappings`.

Credenciales: write-only en el Llavero. Rust las inyecta solo en HTTPS hacia los hosts permitidos de cada credencial (`secrets.rs::allowed_hosts`), sin redirecciones.

| Integración | Estado | Auth | Qué sincroniza | Permisos mínimos |
|---|---|---|---|---|
| GitHub | ✅ Implementada | Fine-grained PAT | Repos (todos), y para repos vinculados: commits, PRs, issues, releases, workflow runs; importación de issues → tareas | Metadata, Contents, Issues, Pull requests, Actions: **read-only** |
| Carpetas locales | ✅ | Selector de carpetas | Candidatos de proyecto (Git remotes/rama/último commit, manifests, frameworks, hosting) | Solo carpetas elegidas |
| Importación CSV | ✅ | Archivo | Transacciones (detección de columnas ES/EN, deduplicación por ID/fingerprint, deshacer) y métricas de anuncios | — |
| Mercado Pago | ✅ | Access token | Pagos → ingresos, comisiones (`fee_details`), reembolsos; pendientes como “pending” | Lectura de pagos (MP no ofrece tokens read-only; solo se usan GET) |
| Stripe | ✅ | Restricted key | Balance transactions → ingresos, comisiones, reembolsos/disputas; MRR y suscripciones activas | Balance, Charges, Subscriptions: Read |
| Meta Ads | ✅ | System-user token | Campañas, presupuestos, estado; insights diarios (impresiones, alcance, clics, gasto, conversiones y valor **solo para la acción configurada**) | `ads_read` |
| Vercel | ✅ | Access token | Deployments (estado, entorno, commit) + listado de proyectos para mapeo | Token de cuenta/equipo (usado solo para lectura) |
| Netlify | ✅ | PAT | Deploys de sitios vinculados | PAT |
| Google Analytics 4 | ⚠️ Limitada | OAuth access token (~1 h) | activeUsers, newUsers, sessions, keyEvents por día | `analytics.readonly` |
| Health checks | ✅ | — | Estado HTTP, latencia, disponibilidad, historial | GET/HEAD a URLs registradas |
| Tipos de cambio (DolarAPI) | ✅ | — | USD→ARS (oficial/blue/MEP/CCL/tarjeta/mayorista) con fuente y fecha | GET público |
| Proveedor de IA | ✅ | API key / local | Asistente con herramientas internas | Key del proveedor |
| Google Ads | ⛔ Unsupported | — | Alternativa: CSV en Marketing | Requiere developer token aprobado + OAuth con backend |
| Railway / Render | ⛔ Previstos | — | Alternativa: health checks | — |

## Notas por proveedor
- **GitHub:** el detalle se limita a repos vinculados (máx. configurable, 15 por defecto) para respetar el rate limit. Cursor incremental por repo (`since`). Nunca se escriben issues/PRs.
- **Mercado Pago:** primera sincronización = últimos 90 días (hasta 1000 pagos); luego incremental con 3 días de solapamiento.
- **Stripe:** primera sincronización = 365 días; incremental por `created` con 7 días de solapamiento (para actualizar `pending → available`). Payouts/transfers no son ingresos.
- **Meta Ads:** re-sincroniza los últimos 3 días (la atribución cambia). Sin `conversion_action` configurada, conversiones = “Sin datos” (no 0). Alcance no se suma entre días. **Nunca** se pausan campañas ni se modifican presupuestos.
- **Vercel/Netlify:** un deploy `READY` no implica salud de la app.
- **GA4:** el token del OAuth Playground expira en ~1 h; renovarlo para volver a sincronizar. Los datos ya sincronizados quedan offline.

## Agregar una integración
1. Crear `ConnectorDef` con `id`, `auth`, `permissions`, `setup`, `limitations`, `configFields`, y `test`/`sync`/`listExternal` si aplica.
2. Si usa credencial: agregar el slot y sus hosts en `src-tauri/src/secrets.rs` **y** `src/platform/secrets.ts`.
3. Normalizar con los repos existentes (`upsertExternalTransactions`, `upsertCampaigns`, `upsertDeployments`, `upsertDevItems`, `upsertObservations`).
4. Registrar en `registry.ts` y `names.ts`. Agregar tests con API simulada en `tests/integrations.test.ts`.
