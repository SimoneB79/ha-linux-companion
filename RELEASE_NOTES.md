## v4.1.0 — HA-controlled display + desktop icon (2026-11-10)

### Screen control from Home Assistant
- `notify.mobile_app_<device>` commands now use the TouchSense controller: `command_screen_on` / `command_screen_off` force the display on/off regardless of displayMode (perfect for automations, e.g. light on -> screen on)
- New `binary_sensor.<device>_display_state` (device_class power) pushed to HA, refreshed immediately on every blank/restore
- Pair them with a template switch or an automation: light ON -> `command_screen_on`, light OFF -> `command_screen_off`

### Desktop integration
- Application launcher (.desktop + icon) auto-installed at first run into `~/.local/share/applications` and onto the Desktop folder (localized) — the panel app is now reachable like any normal Linux app

### Compatibility
- TouchSense v4.0.0 modes unchanged: alwaysOn / touchWake / presenceWake

## v4.0.0 — TouchSense (2026-11-10)

### New: TouchSense display modes
- **Touch Wake** — the panel goes dark after an inactivity timeout and wakes instantly on any touch/input
- **Presence Wake** — the panel follows a Home Assistant presence sensor (PIR, mmWave, person) and also wakes on touch
- Configurable from the on-panel Settings overlay (Display section) and the tray menu: mode, timeout (1/5/10/30 min), presence entity — i18n IT/EN/DE

### Robust display power backends (auto-detected, self-healing)
- Wayland (wlr-randr), X11 (xrandr), and a pure overlay fallback that works on any Debian amd64/ARM64
- Panels that cut power to their USB touch controller on DPMS-off are detected automatically: the app learns and persists the safe backend per host (displayBackend in config.json)
- Wake input is captured at evdev level (works with the display off); watchers survive USB hotplug

### Critical fix: evdev reads were starving the Electron main process
- Reading /dev/input with fs streams saturated the libuv threadpool, breaking DNS/HTTP in the main process (login 'Connection timeout')
- Watchers now use dedicated helper processes (epoll pipes): zero threadpool usage

### Fixes
- Display ON/OFF overlay buttons now use the new controller (vcgencmd/xset did nothing on Wayland)
- Overlay blank window only used when real DPMS-off is unavailable; screen restored on quit

# Release Notes

## v2.5.0 (2026-06-08)

### Bug Fixes
- **WS reconnect storm** — when HA returns 502, the companion no longer opens 15-20 parallel WebSocket connections. Added `wsConnecting` guard and `cleanupWs()` to ensure single-connection reconnect.
- **Dashboard shows login page after HA restart** — `loadDashboard()` now reloads config from disk (`config = loadConfig()`) and uses `auth.getAccessToken()` instead of stale `config.token` for localStorage injection.
- **WebView stuck on HA login page** — added `did-navigate` listener that detects HA `/auth/authorize`, `/auth/login`, `/auth/token` URLs and auto-reloads the dashboard with a fresh token after 1 second.
- **HA 2026.6.x sensor payload breaking change** — `register_sensor` now sends `unique_id` + `state` + `type` + `name` + `icon` only (no `device_class`, `state_class`, `unit_of_measurement`). `update_sensor_states` strips to `unique_id` + `state` + `type`.

### Compatibility
- Home Assistant 2026.6.x (required due to mobile_app webhook API changes)
- Home Assistant 2025.x and earlier may still work but sensor registration behavior differs
