/**
 * HA Linux Companion — Electron Main Process
 * Professional Home Assistant companion for Linux panels
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, screen, Notification } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const si = require('systeminformation');
const auth = require('./auth');

// ── Config ──
const CONFIG_DIR = path.join(os.homedir(), '.config', 'ha-linux-companion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const APP_VERSION = app.getVersion();

let mainWindow = null;
let tray = null;
let sensorInterval = null;
let config = null;

// Use auth module for config management
function loadConfig() { return auth.loadConfig(); }
function saveConfig(data) { return auth.saveConfig(data); }

// ── HA API Client ──
class HAClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.deviceId = null;
    this.webhookId = null;
  }

  async request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.baseUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        rejectUnauthorized: false,
      };

      if (this.token && !headers.Authorization) {
        options.headers['Authorization'] = `Bearer ${this.token}`;
      }

      const req = lib.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, data: raw, headers: res.headers });
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(new Error('Connection timeout')); });

      if (body) {
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(data);
      }
      req.end();
    });
  }

  async registerDevice(deviceName) {
    // Stable deviceId from MAC address — prevents duplicate registrations
    if (!this.deviceId) {
      const mac = getMacAddress();
      this.deviceId = crypto.createHash('sha256').update(mac || os.hostname()).digest('hex').substring(0, 32);
    }
    const deviceId = this.deviceId;
    this.deviceId = deviceId;
    try {
      const res = await this.request('POST', '/api/mobile_app/registrations',
        JSON.stringify({
          device_name: deviceName || os.hostname(),
          app_id: 'io.homeassistant.linux-companion',
          app_name: 'HA Linux Companion',
          app_version: APP_VERSION,
          os_name: 'Linux', os_version: os.release(),
          manufacturer: 'Raspberry Pi',
          model: os.hostname(),
          device_id: deviceId,
          supports_encryption: false,
          app_data: {
            push_url: `http://${getLocalIP()}:0/notify`,
            push_token: 'pending',
            push_websocket_channel: true,
          },
        }),
        { 'Content-Type': 'application/json' }
      );
      if (res.status === 201 && res.data) {
        this.webhookId = res.data.webhook_id || res.data.webhookId;
        this.cloudhookUrl = res.data.cloudhook_url || res.data.cloudhookUrl;
        log('[REG] status: ' + res.status + ' data: ' + JSON.stringify(res.data));
        return true;
      }
      log('[REG] failed: ' + res.status + ' ' + JSON.stringify(res.data));
    } catch (e) {
      log('[REG] error: ' + e.message);
    }
    return false;
  }

  async webhook(type, data = {}) {
    if (!this.webhookId) return null;
    try {
      const res = await this.request('POST',
        `/api/webhook/${this.webhookId}`,
        JSON.stringify({ type, data }),
        { 'Content-Type': 'application/json' }
      );
      log('[WEBHOOK] ' + type + ': ' + res.status);
      return res;
    } catch (e) {
      log('[WEBHOOK] error: ' + e.message);
      return null;
    }
  }

  async updateSensors(sensors) {
    if (!this.webhookId) return;

    // Register sensors first
    for (const sensor of sensors) {
      await this.webhook('register_sensor', sensor);
    }

    // Then update states (strip registration-only fields)
    const states = sensors.map(s => ({ unique_id: s.unique_id, state: s.state, type: s.type }));
    await this.webhook('update_sensor_states', states);
  }

  // Update push_url for an existing registration
  async updatePushUrl(pushUrl, pushToken) {
    if (!this.webhookId) return;
    try {
      const result = await this.webhook('update_registration', {
        app_data: {
          push_url: pushUrl,
          push_token: pushToken,
          push_websocket_channel: true,
        },
      });
      log('[PushNotify] Updated push_url: ' + pushUrl + ' → ' + JSON.stringify(result?.data));
      return true;
    } catch (e) {
      log('[PushNotify] Failed to update push_url: ' + e.message);
      return false;
    }
  }
}

let haClient = null;

// ── Sensors ──
const LOG_FILE = path.join(os.homedir(), '.config', 'ha-linux-companion', 'app.log');
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

async function collectSensors() {
  const sensors = [];

  try {
    // CPU Temperature (Raspberry Pi)
    try {
      const tempRaw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      const temp = parseFloat(tempRaw) / 1000;
      sensors.push({
        unique_id: 'cpu_temperature', state: temp.toFixed(1), type: 'sensor',
        name: 'CPU Temperature', icon: 'mdi:thermometer',
      });
    } catch (e) { /* not a Pi */ }

    // CPU Usage
    try {
      const cpu = await si.currentLoad();
      sensors.push({
        unique_id: 'cpu_usage', state: cpu.currentLoad.toFixed(1), type: 'sensor',
        name: 'CPU Usage', icon: 'mdi:cpu-64-bit',
      });
    } catch (e) {}

    // RAM
    try {
      const mem = await si.mem();
      sensors.push({
        unique_id: 'ram_usage', state: ((mem.used / mem.total) * 100).toFixed(1), type: 'sensor',
        name: 'RAM Usage', icon: 'mdi:memory',
      });
      sensors.push({
        unique_id: 'ram_free_mb', state: (mem.available / 1048576).toFixed(0), type: 'sensor',
        name: 'RAM Free', icon: 'mdi:memory',
      });
    } catch (e) {}

    // Disk
    try {
      const disk = await si.fsSize();
      const root = disk.find(d => d.mount === '/') || disk[0];
      if (root) {
        sensors.push({
          unique_id: 'disk_usage', state: root.use.toFixed(1), type: 'sensor',
          name: 'Disk Usage', icon: 'mdi:harddisk',
        });
      }
    } catch (e) {}

    // Uptime
    const upSec = os.uptime();
    sensors.push({
      unique_id: 'system_uptime',
      state: Math.floor(upSec / 86400) + 'd ' + Math.floor((upSec % 86400) / 3600) + 'h',
      type: 'sensor', name: 'System Uptime', icon: 'mdi:clock',
    });

    // IP
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name]) {
        if (n.family === 'IPv4' && !n.internal && (name.startsWith('eth') || name.startsWith('wlan') || name.startsWith('end'))) {
          sensors.push({ unique_id: 'ip_address', state: n.address, type: 'sensor', name: 'IP Address', icon: 'mdi:ip-network' });
        }
      }
    }

    // Display
    sensors.push({
      unique_id: 'display_state',
      state: mainWindow && !mainWindow.isDestroyed() ? 'on' : 'off',
      type: 'binary_sensor', name: 'Display', icon: 'mdi:monitor',
    });

  } catch (err) {
    log('Sensor error: ' + err.message);
  }

  return sensors;
}

