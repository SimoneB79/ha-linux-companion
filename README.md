# HA Linux Companion

Home Assistant companion app for Linux touchscreen panels — built with Electron.

![License](https://img.shields.io/badge/license-MIT-blue)

---

## About This Project

This application was **designed and developed by an AI Agent** — [OpenClaw](https://github.com/openclaw/openclaw) powered by the **Z.AI** model.

The agent had **direct access to real local resources**: Home Assistant instance, Raspberry Pi hardware (SSH, sensors, display), network infrastructure, and live logs. This enabled deep understanding of real-world issues — from token refresh race conditions to WebSocket authentication loops on embedded Linux devices — and allowed the agent to write, deploy, test, and iterate on fixes autonomously.

**Human supervision** by [SimoneB79](https://github.com/SimoneB79): testing on physical hardware, debugging, and validation on actual Raspberry Pi touchscreen panels.

---

## Features

- 🔐 **Login** — Username/password + 2FA/MFA, or long-lived token
- 🔑 **Persistent sessions** — OAuth2 token management with proactive refresh, survives reboots
- 📱 **Device registration** — Registers as `mobile_app` in HA integrations
- 📊 **System sensors** — CPU temp, CPU%, RAM%, disk%, uptime, IP, display state
- 🔔 **Push notifications** — Real-time via WebSocket with priority, channels, and custom sounds
- 🎛️ **Settings overlay** — Volume, brightness, Bluetooth, clock, right on the dashboard
- 🔄 **Auto-reconnect** — Health monitor detects HA restarts and reconnects automatically
- 🔒 **Self-signed certs** — Works with local HTTPS (Caddy, Nginx)
- 🖥️ **Fullscreen kiosk** — Optimized for 7" and 10" touch panels
- ⌨️ **On-screen keyboard** — With shift, CAPS, symbols, URL shortcuts

## Supported Hardware

- Raspberry Pi 4/5 (arm64) with touchscreen
- Any Linux with X11/Wayland + Electron support

## Quick Start

```bash
git clone https://github.com/SimoneB79/ha-linux-companion.git
cd ha-linux-companion
npm install
npm start
```

## System Install (Raspberry Pi)

```bash
chmod +x install.sh
sudo ./install.sh
```

Creates a systemd user service for auto-start on boot.

## Settings Menu

Tap the ⚙ gear icon (top-right of dashboard) to access:

| Control | Description |
|---------|-------------|
| Clock | System time, date, CPU temperature |
| Display | Brightness, ON/OFF, night scheduling |
| Audio | Volume, mute, output selector (HDMI/jack/BT) |
| Network | WiFi SSID, signal strength, IP, gateway, DNS |
| Bluetooth | Scan and connect devices |
| Hardware | Board model, CPU temp/freq, RAM, disk, OS, kernel, serial |
| CPU Governor | Performance / powersave / ondemand |
| Notifications | Enable, sound, DND, duration, melody, channels |
| Updates | Check GitHub releases (stable + dev) |
| Reboot / Shutdown | System power controls |
| Reload | Refresh the HA dashboard |
| Fullscreen | Toggle fullscreen mode |
| Logout | Clear config and return to login |
| Exit | Quit the app |

## Sensors Published to HA

| Sensor | Type | Unit |
|--------|------|------|
| CPU Temperature | sensor | °C |
| CPU Usage | sensor | % |
| RAM Usage | sensor | % |
| RAM Free | sensor | MB |
| Disk Usage | sensor | % |
| System Uptime | sensor | — |
| IP Address | sensor | — |
| Display State | binary_sensor | on/off |

## Configuration

Stored in `~/.config/ha-linux-companion/config.json`:

```json
{
  "url": "https://homeassistant.local:8123",
  "token": "***",
  "deviceName": "My Panel",
  "deviceId": "...",
  "webhookId": "...",
  "registered": true,
  "fullscreen": true
}
```

## Notifications

Real-time push notifications from Home Assistant, displayed as toast overlays on the dashboard.

### Sending notifications

Use the standard `notify.mobile_app_<device_name>` service:

```yaml
service: notify.mobile_app_pannello
data:
  title: "🔔 Alert"
  message: "Front door opened!"
  data:
    priority: high
    push_sound: warning
    channel: alarm
    channel_name: Allarmi
```

### Toast overlay

- Custom HTML/CSS toast injected into the Lovelace dashboard
- Animated slide-in/out with progress bar for auto-dismiss
- Up to 3 stacked toasts
- Priority levels: `urgent` (persistent + action button), `high`, `default`, `low`, `min`
- Color-coded borders: 🔴 urgent, 🟡 high, 🔵 default, ⚪ low, ⚫ min

### Notification settings (⚙ menu)

| Setting | Description |
|---------|-------------|
| Enable | Toggle all notifications |
| Sound | Toggle notification sounds |
| Do Not Disturb | Silence everything |
| Popup duration | 4s / 6s / 10s / Never |
| Melody | Default / Success / Warning / Error / Custom |

Custom sounds: place `.wav`, `.ogg`, `.mp3`, or `.flac` files in `~/.config/ha-linux-companion/sounds/`.

### Channels

Notifications can be organized into channels via `data.channel`. Channels are **auto-created** when HA first sends a notification with that channel ID. Each channel can be individually:

- Enabled / disabled
- Assigned a custom sound
- Assigned a priority override

Channel settings persist in `~/.config/ha-linux-companion/channels.json` and are configurable from the overlay menu.

## Notification Commands

Control the panel remotely from any Home Assistant automation by sending commands instead of regular notifications:

| Command | Description | Data |
|---------|-------------|------|
| `command_screen_on` | Turn display on | — |
| `command_screen_off` | Turn display off | — |
| `command_screen_brightness_level` | Set brightness % | `brightness: 0-100` |
| `command_volume_level` | Set volume | `volume_level: 0.0-1.0` |
| `command_dnd` | Toggle Do Not Disturb | `dnd: true/false` |
| `command_bluetooth` | Bluetooth on/off | `bluetooth: turn_on/turn_off` |
| `command_update_sensors` | Force sensor update | — |
| `command_open_url` | Navigate to URL | `url: "https://..."` |
| `command_navigate` | Navigate HA path | `navigate: "/lovelace/0"` |
| `command_restart_app` | Restart the app | — |
| `command_reload_dashboard` | Reload dashboard | — |
| `command_set_wallpaper` | Set background image | `url: "https://..."` |
| `command_set_theme` | Set HA theme | `theme: "theme_name"` |

Example — turn off display at night:
```yaml
automation:
  - alias: "Panel display off at night"
    trigger:
      - platform: time
        at: "23:00:00"
    action:
      - service: notify.mobile_app_pannello
        data:
          message: command_screen_off
```

Example — dim brightness in the evening:
```yaml
service: notify.mobile_app_pannello
data:
  message: command_screen_brightness_level
  data:
    brightness: 30
```

## Architecture

```
src/
├── main.js       # Electron main process: HA client, auth, sensors, notifications, system controls
├── auth.js        # OAuth2 token management with proactive refresh
├── preload.js     # IPC bridge (haCompanion API)
└── views/
    ├── login.html # Login UI with on-screen keyboard
    ├── overlay.js # Settings overlay with notification/channel config
    ├── toast.css  # Toast notification styles (priority colors, animations)
    └── toast.js   # Toast overlay injected into HA dashboard
```

## Building

```bash
npm run dist
```

## License

MIT
