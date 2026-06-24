const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haCompanion', {
  // System controls
  setVolume: (v) => ipcRenderer.invoke('set-volume', v),
  setMute: (m) => ipcRenderer.invoke('set-mute', m),
  setBrightness: (v) => ipcRenderer.invoke('set-brightness', v),
  bluetoothScan: () => ipcRenderer.invoke('bluetooth-scan'),
  bluetoothConnect: (mac) => ipcRenderer.invoke('bluetooth-connect', mac),

  // App controls
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  logout: () => ipcRenderer.invoke('logout'),
  quit: () => ipcRenderer.invoke('quit'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getAudioStatus: () => ipcRenderer.invoke('get-audio-status'),
  setupAudio: () => ipcRenderer.invoke('setup-audio'),

  // Display
  displayOn: () => ipcRenderer.invoke('display-on'),
  displayOff: () => ipcRenderer.invoke('display-off'),
  getDisplayState: () => ipcRenderer.invoke('get-display-state'),

  // System power
  rebootSystem: () => ipcRenderer.invoke('reboot-system'),
  shutdownSystem: () => ipcRenderer.invoke('shutdown-system'),

  // CPU
  getGovernor: () => ipcRenderer.invoke('get-governor'),
  setGovernor: (gov) => ipcRenderer.invoke('set-governor', gov),

  // Network
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),

  // Audio output
  getAudioOutputs: () => ipcRenderer.invoke('get-audio-outputs'),
  setAudioOutput: (sink) => ipcRenderer.invoke('set-audio-output', sink),

  // Hardware
  getHardwareInfo: () => ipcRenderer.invoke('get-hardware-info'),

  // Updates
  checkUpdates: () => ipcRenderer.invoke('check-updates'),

  // Schedule
  getSchedule: () => ipcRenderer.invoke('get-schedule'),
  setSchedule: (s) => ipcRenderer.invoke('set-schedule', s),

  // Auth
  connect: (data) => ipcRenderer.invoke('connect', data),
  loginWithCredentials: (data) => ipcRenderer.invoke('login-with-credentials', data),
  getSensors: () => ipcRenderer.invoke('get-sensors'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getLocales: () => ipcRenderer.invoke('get-locales'),

  // Notifications
  getNotificationHistory: () => ipcRenderer.invoke('get-notification-history'),
  playNotificationSound: (sound) => ipcRenderer.invoke('play-notification-sound', sound),
  listCustomSounds: () => ipcRenderer.invoke('list-custom-sounds'),
  getChannels: () => ipcRenderer.invoke('get-channels'),
  updateChannel: (id, settings) => ipcRenderer.invoke('update-channel', id, settings),
  deleteChannel: (id) => ipcRenderer.invoke('delete-channel', id),
});