async function startSensorUpdates() {
  if (sensorInterval) clearInterval(sensorInterval);
  log('[Sensors] Starting updates, webhookId: ' + (haClient ? haClient.webhookId : 'null'));

  const update = async () => {
    if (!haClient || !haClient.webhookId) return;
    try {
      const sensors = await collectSensors();
      if (sensors.length > 0) {
        await haClient.updateSensors(sensors);
        log('[Sensors] ' + sensors.length + ' updated: ' + sensors.map(s => s.unique_id + '=' + s.state).join(', '));
      }
    } catch (err) {
      log('[Sensors] Error: ' + err.message);
    }
  };

  await update();
  sensorInterval = setInterval(update, 60000);
}

function stopSensorUpdates() {
  if (sensorInterval) {
    clearInterval(sensorInterval);
    sensorInterval = null;
  }
}

// ── Window Management ──
function createMainWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: config.windowWidth || screenWidth,
    height: config.windowHeight || screenHeight,
    fullscreen: config.fullscreen !== false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    show: false, // Show when ready
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (config.fullscreen !== false) {
      mainWindow.setFullScreen(true);
    }
  });

  // Load the app UI
  loadAppView();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadAppView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const token = auth.getAccessToken();
  if (config.url && token) {
    // Connected — load HA dashboard
    loadDashboard();
  } else {
    // Not connected — show login
    loadLoginView();
  }
}

function loadLoginView() {
  mainWindow.loadFile(path.join(__dirname, 'views', 'login.html'));
}

let dashboardLoaded = false;
let authInjected = false;

function loadDashboard() {
  // Always reload config to get latest token after refresh
  config = loadConfig();
  if (!config.url) return;

  const haUrl = config.url.replace(/\/+$/, '');
  // Clear any pending reconnect and stale socket
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (haWs) { try { haWs.removeAllListeners(); haWs.close(); } catch(_) {} haWs = null; }

  wsConnecting = true;
  const token = auth.getAccessToken() || config.token;
  dashboardLoaded = false;
  authInjected = false;

  mainWindow.loadURL(haUrl, {
    userAgent: 'HA-Linux-Companion/' + APP_VERSION + ' (Linux; ' + os.hostname() + ')',
  });

  // Detect when WebView lands on HA login page after disconnect/restart
  mainWindow.webContents.removeAllListeners('did-navigate');
  mainWindow.webContents.on('did-navigate', (event, url) => {
    if (url.includes('/auth/authorize') || url.includes('/auth/login') || url.includes('/auth/token')) {
      log('[WebView] Detected HA login page, reloading dashboard with fresh token...');
      setTimeout(() => loadDashboard(), 1000);
    }
  });

  mainWindow.webContents.removeAllListeners('did-finish-load');
  mainWindow.webContents.on('did-finish-load', () => {
    if (authInjected) return;
    authInjected = true;

    const token = auth.getAccessToken() || config.token;
    const expires = Date.now() + 86400000;
    const injectCode = [
      '(function() {',
      '  var tokens = {',
      '    hassUrl: "' + haUrl + '",',
      '    clientId: null,',
      '    expires: ' + expires + ',',
      '    refresh_token: false,',
      '    access_token: "' + token + '",',
      '    expires_in: 86400,',
      '    token_type: "Bearer"',
      '  };',
      '  localStorage.setItem("hassTokens", JSON.stringify(tokens));',
      '  return true;',
      '})()'
    ].join('\n');

    mainWindow.webContents.executeJavaScript(injectCode).then(() => {
      dashboardLoaded = false;
      mainWindow.webContents.on('did-finish-load', function onLoad() {
        if (dashboardLoaded) return;
        dashboardLoaded = true;
        mainWindow.webContents.removeListener('did-finish-load', onLoad);
        mainWindow.webContents.insertCSS(
          'ha-sidebar { display: none !important; } ' +
          'hui-root { --sidebar-width: 0px !important; }'
        );

        // Inject settings overlay
        try {
          const overlayCode = fs.readFileSync(path.join(__dirname, 'views', 'overlay.js'), 'utf8');
          mainWindow.webContents.executeJavaScript(overlayCode);
        } catch (e) {
          log('[Overlay] Error injecting: ' + e.message);
        }

        // Inject toast notification overlay
        try {
          const toastCss = fs.readFileSync(path.join(__dirname, 'views', 'toast.css'), 'utf8');
          let toastJs = fs.readFileSync(path.join(__dirname, 'views', 'toast.js'), 'utf8');
          toastJs = toastJs.replace('{{TOAST_CSS}}', JSON.stringify(toastCss).slice(1, -1));
          mainWindow.webContents.executeJavaScript(toastJs);
          log('[Toast] Overlay injected');
        } catch (e) {
          log('[Toast] Error injecting: ' + e.message);
        }

        if (haClient) startSensorUpdates();
        connectNotifications();
      });
      mainWindow.webContents.reload();
    });
  });
}

// ── Utility: get local LAN IP ──
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal && (name.startsWith('eth') || name.startsWith('wlan') || name.startsWith('end'))) {
        return n.address;
      }
    }
  }
  return '127.0.0.1';
}

function getMacAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00') {
        return n.mac;
      }
    }
  }
  return null;
}

// ── Push Notification Server ──
// HA creates notify.mobile_app_<device> ONLY if push_url is provided during registration.
// We run a tiny HTTP server that receives push notifications from HA
// and displays them as native notifications + overlay popups.
let pushServer = null;
let pushPort = 0;
let pushToken = crypto.randomBytes(16).toString('hex');

function startPushServer() {
  if (pushServer) return; // already running

  pushServer = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        // Validate push token if HA sends it
        if (data.push_token && data.push_token !== pushToken) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid push token' }));
          return;
        }

        const title = data.title || 'Home Assistant';
        const message = data.message || '';
        log('[PushNotify] Received: ' + title + ': ' + message);

        // Check if it's a command
        if (handleNotificationCommand(message, data)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'command_executed' }));
          return;
        }

        showNotification(title, message, {
          priority: data.priority || 'default',
          sound: data.push_sound || 'default',
          icon: data.icon,
          actions: data.actions,
          channel: data.channel,
          channelName: data.channel_name,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        log('[PushNotify] Parse error: ' + e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
  });

  // Listen on a random available port
  pushServer.listen(0, '0.0.0.0', () => {
    pushPort = pushServer.address().port;
    log('[PushNotify] Server listening on 0.0.0.0:' + pushPort);
  });

  pushServer.on('error', (err) => {
    log('[PushNotify] Server error: ' + err.message);
  });
}

function stopPushServer() {
  if (pushServer) {
    pushServer.close();
    pushServer = null;
    pushPort = 0;
  }
}

// ── Notifications via WebSocket ──
let haWs = null;
let wsReconnectTimer = null;

let wsConnecting = false;

