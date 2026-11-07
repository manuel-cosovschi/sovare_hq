# Roadmap de mejoras

## Próximo (v0.2)
- Compilar, firmar y notarizar en macOS; auto-updater de Tauri con canal de releases.
- LaunchAgent opcional (instalado con autorización explícita) para health checks y sync con la app cerrada.
- OAuth nativo (PKCE + loopback) para GitHub App, Google (GA4 con refresh token) y Meta.
- Adaptadores Railway y Render; Sentry/Crashlytics para errores y crash rate.
- Webhooks vía backend opcional (Cloudflare Worker) para Stripe/MP en tiempo real.

## Producto
- Acciones con aprobación explícita: pausar campaña, ajustar presupuesto, cerrar issue (con confirmación y auditoría).
- Dashboards personalizados por proyecto (selección de métricas y layout).
- Conciliación bancaria y categorización asistida de CSV.
- Metas (OKRs) por proyecto vinculadas a métricas.
- Multi-moneda ampliada (EUR, BRL) y tipos de cambio históricos automáticos.
- Exportación de reportes mensuales a PDF; reportes programados.
- Atajos globales del sistema y widget de macOS.

## Técnico
- Code splitting del bundle principal (registry de conectores y AI bajo demanda).
- Cifrado opcional de la base (SQLCipher) con clave en el Llavero.
- Tests E2E sobre la app nativa (tauri-driver) en CI macOS.
- Sincronización multi-dispositivo cifrada de extremo a extremo (opcional).
