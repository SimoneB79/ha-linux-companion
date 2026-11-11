/**
 * Display Controller — "TouchSense" screen-off with wake on touch / presence
 *
 * Modes (config.displayMode):
 *   'alwaysOn'    — default, no screen blanking
 *   'touchWake'   — screen off after displayTimeoutMin of inactivity; any touch/input wakes it
 *   'presenceWake'— screen on while config.presenceEntity is 'on'/'home';
 *                   falls asleep after timeout when presence is off (touch still wakes)
 *
 * Backends (auto-detected, in order):
 *   wayland  — wlr-randr --output <name> --off / --on   (Raspberry Pi OS Wayland, labwc/wlr compositors)
 *   x11      — xrandr --output <name> --off / --auto    (classic X11 panels, Debian amd64 mini-PC)
 *   overlay  — pure-Electron black always-on-top window (last-resort fallback, no artifacts on any OS)
 *
 * Wake-on-touch while the display is truly off works via raw evdev listeners
 * (/dev/input/event* — requires the panel user to be in the 'input' group).
 * Everything is fail-safe: any error degrades to the next backend, never blocks startup.
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EV_SYN = 0x00, EV_KEY = 0x01, EV_ABS = 0x03;
// struct input_event record size: 64-bit kernels use 16-byte timeval → 24B records;
// 32-bit kernels (armv7) use 8-byte timeval → 16B records.
const INPUT_RECORD_SIZE = (process.arch === 'arm' || process.arch === 'ia32') ? 16 : 24;

function sh(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ''), err: err ? err.message : null });
      });
    } catch (e) { resolve({ ok: false, stdout: '', err: e.message }); }
  });
}

class DisplayController extends (require('events')) {
  constructor(log) {
    super();
    this.log = log || (() => {});
    this.mode = 'alwaysOn';
    this.timeoutMin = 5;
    this.presenceEntity = '';
    this.presenceOn = null;

    this.backend = null;        // 'wayland' | 'x11' | 'overlay'
    this.outputName = null;
    this.screenOff = false;     // true = display currently blanked by us
    this.sleepTimer = null;
    this.lastActivity = Date.now();
    this.evdevWatchers = [];    // { fd, path, stream }
    this._wakeDebounce = 0;
    this._switching = false;
    this._tick = setInterval(() => this._evaluate(), 5000);
    if (this._tick.unref) this._tick.unref();
  }

  async init(config) {
    this.applyConfig(config || {});
    // displayStrategy: 'auto' (default) | 'real' | 'overlay'
    //   auto   -> real DPMS when the touch is internal (i2c/DSI) or absent,
    //             black overlay when a USB touch is present (it would die)
    //   real   -> always native power-off (displayRealOff equivalent)
    //   overlay-> always black overlay (touch always alive)
    const strategy = (config && config.displayStrategy) || 'auto';
    const learnedOverlay = config && config.displayBackend === 'overlay';
    if (strategy === 'overlay') {
      this.backend = 'overlay';
      this.log('[DSP] strategy=overlay (forced)');
    } else if (strategy === 'real') {
      await this._detectBackend();
      this.log('[DSP] strategy=real (forced)');
    } else if (config && config.displayRealOff === true) {
      await this._detectBackend();
      this.log('[DSP] displayRealOff legacy flag -> real off');
    } else if (learnedOverlay) {
      this.backend = 'overlay';
      this.log('[DSP] using learned backend: overlay');
    } else {
      const internalTouch = this._touchIsInternalOnly();
      if (internalTouch) {
        await this._detectBackend();
        this.log('[DSP] auto: internal touch -> native power-off');
      } else {
        const hasUsbTouch = this._hasUsbTouch();
        if (hasUsbTouch) {
          this.backend = 'overlay';
          this.emit('backend-learned', 'overlay');
          this.log('[DSP] auto: USB touch detected -> black overlay (touch stays alive)');
        } else {
          await this._detectBackend();
          this.log('[DSP] auto: no touch device -> native power-off');
        }
      }
    }
    // (backend selection handled above by displayStrategy)
    this._startEvdevWatchers();
    this.log(`[DSP] init backend=${this.backend} output=${this.outputName || '-'} mode=${this.mode} timeout=${this.timeoutMin}min`);
    // Never start with the screen off
    this.lastActivity = Date.now();
  }

  applyConfig(config) {
    const modes = ['alwaysOn', 'touchWake', 'presenceWake'];
    this.mode = modes.includes(config.displayMode) ? config.displayMode : 'alwaysOn';
    // displayRealOff: never fall back to the black overlay — the owner wants
    // real DPMS/standby even if a panel's USB touch dies (wake via HA/presence)
    this.realOff = config.displayRealOff === true;
    const t = Number(config.displayTimeoutMin);
    this.timeoutMin = Number.isFinite(t) && t > 0 ? t : 5;
    this.presenceEntity = String(config.presenceEntity || '').trim();
    if (this.mode === 'alwaysOn') this.wake(); // stay on
    this._evaluate();
  }

  // ── Backend detection ────────────────────────────────────────────────
  // List real wayland outputs via wlr-randr, skipping virtual/dummy ones (NOOP-*).
  // Prefer enabled outputs; fallback to first real one.
  async _waylandOutputs() {
    const r = await sh('wlr-randr', []);
    if (!r.ok) return [];
    const names = [...r.stdout.matchAll(/^([A-Za-z0-9_-]+)[ \t]*\"/gm)].map(m => m[1])
      .filter(n => !/^NOOP/i.test(n));
    const enabled = [];
    for (const n of names) {
      const blk = r.stdout.split(new RegExp('^' + n + '[ \\t]*\\"', 'm'))[1] || '';
      if (/Enabled:\s*yes/i.test(blk)) enabled.push(n);
    }
    return enabled.length ? enabled : names;
  }

  async _detectBackend() {
    // 1. Wayland (Raspi OS Bookworm+ uses labwc/wlr compositor)
    if (process.env.WAYLAND_DISPLAY || process.env.WAYLAND_SOCKET) {
      const outs = await this._waylandOutputs();
      if (outs.length) {
        this.backend = 'wayland';
        this.outputName = outs[0];
        return;
      }
      // GNOME/mutter Wayland: real blank + monitor standby via D-Bus screensaver
      if (await this._gnomeScreensaverAvailable()) {
        this.backend = 'gnome';
        this.log('[DSP] GNOME session: org.gnome.ScreenSaver backend (real monitor standby)');
        return;
      }
      this.log('[DSP] Wayland without wlr-randr nor GNOME screensaver');
    }
    // 3. X11
    if (process.env.DISPLAY) {
      const r = await sh('xrandr', ['--current']);
      if (r.ok) {
        const m = r.stdout.match(/^(\S+) connected /m);
        if (m) {
          this.backend = 'x11';
          this.outputName = m[1];
          return;
        }
      }
    }
    // 3. Overlay fallback — always works
    this.backend = 'overlay';
  }

  // ── Screen power ─────────────────────────────────────────────────────
  async _screenOff() {
    if (this.screenOff || this._switching || this.mode === 'alwaysOn') return;
    this._switching = true;
    const touchBefore = this._touchCount();
    try {
      if (this.backend === 'wayland') {
        // re-resolve output: real outputs can change across hotplug/suspend
        const outs = await this._waylandOutputs();
        if (outs[0] && outs[0] !== this.outputName) this.outputName = outs[0];
        const r = await sh('wlr-randr', ['--output', this.outputName, '--off']);
        if (!r.ok) throw new Error('wlr-randr off failed: ' + (r.err || ''));
      } else if (this.backend === 'gnome') {
        const r = await this._dbusScreensaver(true);
        if (!r.ok) throw new Error('gnome screensaver SetActive failed: ' + (r.err || ''));
      } else if (this.backend === 'x11') {
        const r = await sh('xrandr', ['--output', this.outputName, '--off']);
        if (!r.ok) throw new Error('xrandr off failed: ' + (r.err || ''));
      }
      this.screenOff = true;
      this.log(`[DSP] screen OFF (backend=${this.backend})`);
      this.emit('blanked'); // main shows overlay window when backend === 'overlay'
      // Some HDMI panels cut power to their USB touch controller when the
      // output goes into DPMS off. Self-heal ONLY when displayRealOff is not
      // requested: with displayRealOff the owner accepts losing touch wake.
      if ((this.backend === 'wayland' || this.backend === 'x11') && !this.realOff) {
        // panel USB power can decay slowly: probe repeatedly over ~14s
        const probes = [2000, 4000, 8000, 14000];
        for (const delay of probes) {
          setTimeout(async () => {
            try {
              if (this.backend === 'overlay' || !this.screenOff) return;
              const after = this._touchCount();
              if (touchBefore > 0 && after === 0) {
                this.log('[DSP] touch controller died after screen off (probe ' + delay + 'ms) — switching to overlay blanking');
                this.backend = 'overlay';
                this.emit('backend-learned', 'overlay'); // main persists config.displayBackend
                await this.wake('touch-lost');
                this._refreshEvdev();
              }
            } catch (_) {}
          }, delay);
        }
      }
    } catch (e) {
      if (this.realOff) {
        // displayRealOff: no fake black overlay — report loudly and keep the screen on
        this.log('[DSP] screenOff error with displayRealOff: ' + e.message + ' — screen stays ON');
      } else {
        this.log('[DSP] screenOff error: ' + e.message + ' — using overlay fallback');
        this.backend = 'overlay';
        this.screenOff = true;
        this.emit('blanked');
      }
    } finally { this._switching = false; }
  }

  // HA-forced control (automation/notify commands) — bypasses displayMode.
  // forceOn keeps the screen awake for a full timeout window even in touchWake.
  async forceOn(reason = 'ha') {
    this.lastActivity = Date.now();
    await this.wake(reason);
    this.log('[DSP] forced ON (' + reason + ')');
  }

  async forceOff(reason = 'ha') {
    if (this.screenOff) return;
    const prevMode = this.mode;
    this.mode = 'touchWake'; // temporarily allow blanking even in alwaysOn
    await this._screenOff();
    this.mode = prevMode;
    this.log('[DSP] forced OFF (' + reason + ')');
  }

  async wake(reason = 'input') {
    if (!this.screenOff) { this.lastActivity = Date.now(); return; }
    if (this._switching) return;
    this._switching = true;
    try {
      if (this.backend === 'wayland') {
        // re-resolve output, skipping dummy NOOP outputs
        const outs = await this._waylandOutputs();
        if (outs[0]) this.outputName = outs[0];
        const r = await sh('wlr-randr', ['--output', this.outputName, '--on']);
        if (!r.ok) throw new Error('wlr-randr on failed: ' + (r.err || ''));
      } else if (this.backend === 'gnome') {
        const r = await this._dbusScreensaver(false);
        if (!r.ok) throw new Error('gnome screensaver deactivate failed: ' + (r.err || ''));
      } else if (this.backend === 'x11') {
        const r = await sh('xrandr', ['--output', this.outputName, '--auto']);
        if (!r.ok) throw new Error('xrandr on failed: ' + (r.err || ''));
      }
      this.screenOff = false;
      this.lastActivity = Date.now();
      this.log(`[DSP] screen ON (${reason}, backend=${this.backend})`);
      this.emit('restored');
    } catch (e) {
      this.log('[DSP] wake error: ' + e.message);
    } finally { this._switching = false; }
    this._evaluate();
  }

  // ── Activity (evdev raw input watchers — work even with display off) ─
  // Touch on an internal bus (i2c/DSI/serio) survives display power-off;
  // USB touch panels (e.g. Elecrow/ILITEK) usually cut the controller with
  // the HDMI signal. Used by displayStrategy=auto to pick the blanking mode.
  _touchIsInternalOnly() {
    try {
      const evs = fs.readdirSync('/sys/class/input').filter(n => n.startsWith('event'));
      let hasTouch = false, hasUsbTouch = false;
      for (const n of evs) {
        let name = '', isTouch = false, isUsb = false;
        try {
          isTouch = this._isTouchDevice(n);
          const p = fs.realpathSync('/sys/class/input/' + n + '/device');
          isUsb = /usb\d*\//.test(p) || /\.usb\//.test(p);
        } catch (_) { continue; }
        if (isTouch) { hasTouch = true; if (isUsb) hasUsbTouch = true; }
      }
      return hasTouch && !hasUsbTouch;
    } catch (_) { return false; }
  }

  _hasUsbTouch() {
    try {
      const evs = fs.readdirSync('/sys/class/input').filter(n => n.startsWith('event'));
      for (const n of evs) {
        try {
          if (!this._isTouchDevice(n)) continue;
          const p = fs.realpathSync('/sys/class/input/' + n + '/device');
          if (/usb\d*\//.test(p) || /\.usb\//.test(p)) return true;
        } catch (_) {}
      }
    } catch (_) {}
    return false;
  }

  _isTouchDevice(n) {
    // BTN_TOUCH (code 0x14a = 330) in the key capabilities is the definitive
    // touchscreen marker — works for badly named controllers like 'QDtech MPI1001'.
    try {
      const name = fs.readFileSync('/sys/class/input/' + n + '/device/name', 'utf8');
      if (/touch/i.test(name)) return true;
      const key = fs.readFileSync('/sys/class/input/' + n + '/device/capabilities/key', 'utf8').trim();
      if (!key || key === '0') return false;
      const bits = BigInt('0x' + key.replace(/\s+/g, ''));
      return ((bits >> 330n) & 1n) === 1n;
    } catch (_) { return false; }
  }

  _touchCount() {

    try {
      return fs.readdirSync('/sys/class/input').filter(n => n.startsWith('event')).filter(n => {
        try { return /touch/i.test(fs.readFileSync('/sys/class/input/' + n + '/device/name', 'utf8')); }
        catch { return false; }
      }).length;
    } catch { return 0; }
  }

  _startEvdevWatchers() {
    this._refreshEvdev();
    // keep watchers aligned with hotplug (touch controllers can re-enumerate)
    this._watchTimer = setInterval(() => this._refreshEvdev(), 30000);
    if (this._watchTimer.unref) this._watchTimer.unref();
  }

  _refreshEvdev() {
    try {
      const wanted = new Set(this._candidateDevices());
      for (const w of this.evdevWatchers) { if (!wanted.has(w.path)) { try { w.stream.kill(); } catch (_) {} } }
      this.evdevWatchers = this.evdevWatchers.filter(w => wanted.has(w.path));
      for (const p of wanted) if (!this.evdevWatchers.some(w => w.path === p)) this._openWatcher(p);
    } catch (e) { this.log('[DSP] refresh watchers error: ' + e.message); }
  }

  async _gnomeScreensaverAvailable() {
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) return false;
    const r = await sh('dbus-send', [
      '--session', '--dest=org.freedesktop.DBus', '--type=method_call', '--print-reply', '/',
      'org.freedesktop.DBus.NameHasOwner', 'string:org.gnome.ScreenSaver',
    ]);
    return r.ok && /boolean true/.test(r.stdout);
  }

  _dbusScreensaver(active) {
    return sh('dbus-send', [
      '--session', '--dest=org.gnome.ScreenSaver', '--type=method_call',
      '--print-reply', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver.SetActive',
      'boolean:' + (active ? 'true' : 'false'),
    ]);
  }

  _candidateDevices() {
    let dir;
    try { dir = fs.readdirSync('/dev/input'); } catch { return []; }
    const out = [];
    for (const name of dir.filter(n => n.startsWith('event'))) {
      const p = path.join('/dev/input', name);
      try {
        const sysCaps = '/sys/class/input/' + name + '/device/capabilities';
        let isCandidate = false;
        try {
          const abs = fs.readFileSync(path.join(sysCaps, 'abs'), 'utf8').trim();
          const key = fs.readFileSync(path.join(sysCaps, 'key'), 'utf8').trim();
          // touch (ABS_MT_POSITION_X = 0x35 bit → abs non-zero), mouse, keyboard
          isCandidate = abs !== '0' || (key !== '0' && key.length > 2);
        } catch { isCandidate = false; }
        if (!isCandidate) continue;
        out.push(p);
      } catch (e) { /* skip device */ }
    }
    return out;
  }

  _openWatcher(p) {
    try {
      // IMPORTANT: never read evdev with fs streams in Electron main —
      // device-file reads consume the libuv threadpool and starve DNS/HTTP
      // (login 'Connection timeout'). A cat child process pipes events via
      // epoll-managed stdout instead.
      const stream = spawn('cat', [p], { stdio: ['ignore', 'pipe', 'ignore'] });
      stream.stdout.on('data', (buf) => {
          // input_event records: 24 bytes on 64-bit (timeval 16B + type 2 + code 2 + value 4),
          // 16 bytes on 32-bit kernels (timeval 8B + type 2 + code 2 + value 4)
          const rec = INPUT_RECORD_SIZE;
          const tOff = rec === 24 ? 16 : 8;
          for (let off = 0; off + rec <= buf.length; off += rec) {
            const type = buf.readUInt16LE(off + tOff);
            const value = buf.readInt32LE(off + tOff + 4);
            if (type === EV_SYN || (type === EV_KEY && value === 2)) continue; // ignore repeats/SYN
            if (type === EV_KEY || type === EV_ABS) {
              this._activity(p); break;
            }
          }
        });
      stream.on('error', () => { /* cat died or no permission — skip */ });
      stream.on('exit', () => { /* device gone: drop watcher */
        this.evdevWatchers = this.evdevWatchers.filter(w => w.path !== p);
      });
      this.evdevWatchers.push({ path: p, stream });
    } catch (e) { /* skip device */ }
  }

  _activity(source) {
    this.lastActivity = Date.now();
    if (this.screenOff) {
      const now = Date.now();
      if (now - this._wakeDebounce > 400) {
        this._wakeDebounce = now;
        this.wake('touch/input (' + path.basename(source) + ')');
      }
    }
    this._evaluate();
  }

  // ── Presence (called by main on HA state_changed) ────────────────────
  setPresence(entityId, state) {
    if (entityId !== this.presenceEntity) return;
    this.presenceOn = ['on', 'home', 'true', '1', 'open'].includes(String(state).toLowerCase());
    this.log(`[DSP] presence ${entityId} = ${state}`);
    this._evaluate();
  }

  // ── State machine ────────────────────────────────────────────────────
  _evaluate() {
    if (this.mode === 'alwaysOn') {
      if (this.screenOff) this.wake('mode alwaysOn');
      if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
      return;
    }
    if (this.screenOff) {
      if (this.mode === 'presenceWake' && this.presenceOn === true) this.wake('presence');
      return;
    }
    // screen is on: decide when to sleep
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    const idleMs = Date.now() - this.lastActivity;
    let shouldSleep = false;
    if (this.mode === 'touchWake') {
      shouldSleep = idleMs >= this.timeoutMin * 60000;
    } else if (this.mode === 'presenceWake') {
      const noPresenceFor = this.presenceOn === false;
      shouldSleep = (noPresenceFor || this.presenceOn === null) && idleMs >= this.timeoutMin * 60000;
    }
    if (shouldSleep) {
      this.sleepTimer = setTimeout(() => this._screenOff(), 200);
      if (this.sleepTimer.unref) this.sleepTimer.unref();
    }
  }

  stop() {
    if (this._tick) clearInterval(this._tick);
    if (this._watchTimer) clearInterval(this._watchTimer);
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    for (const w of this.evdevWatchers) { try { w.stream.kill(); } catch (_) {} }
    this.evdevWatchers = [];
    if (this.screenOff) this.wake('shutdown');
  }
}

module.exports = { DisplayController };