function cleanupWs() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (haWs) {
    try { haWs.removeAllListeners(); haWs.close(); } catch (_) {}
    haWs = null;
  }
  wsConnecting = false;
}
function connectNotifications() {
  // Guard: prevent parallel connections
  if (wsConnecting) return;

  // Always reload config to pick up refreshed tokens
  config = loadConfig();
  const accessToken = auth.getAccessToken() || config.token;
  if (!config.url || !accessToken) return;

  const haUrl = config.url.replace(/\/+$/, '');
  // Clear any pending reconnect and stale socket
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (haWs) { try { haWs.removeAllListeners(); haWs.close(); } catch(_) {} haWs = null; }

  wsConnecting = true;
  const wsUrl = haUrl.replace(/^http/, 'ws') + '/api/websocket';

  log('[WS] Connecting to ' + wsUrl);

  const WebSocket = require('ws');

  try {
    haWs = new WebSocket(wsUrl, { rejectUnauthorized: false });
  } catch (e) {
    log('[WS] Error: ' + e.message);
    wsConnecting = false;
    return;
  }

  haWs.on('open', () => {
    wsConnecting = false;
    // Auth
    haWs.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
    log('[WS] Connected');
  });

  haWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'auth_ok') {
        // Subscribe to HA events
        haWs.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'persistent_notifications_updated' }));

        // Subscribe to mobile_app push notification channel (standard HA way)
        if (config.webhookId) {
          haWs.send(JSON.stringify({
            id: 2, type: 'mobile_app/push_notification_channel',
            webhook_id: config.webhookId, support_confirm: true,
          }));
          log('[WS] Subscribed to push notification channel');
        }

        log('[WS] Authenticated');
      }

      if (msg.type === 'event' && msg.event) {
        const ev = msg.event;

        // Mobile app push notification from HA (standard push channel)
        if (ev.message !== undefined || ev.title !== undefined) {
          // Check if it's a command
          if (handleNotificationCommand(ev.message, ev.data)) {
            // Command executed, confirm and skip toast
            if (ev.hass_confirm_id) {
              haWs.send(JSON.stringify({
                id: 3, type: 'mobile_app/push_notification_confirm',
                webhook_id: config.webhookId, confirm_id: ev.hass_confirm_id,
              }));
            }
            return;
          }
          showNotification(ev.title || 'Home Assistant', ev.message || '', {
            priority: ev.data?.priority || 'default',
            sound: ev.data?.push_sound || 'default',
            icon: ev.data?.icon,
            actions: ev.data?.actions,
            channel: ev.data?.channel,
            channelName: ev.data?.channel_name,
          });
          // Confirm receipt
          if (ev.hass_confirm_id) {
            haWs.send(JSON.stringify({
              id: 3, type: 'mobile_app/push_notification_confirm',
              webhook_id: config.webhookId, confirm_id: ev.hass_confirm_id,
            }));
          }
          return;
        }

        // Persistent notifications
        if (ev.event_type === 'persistent_notifications_updated') {
          const notifs = ev.data || {};
          for (const [id, n] of Object.entries(notifs)) {
            if (n.title || n.message) {
              showNotification(n.title || 'Home Assistant', n.message || '');
            }
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  haWs.on('close', () => {
    haWs = null;
    wsConnecting = false;
    log('[WS] Disconnected, reconnecting in 10s');
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectNotifications, 10000);
  });

  haWs.on('error', (err) => {
    log('[WS] Error: ' + err.message);
    wsConnecting = false;
  });
}

// ── HA Connection Monitor ──
// When HA restarts, the companion loses WebSocket and gets an error page.
// This monitor pings HA periodically when disconnected and auto-reloads when back.
let haConnected = true;
let healthCheckInterval = null;
const HEALTH_CHECK_INTERVAL = 10000; // 10s when disconnected
const HEALTH_CHECK_OK_INTERVAL = 60000; // 60s when connected

function haIsReachable() {
  return new Promise((resolve) => {
    if (!config || !config.url) { resolve(false); return; }
    const parsed = new URL(config.url.replace(/\/+$/, ''));
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: '/api/',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + (auth.getAccessToken() || config.token || '') },
      rejectUnauthorized: false,
      timeout: 5000,
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function startHealthCheck() {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  healthCheckInterval = setInterval(healthCheckTick, haConnected ? HEALTH_CHECK_OK_INTERVAL : HEALTH_CHECK_INTERVAL);
  log('[Health] Monitor started (interval: ' + (haConnected ? '60s' : '10s') + ')');
}

async function healthCheckTick() {
  const reachable = await haIsReachable();
  if (reachable && !haConnected) {
    log('[Health] HA is back online, reconnecting...');
    haConnected = true;
    
    // Refresh token if needed
    try {
      const inst = auth.getAuthInstance();
      if (inst && typeof inst.refreshAccessToken === 'function') {
        const cfg = loadConfig();
        const expires = cfg.tokenExpires || 0;
        if (expires && Date.now() > expires - 60000) {
          await inst.refreshAccessToken();
          config = loadConfig();
          log('[Health] Token refreshed after HA restart');
        }
      }
    } catch (e) {
      log('[Health] Token refresh failed: ' + e.message);
    }
    
    // Re-create HA client with fresh token
    const token = auth.getAccessToken() || config.token;
    if (token && config.url) {
      haClient = new HAClient(config.url, token);
      if (config.deviceId) haClient.deviceId = config.deviceId;
      if (config.webhookId) haClient.webhookId = config.webhookId;
      startSensorUpdates();
    }
    
    // Reload dashboard in Electron
    if (mainWindow && !mainWindow.isDestroyed()) {
      loadDashboard();
    }
    
    // Reconnect WebSocket notifications
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    connectNotifications();
    
    // Switch to slow health check
    clearInterval(healthCheckInterval);
    healthCheckInterval = setInterval(healthCheckTick, HEALTH_CHECK_OK_INTERVAL);
    
  } else if (!reachable && haConnected) {
    log('[Health] HA went offline');
    haConnected = false;
    stopSensorUpdates();
    // Switch to fast health check
    clearInterval(healthCheckInterval);
    healthCheckInterval = setInterval(healthCheckTick, HEALTH_CHECK_INTERVAL);
  }
}

function stopHealthCheck() {
  if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
}

// ── Notification System ──
// Complete notification system with audio, themes, and rich content.
// Falls back gracefully when system notification daemon is unavailable.

const NOTIFICATION_THEMES = {
  default:  { accent: '#0A84FF', icon: '🔔', sound: 'default' },
  success:  { accent: '#30D158', icon: '✅', sound: 'success' },
  warning:  { accent: '#FFD60A', icon: '⚠️', sound: 'warning' },
  error:    { accent: '#FF453A', icon: '❌', sound: 'error' },
  info:     { accent: '#64D2FF', icon: 'ℹ️', sound: 'default' },
};

// ── Audio Fallback Chain ──
// Detects audio backend at startup, falls back gracefully
let audioBackend = 'unknown'; // 'pipewire' | 'pulseaudio' | 'alsa' | 'alsa-dmix' | 'none'
let alsaDefaultDevice = null;

function detectAudioBackend() {
  try {
    // 1. Check PipeWire
    if (runShell('pgrep -x pipewire') !== '') {
      audioBackend = 'pipewire';
      log('[Audio] Backend: PipeWire');
      return;
    }
    // 2. Check PulseAudio
    if (runShell('pgrep -x pulseaudio') !== '') {
      audioBackend = 'pulseaudio';
      log('[Audio] Backend: PulseAudio');
      return;
    }
    // 3. Check ALSA
    if (runShell('aplay -l 2>/dev/null | grep -q card && echo yes') === 'yes') {
      audioBackend = 'alsa';
      log('[Audio] Backend: ALSA (direct only — may conflict with other apps)');
      return;
    }
    audioBackend = 'none';
    log('[Audio] Backend: No audio device found');
  } catch (e) {
    log('[Audio] Detection failed: ' + e.message);
    audioBackend = 'unknown';
  }
}

// Generate a notification WAV file in-memory (for aplay fallback)
function generateWav(freq, durationMs) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const dataSize = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize);

  // WAV header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);      // PCM
  buf.writeUInt16LE(1, 20);        // PCM format
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.max(0, 1 - t / (durationMs / 1000));
    const val = Math.floor(Math.sin(2 * Math.PI * freq * t) * envelope * 32000);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, val)), 44 + i * 2);
  }
  return buf;
}

