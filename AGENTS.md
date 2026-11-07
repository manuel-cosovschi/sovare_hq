# AGENTS.md — rules for future agent sessions (Codex, Claude Code, …)

Sovare HQ is a **local-first, single-user macOS app** (Tauri 2 + React/TS + SQLite) that the owner uses daily to run real businesses. Correctness of data beats features.

## Priorities (in order)
Real functionality > security > data reliability > UX > number of features. Never replace a missing feature with UI that pretends to work.

## Non-negotiable data rules
- **Never invent metrics.** Unknown → `<NoData />` ("Sin datos"); unconnected source → `kind="not_connected"`; real zero → `0`; failed sync → stale warning.
- Demo data only in the **demo profile** (separate DB). `seedDemo/resetDemo` refuse to run on `main`. Demo names end in "(demo)".
- **Money:** integer minor units + ISO currency, stored in the original currency. Never add different currencies; aggregate into `MoneyBag`/per-currency `Breakdown`. Conversions only via `convertBag` with a recorded rate, and the UI must show source/date (`<ConvertedTotal/>`).
- Revenue ≠ profit. Investment is not an operating expense. Definitions live in `src/domain/finance.ts` (and docs/ARCHITECTURE.md). Change them only with tests.
- Ads: derived ratios only from platform-reported inputs (`src/domain/ads.ts`); `null` stays `null`. Never attribute Finance sales to campaigns.
- Progress percentages come from tasks/milestones, never from commit counts.

## Architecture map
- `src-tauri/src/` — Rust: `db.rs` (single SQLite connection, backup/restore), `secrets.rs` (Keychain, write-only, per-credential host allowlist), `net.rs` (all outbound HTTP; injects tokens), `fsscan.rs` (read-only discovery in user-picked roots), `files.rs` (dialogs, attachments, opener), `tray.rs` (menu bar). Every command must be listed in `build.rs` **and** `capabilities/default.json`.
- `src/db/` — `Db` interface + adapters (native / sql.js browser / in-memory tests), **append-only versioned migrations** in `migrations.ts` (never edit a shipped migration; add a new version).
- `src/domain/` — pure, tested business logic (no I/O). Put calculations here.
- `src/repos/` — data access; validate inputs with zod; write `audit_log` for user-editable financial/project/task changes; use `logActivity` for timeline events (idempotent via `external_id`).
- `src/integrations/` — adapter framework. **Adding an integration = one `ConnectorDef` in `connectors/` + register it in `registry.ts`.** Use `secureJson(secretKey, …)` (never handle raw tokens), `withRetry`, idempotent upserts keyed by provider IDs, and map external resources to projects via `integration_mappings`.
- `src/ai/` — typed tools (`tools.ts`, zod-validated, privacy category per tool), providers, local rule engine, briefs/reports. The assistant must only access data through tools.
- `src/features/*` — screens; `src/components` — UI kit (design tokens in `src/index.css`).

## Security
- No tokens in SQLite, logs, prompts, errors, fixtures or the repo. `runner.ts#sanitize` scrubs provider errors; keep it updated for new token formats.
- New credential slot → add to `secrets.rs::allowed_hosts` AND `platform/secrets.ts::SECRET_HOSTS` (exact hosts, HTTPS only).
- No arbitrary command execution, no shell-outs. Filesystem access only inside roots picked via the native dialog (`ensure_authorized`).
- Integrations are **read-only**. Actions that change external systems (pause ads, close issues, deploy, payments, trades) require an explicit per-action user confirmation flow and must not be automatic.
- Tests never use production credentials; mock `fetch`/`@/platform/http`.

## Conventions
- UI language: Spanish (rioplatense). Section names in English as specified (Overview, Projects…).
- TypeScript strict, no `any`. Dates `YYYY-MM-DD` (`*_on`), timestamps ISO UTC (`*_at`), UUID text IDs.
- Use design tokens (`bg-surface`, `text-ink-2`, `--chart-1..4`); support light & dark. Chart palette is CVD-validated — don't add ad-hoc colors.
- Keep scheduler work honest: it only runs while the app is open.

## Before you finish
```bash
npm run check                 # tsc + eslint + vitest
(cd src-tauri && cargo test)  # Rust security tests
npm run build && npm run e2e  # browser smoke test with screenshots (needs Playwright/Chromium)
```
Update `docs/LIMITATIONS.md` when you add or remove a limitation, and `docs/INTEGRATIONS.md` for connector changes.
