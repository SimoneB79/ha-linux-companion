## 2026-08-31 — Release v3.0.2: layout responsive per pannelli piccoli (7" 800x480)

**Problema**: sul Raspi4 (7" 800x480) la vista Climatizzazione sbordava a destra e il more-info degli split (dial + modalità) era tagliato in basso, inutilizzabile. Sul 10" tutto ok.

**Root cause**: `webContents.insertCSS` di Electron NON attraversa lo shadow DOM del frontend HA. Inoltre il dial clima è largo 320px di default (classi sm/md/lg scelte da ResizeController sulla larghezza host).

**Fix** (`0ef940c`):
- Iniettore JS shadow-DOM-piercing: `<style data-ha-compact>` in ogni shadow root sotto `home-assistant`, re-iniezione automatica (interval 1.5s + ogni did-finish-load)
- Sotto 900px: vista sections a colonna singola; more-info clima compattato (dial 176px, margini/padding ridotti) per rientrare in 480px
- Zero impatto su pannelli >900px (Raspi5 10")

**Deploy**: Raspi4 + Raspi5 v3.0.2 (md5 allineati), backup in `~/ha-companion-backups/main.js.bak-20260831` su entrambi.

## 2026-06-26 — Fix scroll Raspi4 DSI

**Problema**: su Raspi4 (7" DSI touch 800x480), dopo l'update v3.0.1 la topbar non rispondeva più al touch scroll.

**Root cause**: v3.0.1 usava `window.addEventListener(capture:true)` per i listener touch/wheel. Sul display DSI del Raspi4, gli eventi touch non raggiungono `window` — vanno a `document`. Inoltre `setTimeout` non funzionava correttamente su Chromium ARM/Electron 33.

**Fix applicato** (`958cb38` locale, `bd39f55` su GitHub):
1. `window.addEventListener` → `document.addEventListener` per touchstart, touchmove, wheel
2. `setTimeout` → `setInterval` per auto-hide timer (bug Chromium ARM su Electron 33)
3. `clearTimeout` → `clearInterval` di conseguenza
4. Aggiunto `scheduleBarHide()` iniziale dopo il caricamento pagina

**File**: `src/views/overlay.js`
**Testato**: funzionante su Raspi4 (26/06/2026 11:24)
**Push GitHub**: ✅ via MCP