// Sound presets: freq array for multi-tone
const SOUND_PRESETS = {
  default: [{ f: 880, d: 150 }, { f: 660, d: 150 }],
  success: [{ f: 523, d: 100 }, { f: 659, d: 100 }, { f: 784, d: 200 }],
  warning: [{ f: 600, d: 120 }, { f: 400, d: 120 }, { f: 600, d: 150 }],
  error:   [{ f: 300, d: 200 }, { f: 200, d: 200 }],
};

// Play notification sound via system audio (fallback from Web Audio)
function playCustomSound(filePath) {
  if (audioBackend === 'none' || !fs.existsSync(filePath)) return false;
  try {
    let cmd = null;
    if (audioBackend === 'pipewire') {
      cmd = `XDG_RUNTIME_DIR=/run/user/$(id -u) pw-play "${filePath}" 2>/dev/null || paplay "${filePath}" 2>/dev/null`;
    } else if (audioBackend === 'pulseaudio') {
      cmd = `paplay "${filePath}" 2>/dev/null`;
    } else {
      cmd = `aplay -D default "${filePath}" 2>/dev/null || aplay "${filePath}" 2>/dev/null`;
    }
    require('child_process').exec(cmd, { timeout: 5000 });
    log('[Audio] Custom sound: ' + path.basename(filePath));
    return true;
  } catch (e) {
    log('[Audio] Custom sound error: ' + e.message);
    return false;
  }
}

function listCustomSounds() {
  const soundsDir = path.join(CONFIG_DIR, 'sounds');
  try {
    if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
    return fs.readdirSync(soundsDir)
      .filter(f => /\.(wav|ogg|mp3|flac)$/i.test(f))
      .map(f => ({ name: f.replace(/\.[^.]+$/, ''), file: f }));
  } catch (e) {
    return [];
  }
}

function playNotificationSound(soundName) {
  if (audioBackend === 'none') return;
  // Check if it's a custom sound file
  if (soundName && soundName.startsWith('custom:')) {
    const fileName = soundName.slice(7);
    const filePath = path.join(CONFIG_DIR, 'sounds', fileName);
    playCustomSound(filePath);
    return;
  }
  try {
    const preset = SOUND_PRESETS[soundName] || SOUND_PRESETS.default;
    // Generate a combined WAV
    const sampleRate = 22050;
    let allSamples = [];
    for (const tone of preset) {
      const n = Math.floor(sampleRate * tone.d / 1000);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const env = Math.max(0, 1 - t / (tone.d / 1000));
        allSamples.push(Math.floor(Math.sin(2 * Math.PI * tone.f * t) * env * 32000));
      }
    }
    const dataSize = allSamples.length * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < allSamples.length; i++) {
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, allSamples[i])), 44 + i * 2);
    }

    // Write to temp file
    const tmpWav = path.join(os.tmpdir(), 'ha-companion-notif.wav');
    fs.writeFileSync(tmpWav, buf);

    // Play via best available method
    let cmd = null;
    if (audioBackend === 'pipewire') {
      cmd = `XDG_RUNTIME_DIR=/run/user/$(id -u) pw-play "${tmpWav}" 2>/dev/null || paplay "${tmpWav}" 2>/dev/null`;
    } else if (audioBackend === 'pulseaudio') {
      cmd = `paplay "${tmpWav}" 2>/dev/null`;
    } else if (audioBackend === 'alsa-dmix') {
      cmd = `aplay -D default "${tmpWav}" 2>/dev/null`;
    } else {
      cmd = `aplay "${tmpWav}" 2>/dev/null`;
    }
    // Fire and forget — don't block the notification
    require('child_process').exec(cmd, { timeout: 3000 }, () => {
      try { fs.unlinkSync(tmpWav); } catch (e) {}
    });
  } catch (e) {
    log('[Audio] playNotificationSound error: ' + e.message);
  }
}

// Generate notification sounds using Web Audio API (no external files needed)
const SOUND_GENERATORS = {
  default:  '(function(ctx){var t=ctx.currentTime;var notes=[[880,0,0.15],[880,0.2,0.15],[1047,0.45,0.3]];notes.forEach(function(n){var o=ctx.createOscillator();var g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(n[0],t+n[1]);g.gain.setValueAtTime(0.3,t+n[1]);g.gain.exponentialRampToValueAtTime(0.01,t+n[1]+n[2]);o.start(t+n[1]);o.stop(t+n[1]+n[2]);});})',
  success:  '(function(ctx){var t=ctx.currentTime;var notes=[[523,0,0.1],[659,0.12,0.1],[784,0.24,0.1],[1047,0.36,0.4]];notes.forEach(function(n){var o=ctx.createOscillator();var g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(n[0],t+n[1]);g.gain.setValueAtTime(0.3,t+n[1]);g.gain.exponentialRampToValueAtTime(0.01,t+n[1]+n[2]);o.start(t+n[1]);o.stop(t+n[1]+n[2]);});})',
  warning:  '(function(ctx){var t=ctx.currentTime;var notes=[[600,0,0.15],[400,0.2,0.15],[600,0.4,0.15],[400,0.6,0.15]];notes.forEach(function(n){var o=ctx.createOscillator();var g=ctx.createGain();o.type="square";o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(n[0],t+n[1]);g.gain.setValueAtTime(0.2,t+n[1]);g.gain.exponentialRampToValueAtTime(0.01,t+n[1]+n[2]);o.start(t+n[1]);o.stop(t+n[1]+n[2]);});})',
  error:    '(function(ctx){var t=ctx.currentTime;var notes=[[300,0,0.2],[200,0.25,0.2],[300,0.5,0.2],[200,0.75,0.3]];notes.forEach(function(n){var o=ctx.createOscillator();var g=ctx.createGain();o.type="sawtooth";o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(n[0],t+n[1]);g.gain.setValueAtTime(0.25,t+n[1]);g.gain.exponentialRampToValueAtTime(0.01,t+n[1]+n[2]);o.start(t+n[1]);o.stop(t+n[1]+n[2]);});})',
};

