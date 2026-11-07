## Instalar en tu Mac (macOS 11 o superior, Apple Silicon o Intel)

Abrí la app **Terminal** y pegá:

```bash
curl -fsSL https://raw.githubusercontent.com/manuel-cosovschi/sovare_hq/claude/wonderful-johnson-ysh44e/scripts/install.sh | bash
```

Descarga `Sovare-HQ.dmg`, copia **Sovare HQ** a Aplicaciones y la abre. Después la encontrás en Spotlight, Launchpad y podés fijarla en el Dock. Tus datos quedan en `~/Library/Application Support/com.sovare.hq` y se conservan al actualizar (volvé a correr el mismo comando).

**Instalación manual:** descargá `Sovare-HQ.dmg`, abrilo y arrastrá *Sovare HQ* a Aplicaciones. Como la app no está firmada con un Developer ID de Apple, la primera vez macOS la bloquea: clic derecho → *Abrir*, o en macOS 15: Ajustes del Sistema → Privacidad y seguridad → *Abrir de todos modos*.

`SHA256SUMS.txt` contiene los hashes para verificar las descargas.
