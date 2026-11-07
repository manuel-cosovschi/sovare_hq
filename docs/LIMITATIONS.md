# Registro de limitaciones reales

## Entrega y plataforma
- **El `.app`/`.dmg` no se generó en esta sesión**: el entorno de desarrollo era Linux y un bundle de macOS solo se produce en macOS. Se entrega: código completo, `scripts/build-mac.sh`, `scripts/install-mac.sh` y el workflow `Build macOS app` (GitHub Actions, runner macOS) para generarlo de forma reproducible.
- Verificado en Linux: el shell Rust compila en release y pasan sus tests; el binario nativo arranca (WebKitGTK bajo Xvfb), muestra el onboarding y crea la base SQLite con las migraciones a través de los comandos Rust; la UI completa se probó en Chromium con el adaptador web (E2E con capturas). **No** se ejecutó dentro de WKWebView en macOS: validar en la primera compilación local (titlebar overlay, Llavero, notificaciones, tray).
- La app no está firmada ni notarizada (requiere Apple Developer ID). Gatekeeper pide confirmación la primera vez.
- Sin auto-updater todavía: actualizar = reinstalar el `.app`; los datos se conservan porque viven fuera del bundle y las migraciones son versionadas.

## Monitoreo y automatizaciones
- Health checks, sincronizaciones y reglas de alertas corren **solo mientras la app está abierta** (incluida minimizada / en la barra de menú). No hay servicio en segundo plano (LaunchAgent) instalado.
- Con la Mac apagada no hay monitoreo: se necesita un servicio externo (UptimeRobot, Better Stack, cron en servidor). No se promete monitoreo continuo.
- Webhooks (Stripe/MP) requieren un backend público: no incluidos; se usa polling incremental.

## Integraciones
- Google Ads: no implementado (developer token aprobado + OAuth con backend). Alternativa: CSV.
- GA4: requiere un access token OAuth manual que expira en ~1 h (falta registrar un cliente OAuth propio con refresh token).
- Railway y Render: adaptadores previstos, no implementados.
- Mercado Pago y Vercel no ofrecen tokens de solo lectura; la app solo hace GET.
- Una integración cuya primera sincronización falla no queda “habilitada” para auto-sync; las alertas de integración se activan después de al menos una sincronización exitosa.
- En modo navegador/PWA varios proveedores bloquean CORS (Stripe, Mercado Pago, Vercel, GA4). La app nativa no tiene esa restricción.

## Datos y cálculos
- Monedas soportadas en la UI: ARS y USD (otras importadas se guardan y muestran por separado, sin conversión salvo tipo de cambio cargado).
- Importes como `1.500` se interpretan como 1500 (punto = separador de miles, criterio es-AR); `0.500` sí se lee como 0,5. Revisá la vista previa del CSV ante formatos ambiguos.
- Costos recurrentes con vencimiento día 29–31 se ajustan al último día del mes y luego quedan en ese día (31 ene → 28 feb → 28 mar).
- MRR de Stripe no descuenta cupones/descuentos.
- Clientes/suscripciones de negocio se representan como métricas (`metric_observations`), no como tablas propias.
- CAC requiere registrar la métrica “Nuevos clientes”.

## IA
- El asistente conversacional requiere un proveedor (OpenAI, Anthropic o local con tool calling). El motor local cubre recomendaciones, preguntas frecuentes, Daily Brief y Weekly Review sin IA externa.
- Los modelos por defecto sugeridos pueden cambiar; el campo de modelo es editable.

## Seguridad (modo navegador)
- En la PWA las credenciales se cifran con AES-GCM (clave no extraíble en IndexedDB): protege contra lectura casual, no contra código malicioso en el mismo origen. Usar la app nativa para credenciales de producción.

## Rendimiento (medido)
- Build web: primera pantalla en ~270–370 ms (Chromium, preview local). Bundle principal ~710 kB (gzip ~225 kB); gráficos, PDF y páginas se cargan bajo demanda. Tabla de transacciones virtualizada.
- No se midió en hardware Mac real.