// ── Notification Channels ──
// Auto-created from HA data.channel, persisted in channels.json
// Per-channel: enabled, sound, priority, name
const CHANNELS_FILE = path.join(CONFIG_DIR, 'channels.json');
let channels = {};

function loadChannels() {
  try {
    if (fs.existsSync(CHANNELS_FILE)) {
      channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
    }
  } catch (e) {
    channels = {};
  }
}

function saveChannels() {
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
  } catch (e) {
    log('[Channels] Save error: ' + e.message);
  }
}

function ensureChannel(channelId, channelName) {
  if (!channelId) return null;
  if (!channels[channelId]) {
    channels[channelId] = {
      name: channelName || channelId,
      enabled: true,
      sound: 'default',
      priority: 'default',
      created: Date.now(),
    };
    saveChannels();
    log('[Channels] Created: ' + channelId);
    // Notify overlay to refresh
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(
        `window.__haChannels?.refresh?.()`
      ).catch(() => {});
    }
  }
  return channels[channelId];
}

function getEffectiveNotifOptions(options) {
  const channelId = options.channel;
  if (!channelId || !channels[channelId]) return options;
  const ch = channels[channelId];
  if (!ch.enabled) return null; // channel disabled → suppress
  return {
    ...options,
    priority: options.priority || ch.priority || 'default',
    sound: options.sound || ch.sound || 'default',
  };
}

loadChannels();

// ── Notification Commands ──
// HA can send commands via notify that execute actions instead of showing a toast
function handleNotificationCommand(message, data) {
  if (!message || typeof message !== 'string') return false;
  const cmd = message.trim().toLowerCase();
  const d = data || {};

  switch (cmd) {
    case 'command_screen_on':
      runShell('vcgencmd display_power 1 2>/dev/null || xset dpms force on 2>/dev/null');
      log('[Command] screen_on');
      return true;

    case 'command_screen_off':
      runShell('vcgencmd display_power 0 2>/dev/null || xset dpms force off 2>/dev/null');
      log('[Command] screen_off');
      return true;

    case 'command_screen_brightness_level':
      if (d.brightness !== undefined) {
        const val = Math.max(10, Math.min(100, parseInt(d.brightness)));
        // Try rpi-backlight
        try {
          const blPath = '/sys/class/backlight/rpi-backlight/brightness';
          if (fs.existsSync(blPath)) {
            const maxBright = parseInt(fs.readFileSync('/sys/class/backlight/rpi-backlight/max_brightness', 'utf8').trim());
            fs.writeFileSync(blPath, Math.round((val / 100) * maxBright).toString());
          }
        } catch (e) {}
        runShell('ddcutil setvcp 10 ' + val + ' --sleep-multiplier 0.1 2>/dev/null');
        log('[Command] brightness=' + val);
      }
      return true;

    case 'command_volume_level':
      if (d.volume_level !== undefined) {
        const vol = Math.max(0, Math.min(100, Math.round(parseFloat(d.volume_level) * 100)));
        runShell('amixer set Master ' + vol + '%');
        log('[Command] volume=' + vol + '%');
      }
      return true;

    case 'command_dnd':
      // Toggle app DND from HA
      const dndState = d.dnd;
      if (dndState !== undefined) {
        // Store DND in file for overlay to read
        try {
          const dndFile = path.join(CONFIG_DIR, 'dnd');
          fs.writeFileSync(dndFile, dndState ? '1' : '0');
        } catch (e) {}
        log('[Command] dnd=' + dndState);
      }
      return true;

    case 'command_bluetooth':
      if (d.bluetooth === 'turn_on' || d.bluetooth === 'turn_off') {
        runShell('bluetoothctl power ' + (d.bluetooth === 'turn_on' ? 'on' : 'off'));
        log('[Command] bluetooth ' + d.bluetooth);
      }
      return true;

    case 'command_update_sensors':
      // Force immediate sensor update
      updateSensors();
      log('[Command] update_sensors');
      return true;

    case 'command_open_url':
      if (d.url && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(d.url);
        log('[Command] open_url=' + d.url);
      }
      return true;

    case 'command_navigate':
      if (d.navigate && mainWindow && !mainWindow.isDestroyed()) {
        const baseUrl = config.url.replace(/\/$/, '');
        mainWindow.loadURL(baseUrl + '/' + d.navigate.replace(/^\//, ''));
        log('[Command] navigate=' + d.navigate);
      }
      return true;

    case 'command_restart_app':
      log('[Command] restart_app');
      app.relaunch();
      app.exit(0);
      return true;

    case 'command_reload_dashboard':
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
        log('[Command] reload_dashboard');
      }
      return true;

    case 'command_set_wallpaper':
      // Set HA dashboard background via CSS injection
      if (d.url && mainWindow && !mainWindow.isDestroyed()) {
        var bgUrl = d.url;
        mainWindow.webContents.executeJavaScript(
          'document.body.style.backgroundImage="url(' + JSON.stringify(bgUrl) + ')"; document.body.style.backgroundSize="cover";'
        ).catch(function(){});
        log('[Command] set_wallpaper');
      }
      return true;

    case 'command_set_theme':
      // Set HA theme via WebSocket
      if (d.theme && haWs && haWs.readyState === 1) {
        haWs.send(JSON.stringify({
          id: ++wsMsgId, type: 'call_service',
          domain: 'frontend', service: 'set_theme',
          service_data: { name: d.theme }
        }));
        log('[Command] set_theme=' + d.theme);
      }
      return true;

    default:
      // Check if message starts with 'command_' — if so, log unknown but don't show toast
      if (cmd.startsWith('command_')) {
        log('[Command] Unknown command: ' + cmd);
        return true; // consume it anyway
      }
      return false; // not a command, show as regular notification
  }
}

function showNotification(title, message, options = {}) {
  // Channel filtering
  if (options.channel) {
    ensureChannel(options.channel, options.channelName);
    const effective = getEffectiveNotifOptions(options);
    if (!effective) {
      log('[Notify] Suppressed (channel "' + options.channel + '" disabled)');
      return;
    }
    options = effective;
  }

  const priority = options.priority || 'default';
  const soundName = options.sound || 'default';
  log('[Notify] ' + title + ': ' + message + ' [' + priority + ']' + (options.channel ? ' ch=' + options.channel : ''));
  addToHistory(title, message);

  // Play sound via system audio
  playNotificationSound(soundName);

  // Send toast to overlay in main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.executeJavaScript(
        `window.__haToast?.show(${JSON.stringify({
          title,
          message,
          priority,
          icon: options.icon,
          sound: false,
          duration: options.duration,
          actions: options.actions,
          channel: options.channel,
        })})`
      );
    } catch (e) {
      log('[Notify] Toast inject error: ' + e.message);
    }
  }
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
      { label: '🏠 Dashboard', click: () => { if (mainWindow) mainWindow.show(); } },
      { label: '🔄 Reload', click: () => { if (mainWindow) mainWindow.webContents.reload(); } },
      { type: 'separator' },
      { label: '⛶ Toggle Fullscreen', click: () => {
        if (mainWindow) {
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
      }},
      { type: 'separator' },
      { label: '⚙️ Settings', click: () => { loadLoginView(); mainWindow.show(); } },
      { label: '❌ Disconnect', click: () => {
        auth.logout();
        haClient = null;
        stopSensorUpdates();
        config = loadConfig();
        loadLoginView();
        mainWindow.show();
      }},
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setToolTip('HA Linux Companion');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) mainWindow.show(); });
  } catch (err) {
    console.log('Tray not available:', err.message);
  }
}

