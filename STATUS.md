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