// ── IPC Handlers ──
ipcMain.handle('get-config', () => config);

ipcMain.handle('connect', async (event, { url: haUrl, token, deviceName }) => {
  try {
    haUrl = haUrl.replace(/\/+$/, '');
    const result = await auth.loginWithToken(haUrl, token);
    
    if (!result.success) {
      return { success: false, error: result.error || 'Connection failed' };
    }

    // Register device
    const accessToken = auth.getAccessToken();
    const client = new HAClient(haUrl, accessToken);
    const registered = await client.registerDevice(deviceName || os.hostname());

    config = loadConfig();
    config.deviceName = deviceName || os.hostname();
    config.deviceId = client.deviceId;
    config.webhookId = client.webhookId;
    config.registered = registered;
    config.fullscreen = true;
    saveConfig(config);

    haClient = client;

    if (registered) {
      log('[AUTH] Device registered via token, webhookId:', client.webhookId);
      startSensorUpdates();
    }

    loadDashboard();
    return { success: true, registered };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('disconnect', () => {
  config = {};
  saveConfig(config);
  stopSensorUpdates();
  haClient = null;
  loadLoginView();
  return { success: true };
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    config.fullscreen = mainWindow.isFullScreen();
    saveConfig(config);
    return mainWindow.isFullScreen();
  }
  return false;
});

ipcMain.handle('get-sensors', async () => {
  return collectSensors();
});

ipcMain.handle('get-version', () => APP_VERSION);

// ── Notification History ──
const NOTIF_HISTORY_MAX = 50;
const notifHistory = [];

ipcMain.handle('get-notification-history', () => notifHistory);

ipcMain.handle('play-notification-sound', (event, sound) => {
  playNotificationSound(sound || 'default');
  return true;
});

ipcMain.handle('list-custom-sounds', () => listCustomSounds());

ipcMain.handle('get-channels', () => channels);
ipcMain.handle('update-channel', (event, id, settings) => {
  if (!channels[id]) return { error: 'not found' };
  Object.assign(channels[id], settings);
  saveChannels();
  return channels[id];
});
ipcMain.handle('delete-channel', (event, id) => {
  delete channels[id];
  saveChannels();
  return true;
});

// ── Display Controls ──
ipcMain.handle('display-on', () => {
  runShell('vcgencmd display_power 1 2>/dev/null || xset dpms force on 2>/dev/null');
  log('[Display] ON');
  return true;
});
ipcMain.handle('display-off', () => {
  runShell('vcgencmd display_power 0 2>/dev/null || xset dpms force off 2>/dev/null');
  log('[Display] OFF');
  return true;
});
ipcMain.handle('get-display-state', () => {
  const r = runShell('vcgencmd display_power 2>/dev/null');
  return r.includes('display_power=1') ? 'on' : r.includes('display_power=0') ? 'off' : 'unknown';
});

// ── System Power ──
ipcMain.handle('reboot-system', () => {
  log('[System] Reboot requested');
  runShell('sudo reboot 2>/dev/null || systemctl reboot 2>/dev/null');
  return true;
});
ipcMain.handle('shutdown-system', () => {
  log('[System] Shutdown requested');
  runShell('sudo poweroff 2>/dev/null || systemctl poweroff 2>/dev/null');
  return true;
});

// ── CPU Governor ──
ipcMain.handle('get-governor', () => {
  return runShell('cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null') || 'unknown';
});
ipcMain.handle('set-governor', (event, gov) => {
  if (['performance','powersave','ondemand','conservative','schedutil'].includes(gov)) {
    runShell('echo ' + gov + ' | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null');
    log('[CPU] Governor set to ' + gov);
  }
  return true;
});

// ── Network Info ──
ipcMain.handle('get-network-info', () => {
  const info = {};
  // WiFi
  const iwgetid = runShell('iwgetid -r 2>/dev/null');
  info.ssid = iwgetid || null;
  if (info.ssid) {
    const iwconfig = runShell('iwconfig wlan0 2>/dev/null');
    const sigMatch = iwconfig.match(/Signal level=(-?\d+) dBm/);
    info.signalDbm = sigMatch ? parseInt(sigMatch[1]) : null;
    info.signalPercent = info.signalDbm !== null ? Math.min(100, Math.max(0, 2 * (info.signalDbm + 100))) : null;
  }
  // IP
  info.ipAddress = runShell('hostname -I 2>/dev/null').split(' ')[0] || null;
  // Gateway
  const gw = runShell('ip route show default 2>/dev/null');
  const gwMatch = gw.match(/via (\S+)/);
  info.gateway = gwMatch ? gwMatch[1] : null;
  // Interface
  const ifaceMatch = gw.match(/dev (\S+)/);
  info.interface = ifaceMatch ? ifaceMatch[1] : null;
  // DNS
  const dns = runShell('cat /etc/resolv.conf 2>/dev/null');
  const dnsMatch = dns.match(/nameserver (\S+)/);
  info.dns = dnsMatch ? dnsMatch[1] : null;
  return info;
});

// ── Audio Output Selector ──
ipcMain.handle('get-audio-outputs', () => {
  const outputs = [];
  const pactl = runShell('pactl list sinks short 2>/dev/null');
  if (pactl) {
    pactl.split('\n').forEach(line => {
      if (!line.trim()) return;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const sinkId = parts[0];
        const name = parts[1];
        // Get description
        const desc = runShell('pactl get-sink-property ' + sinkId + ' node.description 2>/dev/null');
        const descClean = desc.replace(/^\s*"|"\s*$/g, '').trim() || name;
        // Check if default
        const defSink = runShell('pactl get-default-sink 2>/dev/null');
        outputs.push({ id: sinkId, name, description: descClean, isDefault: defSink === name });
      }
    });
  }
  // Fallback: amixer
  if (!outputs.length) {
    const amixer = runShell('amixer controls 2>/dev/null');
    if (amixer.includes('Master')) outputs.push({ id: '0', name: 'ALSA Master', description: 'Default Audio', isDefault: true });
  }
  return outputs;
});
ipcMain.handle('set-audio-output', (event, sinkName) => {
  runShell('pactl set-default-sink ' + sinkName + ' 2>/dev/null');
  log('[Audio] Output set to ' + sinkName);
  return true;
});

// ── Hardware Info ──
ipcMain.handle('get-hardware-info', () => {
  const hw = {};
  // Board model
  hw.boardModel = runShell('cat /sys/firmware/devicetree/base/model 2>/dev/null') || runShell('hostnamectl --static 2>/dev/null') || 'Unknown';
  // CPU
  hw.cpuModel = runShell('lscpu 2>/dev/null | grep "Model name" | cut -d: -f2').trim() || 'Unknown';
  hw.cpuCores = parseInt(runShell('nproc 2>/dev/null')) || 1;
  hw.cpuFreq = runShell('cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null');
  if (hw.cpuFreq) hw.cpuFreqMhz = Math.round(parseInt(hw.cpuFreq) / 1000);
  hw.cpuTemp = runShell('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null');
  if (hw.cpuTemp) hw.cpuTempC = (parseInt(hw.cpuTemp) / 1000).toFixed(1);
  // RAM
  const memInfo = runShell('free -m 2>/dev/null');
  const memMatch = memInfo.match(/Mem:\s+(\d+)\s+(\d+)/);
  if (memMatch) {
    hw.ramTotalMb = parseInt(memMatch[1]);
    hw.ramUsedMb = parseInt(memMatch[2]);
    hw.ramPercent = Math.round((parseInt(memMatch[2]) / parseInt(memMatch[1])) * 100);
  }
  // Disk
  const diskInfo = runShell('df -h / 2>/dev/null | tail -1');
  const diskMatch = diskInfo.match(/(\S+)\s+(\S+)\s+(\S+)\s+(\d+)%/);
  if (diskMatch) {
    hw.diskTotal = diskMatch[1];
    hw.diskUsed = diskMatch[2];
    hw.diskFree = diskMatch[3];
    hw.diskPercent = parseInt(diskMatch[4]);
  }
  // Uptime
  hw.uptime = runShell('uptime -p 2>/dev/null').replace('up ', '') || 'unknown';
  // Serial
  hw.serial = runShell('cat /sys/firmware/devicetree/base/serial-number 2>/dev/null') || null;
  // OS
  hw.os = runShell('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d\'"\' -f2') || 'Linux';
  // Kernel
  hw.kernel = runShell('uname -r 2>/dev/null');
  // Electron/Node versions
  hw.electronVersion = process.versions.electron;
  hw.nodeVersion = process.version;
  // App version
  hw.appVersion = APP_VERSION;
  // Arch
  hw.arch = process.arch;
  return hw;
});

// ── Update Channel ──
ipcMain.handle('check-updates', async () => {
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get('https://api.github.com/repos/SimoneB79/ha-linux-companion/releases', {
        headers: { 'User-Agent': 'ha-linux-companion' }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    const current = APP_VERSION;
    const latest = data.find(r => !r.prerelease);
    const latestDev = data.find(r => r.prerelease);
    return {
      current,
      latestStable: latest ? { tag: latest.tag_name, name: latest.name, url: latest.html_url, date: latest.published_at } : null,
      latestDev: latestDev ? { tag: latestDev.tag_name, name: latestDev.name, url: latestDev.html_url, date: latestDev.published_at } : null,
      allReleases: data.slice(0, 5).map(r => ({ tag: r.tag_name, name: r.name, prerelease: r.prerelease, date: r.published_at, url: r.html_url })),
    };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Night Schedule ──
const SCHEDULE_FILE = path.join(CONFIG_DIR, 'schedule.json');
let nightSchedule = { enabled: false, offTime: '23:00', onTime: '07:00' };
try {
  if (fs.existsSync(SCHEDULE_FILE)) nightSchedule = { ...nightSchedule, ...JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')) };
} catch (e) {}

function saveSchedule() {
  try { fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(nightSchedule, null, 2)); } catch (e) {}
}

// Check schedule every minute
let lastScheduleAction = null;
setInterval(() => {
  if (!nightSchedule.enabled) return;
  const now = new Date();
  const hhmm = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  if (hhmm === nightSchedule.offTime && lastScheduleAction !== 'off-' + hhmm) {
    lastScheduleAction = 'off-' + hhmm;
    runShell('vcgencmd display_power 0 2>/dev/null || xset dpms force off 2>/dev/null');
    log('[Schedule] Display OFF at ' + hhmm);
  }
  if (hhmm === nightSchedule.onTime && lastScheduleAction !== 'on-' + hhmm) {
    lastScheduleAction = 'on-' + hhmm;
    runShell('vcgencmd display_power 1 2>/dev/null || xset dpms force on 2>/dev/null');
    log('[Schedule] Display ON at ' + hhmm);
  }
}, 30000);

ipcMain.handle('get-schedule', () => nightSchedule);
ipcMain.handle('set-schedule', (event, s) => {
  nightSchedule = { ...nightSchedule, ...s };
  saveSchedule();
  return nightSchedule;
});

function addToHistory(title, message) {
  notifHistory.unshift({ title, message, time: new Date().toISOString() });
  if (notifHistory.length > NOTIF_HISTORY_MAX) notifHistory.pop();
}

// ── System Controls ──
const { execSync } = require('child_process');

function runShell(cmd) {
  try {
    const buf = execSync(cmd, { timeout: 5000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    return (buf || '').toString().trim();
  } catch (e) {
    return '';
  }
}

ipcMain.handle('set-volume', (event, vol) => {
  runShell('amixer set Master ' + vol + '%');
  log('[System] Volume set to ' + vol + '%');
  return true;
});

ipcMain.handle('set-mute', (event, muted) => {
  runShell('amixer set Master ' + (muted ? 'mute' : 'unmute'));
  return true;
});

ipcMain.handle('set-brightness', (event, val) => {
  // Try ddcutil first (external monitors)
  const r = runShell('ddcutil setvcp 10 ' + val + ' --sleep-multiplier 0.1 2>/dev/null');
  if (!r) {
    // Raspberry Pi — try rpi-backlight first, then pwm
    try {
      const blPath = '/sys/class/backlight/rpi-backlight/brightness';
      if (fs.existsSync(blPath)) {
        const maxBright = parseInt(fs.readFileSync('/sys/class/backlight/rpi-backlight/max_brightness', 'utf8').trim());
        const newVal = Math.round((val / 100) * maxBright);
        fs.writeFileSync(blPath, newVal.toString());
      }
    } catch (e) {
      log('[System] Brightness failed: ' + e.message);
    }
  }
  log('[System] Brightness set to ' + val + '%');
  return true;
});

ipcMain.handle('bluetooth-scan', async () => {
  const output = runShell('bluetoothctl --timeout 5 scan on 2>/dev/null; bluetoothctl devices 2>/dev/null');
  if (!output) return [];
  const devices = [];
  output.split('\n').forEach(line => {
    const m = line.match(/Device ([0-9A-F:]+) (.+)/i);
    if (m) devices.push({ mac: m[1], name: m[2] });
  });
  return devices;
});

ipcMain.handle('bluetooth-connect', (event, mac) => {
  runShell('bluetoothctl trust ' + mac + ' && bluetoothctl connect ' + mac);
  return true;
});

ipcMain.handle('get-system-info', () => {
  let volume = 50;
  const volOut = runShell('amixer get Master 2>/dev/null');
  const volMatch = volOut.match(/\[(\d+)%\]/);
  if (volMatch) volume = parseInt(volMatch[1]);

  return {
    volume,
    brightness: 100,
    hasBacklight: fs.existsSync('/sys/class/backlight/rpi-backlight/brightness') || runShell('ddcutil detect 2>/dev/null').includes('Display'),
    deviceName: config ? config.deviceName : 'Unknown',
    version: 'v' + APP_VERSION,
    sensors: config && config.registered ? 'active' : 'inactive',
    audioBackend,
  };
});

ipcMain.handle('get-audio-status', () => ({
  backend: audioBackend,
  needsSetup: audioBackend === 'alsa' || audioBackend === 'none',
  suggestion: audioBackend === 'alsa' ? 'Install PipeWire for proper audio mixing (prevents conflicts with squeezelite/LMS)'
             : audioBackend === 'none' ? 'No audio device detected'
             : null,
}));

ipcMain.handle('setup-audio', async () => {
  const script = path.join(__dirname, '..', 'scripts', 'setup-audio.sh');
  if (!fs.existsSync(script)) return { success: false, error: 'setup-audio.sh not found' };
  try {
    const { execSync } = require('child_process');
    const out = execSync('bash "' + script + '"', { timeout: 60000 }).toString();
    detectAudioBackend(); // re-detect
    return { success: true, output: out, backend: audioBackend };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('logout', () => {
  stopSensorUpdates();
  auth.logout();
  haClient = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.removeAllListeners('did-finish-load');
    mainWindow.loadFile(path.join(__dirname, 'views', 'login.html'));
  }
  return true;
});

ipcMain.handle('quit', () => {
  app.quit();
});

ipcMain.handle('login-with-credentials', async (event, { url: haUrl, username, password, deviceName }) => {
  try {
    haUrl = haUrl.replace(/\/+$/, '');
    
    // Use auth module for credential login
    const result = await auth.loginWithCredentials(haUrl, username, password);
    
    // Check if MFA is required
    if (result.mfa_required) {
      return {
        mfa_required: true,
        flow_id: result.flow_id,
        hass_url: result.hass_url,
      };
    }
    
    // Register device
    const accessToken = auth.getAccessToken();
    const client = new HAClient(haUrl, accessToken);
    const registered = await client.registerDevice(deviceName || os.hostname());

    config = loadConfig();
    config.deviceName = deviceName || os.hostname();
    config.deviceId = client.deviceId;
    config.webhookId = client.webhookId;
    config.registered = registered;
    config.fullscreen = true;
    saveConfig(config);

    haClient = client;

    if (registered) {
      log('[AUTH] Device registered, webhookId:', client.webhookId);
      startSensorUpdates();
    }
    loadDashboard();
    return { success: true, registered };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Submit 2FA code ──
ipcMain.handle('submit-mfa', async (event, { url: haUrl, flowId, mfaCode }) => {
  try {
    const result = await auth.submitMfa(haUrl, flowId, mfaCode);
    
    // Register device
    const accessToken = auth.getAccessToken();
    const client = new HAClient(haUrl.replace(/\/+$/, ''), accessToken);
    const registered = await client.registerDevice(os.hostname());

    config = loadConfig();
    config.deviceName = os.hostname();
    config.deviceId = client.deviceId;
    config.webhookId = client.webhookId;
    config.registered = registered;
    config.fullscreen = true;
    saveConfig(config);

    haClient = client;
    loadDashboard();
    return { success: true, registered };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Quit app ──
ipcMain.on('quit', () => app.quit());

// ── App Lifecycle ──
app.whenReady().then(async () => {
  config = loadConfig();

  // Wire auth module logger
  auth.setLogger(log);

  // Detect audio backend for notification sounds
  detectAudioBackend();

  // Start push notification server first (needed before device registration)
  startPushServer();

  // Restore HA session using auth module
  // This handles token refresh automatically and NEVER wipes config
  if (config.url) {
    log('[AUTH] Attempting to restore session...');
    const authResult = await auth.initFromSavedSession();
    
    if (authResult && auth.getAccessToken()) {
      // Session restored successfully
      const token = auth.getAccessToken();
      haClient = new HAClient(config.url, token);
      if (config.deviceId) haClient.deviceId = config.deviceId;
      if (config.webhookId) haClient.webhookId = config.webhookId;

      // Reload config in case auth module updated tokens
      config = loadConfig();
      
      log('[AUTH] Session restored, token active');

      // Wait for push server to be ready, then update push_url
      const waitForPushServer = setInterval(() => {
        if (pushPort > 0 && haClient) {
          clearInterval(waitForPushServer);
          const pushUrl = `http://${getLocalIP()}:${pushPort}/notify`;
          haClient.updatePushUrl(pushUrl, pushToken);
        }
      }, 500);
      setTimeout(() => clearInterval(waitForPushServer), 10000);
      
      // Start HA connection health monitor
      startHealthCheck();
    } else {
      log('[AUTH] Could not restore session, login required');
      // Don't wipe config — keep the URL and device info for next login
    }
  }

  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep running in tray on Linux
});

app.on('before-quit', () => {
  stopSensorUpdates();
  stopHealthCheck();
  stopPushServer();
  auth.cleanup();
});

// Prevent certificate errors for self-signed certs
// Accept all self-signed certs (home/local networks)
app.commandLine.appendSwitch('ignore-certificate-errors');
