// HA Linux Companion — Settings Overlay v3.0
(function() {
  if (window.__haCompanionMenu) return;
  window.__haCompanionMenu = true;

  const style = document.createElement('style');
  style.textContent = `
    /* ── Kiosk Status Bar ── */
    #ha-comp-topbar { position:fixed;top:0;left:0;right:0;height:50px;z-index:99999;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:rgba(18,18,20,0.88);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,0.06);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:rgba(255,255,255,0.85);font-size:14px;transition:opacity 0.4s,transform 0.4s; }
    #ha-comp-topbar.hidden { opacity:0;transform:translateY(-100%);pointer-events:none; }
    #ha-comp-topbar:hover, #ha-comp-topbar.reveal { opacity:1;transform:translateY(0);pointer-events:auto; }
    .topbar-left { display:flex;align-items:center;gap:14px; }
    .topbar-time { font-size:16px;font-weight:600;letter-spacing:0.3px;font-variant-numeric:tabular-nums; }
    .topbar-date { font-size:12px;color:rgba(255,255,255,0.5); }
    .topbar-temp { font-size:12px;display:flex;align-items:center;gap:3px; }
    .topbar-temp .dot { width:6px;height:6px;border-radius:50%;display:inline-block; }
    .topbar-right { display:flex;align-items:center;gap:10px; }
    .topbar-device { font-size:10px;color:rgba(255,255,255,0.35);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    #ha-comp-topbar-btn { width:40px;height:40px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,0.55);font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s; }
    #ha-comp-topbar-btn:hover { background:rgba(255,255,255,0.1);color:#fff; }
    #ha-comp-topbar-btn:active { background:rgba(255,255,255,0.15);transform:scale(0.92); }
    /* panel offset for topbar */
    #ha-comp-panel { position:fixed;top:0;right:-380px;z-index:99998;width:360px;height:100vh;background:rgba(28,28,30,0.97);backdrop-filter:blur(20px);border-left:1px solid #3A3A3C;color:#fff;transition:right 0.3s ease;overflow-y:auto;font-family:-apple-system,sans-serif;padding:20px 16px;box-sizing:border-box; }
    #ha-comp-panel.open { right:0; }
    #ha-comp-panel h3 { font-size:15px;font-weight:600;color:#8E8E93;text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 10px;padding-top:12px;border-top:1px solid #2C2C2E; }
    #ha-comp-panel h3:first-child { margin-top:0;border-top:none;padding-top:0; }
    .comp-row { display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2C2C2E; }
    .comp-label { font-size:14px;color:#fff; }
    .comp-sub { font-size:11px;color:#8E8E93;margin-top:2px; }
    .comp-slider { -webkit-appearance:none;width:120px;height:4px;background:#3A3A3C;border-radius:2px;outline:none; }
    .comp-slider::-webkit-slider-thumb { -webkit-appearance:none;width:20px;height:20px;background:#4A90D9;border-radius:10px;cursor:pointer; }
    .comp-btn { padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.15s; }
    .comp-btn.danger { background:#FF3B30;color:#fff; }
    .comp-btn.danger:hover { background:#FF453A; }
    .comp-btn.primary { background:#4A90D9;color:#fff; }
    .comp-btn.secondary { background:#3A3A3C;color:#fff; }
    .comp-btn.warning { background:#FF9500;color:#fff; }
    .comp-val { font-size:13px;color:#8E8E93;min-width:36px;text-align:right; }
    .comp-bt-item { display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2C2C2E;font-size:13px; }
    .comp-close-panel { position:absolute;top:12px;right:12px;background:none;border:none;color:#8E8E93;font-size:20px;cursor:pointer; }
    .comp-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
    .comp-header-title { font-size:18px;font-weight:700; }
    .comp-version { font-size:11px;color:#636366; }
    #comp-backdrop { position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.3);z-index:99997;display:none; }
    #comp-backdrop.open { display:block; }
    .comp-toggle { position:relative;width:44px;height:26px;background:#3A3A3C;border-radius:13px;cursor:pointer;transition:background 0.2s;border:none;flex-shrink:0; }
    .comp-toggle.on { background:#30D158; }
    .comp-toggle::after { content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:10px;transition:transform 0.2s; }
    .comp-toggle.on::after { transform:translateX(18px); }
    .comp-select { background:#2C2C2E;color:#fff;border:1px solid #3A3A3C;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;min-width:100px; }
    .comp-input { background:#2C2C2E;color:#fff;border:1px solid #3A3A3C;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;width:60px;text-align:center; }
    .comp-notif-row { display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2C2C2E;font-size:13px; }
    .comp-section-desc { font-size:11px;color:#636366;margin-bottom:8px; }
    .comp-info-grid { display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:6px 0; }
    .comp-info-item { font-size:12px; }
    .comp-info-item .comp-info-label { color:#8E8E93;font-size:10px;text-transform:uppercase;letter-spacing:0.3px; }
    .comp-info-item .comp-info-value { color:#fff;font-weight:500;margin-top:1px; }
    .comp-info-bar { height:4px;background:#3A3A3C;border-radius:2px;margin-top:3px;overflow:hidden; }
    .comp-info-bar-fill { height:100%;border-radius:2px;transition:width 0.3s; }
    .comp-update-row { display:flex;align-items:center;gap:10px;padding:10px;background:#2C2C2E;border-radius:8px;margin-top:4px; }
    .comp-update-badge { background:#FF9500;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600; }
    .comp-update-badge.current { background:#30D158; }
    .comp-time-input { display:flex;align-items:center;gap:4px; }
  `;
  document.head.appendChild(style);

  // Clock
  const dayNames = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

  // ── Kiosk Top Bar ──
  const topbar = document.createElement('div');
  topbar.id = 'ha-comp-topbar';
  topbar.innerHTML = `
    <div class="topbar-left">
      <span class="topbar-time" id="topbar-clock">--:--</span>
      <span class="topbar-date" id="topbar-date">--</span>
      <span class="topbar-temp" id="topbar-temp"></span>
    </div>
    <div class="topbar-right">
      <span class="topbar-device" id="topbar-device"></span>
      <button id="ha-comp-topbar-btn" title="Impostazioni">⚙</button>
    </div>
  `;
  document.body.appendChild(topbar);

  // Auto-hide bar after 5s of inactivity, reveal on top-edge touch/mouse
  let barHideTimer = null;
  let barPinned = false;
  function scheduleBarHide() {
    if (barPinned) return;
    clearTimeout(barHideTimer);
    barHideTimer = setTimeout(function() { if (!open) topbar.classList.add('hidden'); }, 5000);
  }
  function revealBar() { topbar.classList.remove('hidden'); scheduleBarHide(); }
  topbar.addEventListener('mouseenter', function() { clearTimeout(barHideTimer); topbar.classList.remove('hidden'); });
  topbar.addEventListener('mouseleave', function() { scheduleBarHide(); });
  // Touch: reveal on swipe-down from top edge (most reliable on touchscreens)
  let touchStartY = 0;
  document.addEventListener('touchstart', function(e) {
    touchStartY = e.touches[0].clientY;
    // Tap near top also reveals
    if (touchStartY < 60) revealBar();
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    // Swipe down from top 30px reveals the bar
    if (touchStartY < 30 && e.touches[0].clientY - touchStartY > 20) {
      revealBar();
      e.preventDefault(); // prevent HA from scrolling
    }
  }, { passive: false });
  document.addEventListener('mousemove', function(e) {
    if (e.clientY < 15) revealBar();
  });
  // Pin bar while panel is open
  // (handled in togglePanel below)

  function updateTopbarClock() {
    const now = new Date();
    const hh = now.getHours().toString().padStart(2,'0');
    const mm = now.getMinutes().toString().padStart(2,'0');
    document.getElementById('topbar-clock').textContent = hh + ':' + mm;
    document.getElementById('topbar-date').textContent = dayNames[now.getDay()] + ' ' + now.getDate() + ' ' + monthNames[now.getMonth()];
  }
  setInterval(updateTopbarClock, 1000);
  updateTopbarClock();

  // Update temp in topbar
  function updateTopbarTemp() {
    window.haCompanion.getHardwareInfo().then(function(hw) {
      if (!hw || !hw.cpuTempC) return;
      var t = parseFloat(hw.cpuTempC);
      var color = t > 70 ? '#FF3B30' : t > 55 ? '#FF9500' : '#30D158';
      var el = document.getElementById('topbar-temp');
      if (el) el.innerHTML = '<span class="dot" style="background:' + color + '"></span>' + hw.cpuTempC + '°C';
    });
  }
  setInterval(updateTopbarTemp, 30000);
  setTimeout(updateTopbarTemp, 3000);

  const backdrop = document.createElement('div');
  backdrop.id = 'comp-backdrop'; document.body.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.id = 'ha-comp-panel';
  panel.innerHTML = `
    <div class="comp-header"><span class="comp-header-title">HA Linux Companion</span><button class="comp-close-panel" id="comp-close">✕</button></div>
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;margin-bottom:4px;border-bottom:1px solid #2C2C2E" id="comp-clock-bar">
      <span style="font-size:18px;font-weight:700" class="clock-time">--:--:--</span>
      <span style="font-size:11px;color:#ABABAB" class="clock-date">--</span>
    </div>
    <div class="comp-version" id="comp-version">v1.0.0</div>

    <h3>🖥️ Display</h3>
    <div class="comp-row" id="comp-brightness-row"><div class="comp-label">Brightness</div><div style="display:flex;align-items:center;gap:8px"><input type="range" class="comp-slider" id="comp-brightness" min="10" max="100" value="100"><span class="comp-val" id="comp-brightness-val">100%</span></div></div>
    <div class="comp-row"><div class="comp-label">Monitor</div><div style="display:flex;gap:6px"><button class="comp-btn primary" id="comp-display-on" style="padding:6px 12px;font-size:12px">ON</button><button class="comp-btn secondary" id="comp-display-off" style="padding:6px 12px;font-size:12px">OFF</button></div></div>
    <div class="comp-row"><div class="comp-label">🌙 Schedula notte</div><button class="comp-toggle" id="comp-schedule-enabled"></button></div>
    <div id="comp-schedule-times" style="display:none;padding:6px 0">
      <div class="comp-row"><div class="comp-label">Spegni alle</div><input type="time" class="comp-input" id="comp-schedule-off" value="23:00"></div>
      <div class="comp-row"><div class="comp-label">Accendi alle</div><input type="time" class="comp-input" id="comp-schedule-on" value="07:00"></div>
    </div>

    <h3>🔊 Audio</h3>
    <div class="comp-row"><div class="comp-label">Volume</div><div style="display:flex;align-items:center;gap:8px"><input type="range" class="comp-slider" id="comp-volume" min="0" max="100" value="50"><span class="comp-val" id="comp-volume-val">50%</span></div></div>
    <div class="comp-row"><div class="comp-label">Mute</div><button class="comp-btn secondary" id="comp-mute">Off</button></div>
    <div class="comp-row"><div class="comp-label">Output</div><select class="comp-select" id="comp-audio-output"></select></div>

    <h3>📶 Network</h3>
    <div id="comp-network-info" class="comp-info-grid"></div>

    <h3>📶 Bluetooth</h3>
    <div class="comp-row"><div class="comp-label">Bluetooth</div><button class="comp-btn secondary" id="comp-bt-toggle">Scan</button></div>
    <div id="comp-bt-list"></div>

    <h3>🔧 Hardware</h3>
    <div id="comp-hw-info" class="comp-info-grid"></div>
    <div class="comp-row" style="margin-top:8px"><div class="comp-label">CPU Governor</div><select class="comp-select" id="comp-governor"><option value="ondemand">Ondemand</option><option value="performance">Performance</option><option value="powersave">Powersave</option><option value="conservative">Conservative</option><option value="schedutil">Schedutil</option></select></div>

    <h3>📊 Device</h3>
    <div class="comp-row"><div><div class="comp-label" id="comp-device-name">Panel</div><div class="comp-sub" id="comp-sensor-info">Sensors: --</div></div></div>

    <h3>🔔 Notifications</h3>
    <div class="comp-notif-row"><div class="comp-label">🔔 Notifiche</div><button class="comp-toggle" id="comp-notif-enabled"></button></div>
    <div class="comp-notif-row"><div class="comp-label">Suono</div><button class="comp-toggle on" id="comp-notif-sound"></button></div>
    <div class="comp-notif-row"><div class="comp-label">🌙 Non disturbare</div><button class="comp-toggle" id="comp-notif-dnd"></button></div>
    <div class="comp-notif-row"><div class="comp-label">Durata popup</div><select class="comp-select" id="comp-notif-duration"><option value="4000">4 sec</option><option value="6000" selected>6 sec</option><option value="10000">10 sec</option><option value="0">Mai</option></select></div>
    <div class="comp-notif-row"><div class="comp-label">Melodia</div><select class="comp-select" id="comp-notif-melody"><option value="default">Default</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option></select></div>
    <div id="comp-custom-sounds" style="display:none">
      <div class="comp-notif-row"><div class="comp-label">🎵 Suono personalizzato</div><select class="comp-select" id="comp-notif-custom"><option value="">-- seleziona --</option></select></div>
      <div class="comp-section-desc">Formati: .wav, .ogg, .mp3, .flac — <code style="color:#64D2FF;font-size:10px">~/.config/ha-linux-companion/sounds/</code></div>
    </div>
    <div class="comp-section-desc">Ultime notifiche</div>
    <div class="comp-row"><div class="comp-label" id="comp-notif-count">Nessuna notifica</div><button class="comp-btn secondary" id="comp-notif-clear">Cancella</button></div>
    <div id="comp-notif-list" style="max-height:200px;overflow-y:auto;"></div>

    <h3>📡 Canali</h3>
    <div class="comp-section-desc" id="comp-channels-desc">I canali si creano automaticamente quando Home Assistant invia una notifica con <code style="color:#64D2FF">data.channel</code>.</div>
    <div id="comp-channels-list"></div>

    <h3>🔄 Updates</h3>
    <div id="comp-update-info"></div>

    <h3>⚙ Actions</h3>
    <div class="comp-row"><button class="comp-btn secondary" id="comp-refresh">🔄 Reload</button></div>
    <div class="comp-row"><button class="comp-btn secondary" id="comp-fullscreen">⛶ Fullscreen</button></div>
    <div class="comp-row"><button class="comp-btn warning" id="comp-reboot">🔄 Reboot System</button></div>
    <div class="comp-row"><button class="comp-btn danger" id="comp-shutdown">⏻ Shutdown</button></div>
    <div class="comp-row"><button class="comp-btn danger" id="comp-logout">Logout</button></div>
    <div class="comp-row"><button class="comp-btn danger" id="comp-quit">✕ Exit App</button></div>
  `;
  document.body.appendChild(panel);

  let open = false;
  function togglePanel() {
    open = !open;
    panel.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    barPinned = open;
    if (open) { topbar.classList.remove('hidden'); clearTimeout(barHideTimer); loadPanelData(); }
    else { scheduleBarHide(); }
  }
  document.getElementById('ha-comp-topbar-btn').addEventListener('click', function(e) { e.stopImmediatePropagation(); togglePanel(); }, true);
  backdrop.addEventListener('click', togglePanel);
  document.getElementById('comp-close').addEventListener('click', togglePanel);
  // Swipe from right edge to open panel
  var swipeStartX = 0, swipeActive = false;
  document.addEventListener('touchstart', function(e) {
    if (e.touches[0].clientX > window.innerWidth - 20) { swipeStartX = e.touches[0].clientX; swipeActive = true; }
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (!swipeActive) return;
    var dx = swipeStartX - e.touches[0].clientX;
    if (dx > 50 && !open) { togglePanel(); swipeActive = false; }
  }, { passive: true });
  document.addEventListener('touchend', function() { swipeActive = false; }, { passive: true });

  function ipc(name, data) { return window.haCompanion[name](data); }

  // ── Load panel data ──
  function loadPanelData() {
    ipc('getNotificationHistory').then(renderNotifHistory);
    loadAndRenderChannels();
    loadHardwareInfo();
    loadNetworkInfo();
    loadAudioOutputs();
    loadSchedule();
    loadUpdateInfo();
    ipc('getGovernor').then(function(g) { document.getElementById('comp-governor').value = g; });
  }

  // ── Display Controls ──
  document.getElementById('comp-display-on').addEventListener('click', function() { ipc('displayOn'); });
  document.getElementById('comp-display-off').addEventListener('click', function() { ipc('displayOff'); });

  // ── Schedule ──
  var schedEnabled = document.getElementById('comp-schedule-enabled');
  var schedTimes = document.getElementById('comp-schedule-times');
  var schedOff = document.getElementById('comp-schedule-off');
  var schedOn = document.getElementById('comp-schedule-on');

  function loadSchedule() {
    ipc('getSchedule').then(function(s) {
      if (!s) return;
      schedEnabled.classList.toggle('on', s.enabled);
      schedTimes.style.display = s.enabled ? 'block' : 'none';
      if (s.offTime) schedOff.value = s.offTime;
      if (s.onTime) schedOn.value = s.onTime;
    });
  }

  schedEnabled.addEventListener('click', function() {
    schedEnabled.classList.toggle('on');
    var enabled = schedEnabled.classList.contains('on');
    schedTimes.style.display = enabled ? 'block' : 'none';
    ipc('setSchedule', { enabled: enabled, offTime: schedOff.value, onTime: schedOn.value });
  });

  function saveScheduleFromInputs() {
    ipc('setSchedule', { enabled: schedEnabled.classList.contains('on'), offTime: schedOff.value, onTime: schedOn.value });
  }
  schedOff.addEventListener('change', saveScheduleFromInputs);
  schedOn.addEventListener('change', saveScheduleFromInputs);

  // ── Audio ──
  var volSlider = document.getElementById('comp-volume'), volVal = document.getElementById('comp-volume-val'), muteBtn = document.getElementById('comp-mute');
  volSlider.addEventListener('input', async () => { volVal.textContent = volSlider.value + '%'; await ipc('setVolume', parseInt(volSlider.value)); });
  muteBtn.addEventListener('click', async () => { const m = muteBtn.textContent === 'Off'; muteBtn.textContent = m ? 'On' : 'Off'; muteBtn.style.background = m ? '#FF3B30' : '#3A3A3C'; await ipc('setMute', m); });

  var audioOutputSel = document.getElementById('comp-audio-output');
  function loadAudioOutputs() {
    ipc('getAudioOutputs').then(function(outputs) {
      audioOutputSel.innerHTML = '';
      if (!outputs || !outputs.length) {
        audioOutputSel.innerHTML = '<option>Default</option>';
        return;
      }
      outputs.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.name;
        opt.textContent = o.description + (o.isDefault ? ' ✓' : '');
        if (o.isDefault) opt.selected = true;
        audioOutputSel.appendChild(opt);
      });
    });
  }
  audioOutputSel.addEventListener('change', function() { ipc('setAudioOutput', audioOutputSel.value); });

  // ── Network Info ──
  function loadNetworkInfo() {
    ipc('getNetworkInfo').then(function(n) {
      var el = document.getElementById('comp-network-info');
      if (!n) { el.innerHTML = '<div style="color:#636366;font-size:12px">Non disponibile</div>'; return; }
      var html = '';
      if (n.ssid) {
        html += '<div class="comp-info-item"><div class="comp-info-label">WiFi</div><div class="comp-info-value">' + n.ssid + '</div></div>';
        html += '<div class="comp-info-item"><div class="comp-info-label">Segnale</div><div class="comp-info-value">' + (n.signalPercent !== null ? n.signalPercent + '% (' + n.signalDbm + ' dBm)' : '--') + '</div></div>';
      }
      html += '<div class="comp-info-item"><div class="comp-info-label">IP</div><div class="comp-info-value">' + (n.ipAddress || '--') + '</div></div>';
      html += '<div class="comp-info-item"><div class="comp-info-label">Gateway</div><div class="comp-info-value">' + (n.gateway || '--') + '</div></div>';
      html += '<div class="comp-info-item"><div class="comp-info-label">Interfaccia</div><div class="comp-info-value">' + (n.interface || '--') + '</div></div>';
      html += '<div class="comp-info-item"><div class="comp-info-label">DNS</div><div class="comp-info-value">' + (n.dns || '--') + '</div></div>';
      el.innerHTML = html;
    });
  }

  // ── Bluetooth ──
  var btBtn = document.getElementById('comp-bt-toggle'), btList = document.getElementById('comp-bt-list');
  btBtn.addEventListener('click', async () => {
    btBtn.textContent = 'Scanning...'; btBtn.disabled = true;
    const devices = await ipc('bluetoothScan');
    btBtn.textContent = 'Scan'; btBtn.disabled = false;
    btList.innerHTML = '';
    if (devices && devices.length) {
      devices.forEach(d => {
        const item = document.createElement('div'); item.className = 'comp-bt-item';
        item.innerHTML = '<span>' + d.name + '</span><button class="comp-btn secondary comp-bt-connect" data-mac="' + d.mac + '">Connect</button>';
        btList.appendChild(item);
      });
      btList.querySelectorAll('.comp-bt-connect').forEach(btn => btn.addEventListener('click', async () => { btn.textContent = '...'; await ipc('bluetoothConnect', btn.dataset.mac); btn.textContent = '✓'; }));
    } else btList.innerHTML = '<div style="color:#8E8E93;font-size:12px">No devices found</div>';
  });

  // ── Hardware Info ──
  function loadHardwareInfo() {
    ipc('getHardwareInfo').then(function(hw) {
      var el = document.getElementById('comp-hw-info');
      if (!hw) { el.innerHTML = ''; return; }
      var html = '';
      html += '<div class="comp-info-item" style="grid-column:span 2"><div class="comp-info-label">Board</div><div class="comp-info-value" style="font-size:11px">' + hw.boardModel + '</div></div>';
      if (hw.cpuTempC) {
        var tempColor = parseFloat(hw.cpuTempC) > 70 ? '#FF3B30' : parseFloat(hw.cpuTempC) > 55 ? '#FF9500' : '#30D158';
        html += '<div class="comp-info-item"><div class="comp-info-label">CPU Temp</div><div class="comp-info-value" style="color:' + tempColor + '">' + hw.cpuTempC + '°C</div>';
        html += '<div class="comp-info-bar"><div class="comp-info-bar-fill" style="width:' + Math.min(100, parseFloat(hw.cpuTempC)) + '%;background:' + tempColor + '"></div></div></div>';
      }
      if (hw.cpuFreqMhz) html += '<div class="comp-info-item"><div class="comp-info-label">CPU Freq</div><div class="comp-info-value">' + hw.cpuFreqMhz + ' MHz</div></div>';
      if (hw.ramTotalMb) {
        var ramColor = hw.ramPercent > 80 ? '#FF3B30' : hw.ramPercent > 60 ? '#FF9500' : '#30D158';
        html += '<div class="comp-info-item"><div class="comp-info-label">RAM</div><div class="comp-info-value">' + hw.ramUsedMb + '/' + hw.ramTotalMb + ' MB (' + hw.ramPercent + '%)</div>';
        html += '<div class="comp-info-bar"><div class="comp-info-bar-fill" style="width:' + hw.ramPercent + '%;background:' + ramColor + '"></div></div></div>';
      }
      if (hw.diskTotal) {
        var diskColor = hw.diskPercent > 85 ? '#FF3B30' : hw.diskPercent > 70 ? '#FF9500' : '#30D158';
        html += '<div class="comp-info-item"><div class="comp-info-label">Disk</div><div class="comp-info-value">' + hw.diskUsed + '/' + hw.diskTotal + ' (' + hw.diskPercent + '%)</div>';
        html += '<div class="comp-info-bar"><div class="comp-info-bar-fill" style="width:' + hw.diskPercent + '%;background:' + diskColor + '"></div></div></div>';
      }
      html += '<div class="comp-info-item"><div class="comp-info-label">OS</div><div class="comp-info-value" style="font-size:11px">' + (hw.os || '--') + '</div></div>';
      html += '<div class="comp-info-item"><div class="comp-info-label">Kernel</div><div class="comp-info-value">' + (hw.kernel || '--') + '</div></div>';
      if (hw.uptime) html += '<div class="comp-info-item" style="grid-column:span 2"><div class="comp-info-label">Uptime</div><div class="comp-info-value">' + hw.uptime + '</div></div>';
      if (hw.serial) html += '<div class="comp-info-item" style="grid-column:span 2"><div class="comp-info-label">Serial</div><div class="comp-info-value" style="font-size:10px;color:#636366">' + hw.serial + '</div></div>';
      html += '<div class="comp-info-item"><div class="comp-info-label">Arch</div><div class="comp-info-value">' + (hw.arch || '--') + '</div></div>';
      html += '<div class="comp-info-item"><div class="comp-info-label">App</div><div class="comp-info-value">v' + (hw.appVersion || '?') + ' (Electron ' + (hw.electronVersion || '?') + ')</div></div>';
      el.innerHTML = html;
    });
  }

  // ── CPU Governor ──
  document.getElementById('comp-governor').addEventListener('change', function() {
    ipc('setGovernor', document.getElementById('comp-governor').value);
  });

  // ── Brightness ──
  var brightSlider = document.getElementById('comp-brightness'), brightVal = document.getElementById('comp-brightness-val');
  brightSlider.addEventListener('input', async () => { brightVal.textContent = brightSlider.value + '%'; await ipc('setBrightness', parseInt(brightSlider.value)); });

  // ── System Power ──
  document.getElementById('comp-reboot').addEventListener('click', function() {
    if (confirm('Riavviare il sistema?')) ipc('rebootSystem');
  });
  document.getElementById('comp-shutdown').addEventListener('click', function() {
    if (confirm('Spegnere il sistema?')) ipc('shutdownSystem');
  });

  // ── Updates ──
  function loadUpdateInfo() {
    ipc('checkUpdates').then(function(u) {
      var el = document.getElementById('comp-update-info');
      if (!u || u.error) { el.innerHTML = '<div style="color:#636366;font-size:12px">Impossibile verificare aggiornamenti</div>'; return; }
      var html = '<div class="comp-update-row">';
      html += '<span class="comp-update-badge current">v' + u.current + '</span>';
      html += '<div style="flex:1">';
      if (u.latestStable) {
        html += '<div style="font-size:12px">Stable: <a href="' + u.latestStable.url + '" target="_blank" style="color:#64D2FF">' + u.latestStable.tag + '</a></div>';
      }
      if (u.latestDev) {
        html += '<div style="font-size:11px;color:#8E8E93">Dev: <a href="' + u.latestDev.url + '" target="_blank" style="color:#FF9500">' + u.latestDev.tag + '</a></div>';
      }
      html += '</div></div>';
      // Show if update available
      if (u.latestStable && u.latestStable.tag !== 'v' + u.current && u.latestStable.tag > 'v' + u.current) {
        html += '<div style="color:#30D158;font-size:12px;margin-top:4px">🟢 Nuova versione disponibile!</div>';
      }
      el.innerHTML = html;
    });
  }

  // ── Actions ──
  document.getElementById('comp-refresh').addEventListener('click', () => location.reload());
  document.getElementById('comp-fullscreen').addEventListener('click', () => ipc('toggleFullscreen'));
  document.getElementById('comp-logout').addEventListener('click', () => ipc('logout'));
  document.getElementById('comp-quit').addEventListener('click', () => ipc('quit'));

  // ── Notification history ──
  var notifList = document.getElementById('comp-notif-list');
  var notifCount = document.getElementById('comp-notif-count');
  function renderNotifHistory(history) {
    if (!history || !history.length) {
      notifCount.textContent = 'Nessuna notifica';
      notifList.innerHTML = '';
      return;
    }
    notifCount.textContent = history.length + ' notifiche';
    notifList.innerHTML = history.map(function(n) {
      var d = new Date(n.time);
      var ts = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
      return '<div style="padding:8px 0;border-bottom:1px solid #2C2C2E"><div style="font-size:13px;font-weight:600">' + n.title + ' <span style="color:#636366;font-size:11px">' + ts + '</span></div><div style="color:#ABABAB;font-size:12px;margin-top:2px">' + n.message + '</div></div>';
    }).join('');
  }
  document.getElementById('comp-notif-clear').addEventListener('click', function() {
    notifList.innerHTML = '';
    notifCount.textContent = 'Nessuna notifica';
  });

  // ── Notification settings ──
  var notifEnabledBtn = document.getElementById('comp-notif-enabled');
  var notifSoundBtn = document.getElementById('comp-notif-sound');
  var notifDndBtn = document.getElementById('comp-notif-dnd');
  var notifDuration = document.getElementById('comp-notif-duration');
  var notifMelody = document.getElementById('comp-notif-melody');

  var notifSettings = JSON.parse(localStorage.getItem('ha_notif_settings') || '{}');
  if (notifSettings.enabled === false) notifEnabledBtn.classList.remove('on'); else notifEnabledBtn.classList.add('on');
  if (notifSettings.sound === false) notifSoundBtn.classList.remove('on'); else notifSoundBtn.classList.add('on');
  if (notifSettings.dnd) notifDndBtn.classList.add('on'); else notifDndBtn.classList.remove('on');
  if (notifSettings.duration) notifDuration.value = notifSettings.duration;
  if (notifSettings.melody) notifMelody.value = notifSettings.melody;

  function saveNotifSettings() { localStorage.setItem('ha_notif_settings', JSON.stringify(notifSettings)); }

  notifEnabledBtn.addEventListener('click', function() { notifSettings.enabled = !notifEnabledBtn.classList.contains('on'); notifEnabledBtn.classList.toggle('on'); saveNotifSettings(); });
  notifSoundBtn.addEventListener('click', function() { notifSettings.sound = !notifSoundBtn.classList.contains('on'); notifSoundBtn.classList.toggle('on'); saveNotifSettings(); if (notifSettings.sound) ipc('playNotificationSound', notifMelody.value); });
  notifDndBtn.addEventListener('click', function() { notifSettings.dnd = !notifDndBtn.classList.contains('on'); notifDndBtn.classList.toggle('on'); saveNotifSettings(); });
  notifDuration.addEventListener('change', function() { notifSettings.duration = parseInt(notifDuration.value); saveNotifSettings(); });
  notifMelody.addEventListener('change', function() { notifSettings.melody = notifMelody.value; saveNotifSettings(); ipc('playNotificationSound', notifMelody.value); });

  // Custom sounds
  var customSection = document.getElementById('comp-custom-sounds');
  var customSelect = document.getElementById('comp-notif-custom');
  var customOpt = document.createElement('option'); customOpt.value = '__custom__'; customOpt.textContent = '🎵 Personalizzata'; notifMelody.appendChild(customOpt);
  if (notifSettings.melody && notifSettings.melody.startsWith('custom:')) { notifMelody.value = '__custom__'; customSection.style.display = 'block'; }
  notifMelody.addEventListener('change', function() {
    if (notifMelody.value === '__custom__') {
      customSection.style.display = 'block';
      ipc('listCustomSounds').then(function(sounds) {
        customSelect.innerHTML = '<option value="">-- seleziona --</option>';
        if (sounds && sounds.length) { sounds.forEach(function(s) { var o = document.createElement('option'); o.value = 'custom:' + s.file; o.textContent = s.name; customSelect.appendChild(o); }); if (notifSettings.melody) customSelect.value = notifSettings.melody; }
        else customSelect.innerHTML = '<option value="">Nessun file trovato</option>';
      });
    } else { customSection.style.display = 'none'; notifSettings.customSound = null; }
  });
  customSelect.addEventListener('change', function() { if (customSelect.value) { notifSettings.melody = customSelect.value; saveNotifSettings(); ipc('playNotificationSound', customSelect.value); } });

  // ── Channels ──
  var channelsList = document.getElementById('comp-channels-list');
  function renderChannels(chs) {
    if (!chs || !Object.keys(chs).length) { channelsList.innerHTML = '<div style="color:#636366;font-size:12px;padding:8px 0">Nessun canale ancora.</div>'; return; }
    var html = '';
    for (var id in chs) {
      var ch = chs[id];
      html += '<div class="comp-notif-row" style="flex-direction:column;align-items:stretch;padding:10px 0;gap:6px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between">';
      html += '<div><span style="font-weight:600;font-size:13px">' + (ch.name || id) + '</span><span style="color:#636366;font-size:11px;margin-left:6px">' + id + '</span></div>';
      html += '<div style="display:flex;gap:8px;align-items:center">';
      html += '<button class="comp-toggle' + (ch.enabled !== false ? ' on' : '') + '" data-channel="' + id + '" data-field="enabled"></button>';
      html += '<button class="comp-btn danger" style="padding:4px 10px;font-size:11px" data-delete-channel="' + id + '">✕</button>';
      html += '</div></div>';
      html += '<div style="display:flex;gap:8px;align-items:center">';
      html += '<select class="comp-select" data-channel="' + id + '" data-field="sound" style="flex:1">';
      ['default','success','warning','error'].forEach(function(s) { html += '<option value="' + s + '"' + (ch.sound === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>'; });
      html += '</select>';
      html += '<select class="comp-select" data-channel="' + id + '" data-field="priority" style="flex:1">';
      ['urgent','high','default','low','min'].forEach(function(p) { html += '<option value="' + p + '"' + (ch.priority === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; });
      html += '</select></div></div>';
    }
    channelsList.innerHTML = html;
    channelsList.querySelectorAll('[data-field="enabled"]').forEach(function(btn) { btn.addEventListener('click', function() { btn.classList.toggle('on'); ipc('updateChannel', btn.dataset.channel, { enabled: btn.classList.contains('on') }); }); });
    channelsList.querySelectorAll('[data-field="sound"]').forEach(function(sel) { sel.addEventListener('change', function() { ipc('updateChannel', sel.dataset.channel, { sound: sel.value }); ipc('playNotificationSound', sel.value); }); });
    channelsList.querySelectorAll('[data-field="priority"]').forEach(function(sel) { sel.addEventListener('change', function() { ipc('updateChannel', sel.dataset.channel, { priority: sel.value }); }); });
    channelsList.querySelectorAll('[data-delete-channel"]').forEach(function(btn) { btn.addEventListener('click', function() { ipc('deleteChannel', btn.dataset.deleteChannel).then(function() { loadAndRenderChannels(); }); }); });
  }
  function loadAndRenderChannels() { ipc('getChannels').then(renderChannels); }
  window.__haChannels = { refresh: loadAndRenderChannels };

  // Clock element reference (panel detail clock with seconds)
  var clockEl = document.getElementById('comp-clock-bar');
  function updatePanelClock() {
    if (!clockEl) return;
    const now = new Date();
    const hh = now.getHours().toString().padStart(2,'0');
    const mm = now.getMinutes().toString().padStart(2,'0');
    const ss = now.getSeconds().toString().padStart(2,'0');
    var ct = clockEl.querySelector('.clock-time');
    if (ct) ct.textContent = hh + ':' + mm + ':' + ss;
    var cd = clockEl.querySelector('.clock-date');
    if (cd) cd.textContent = dayNames[now.getDay()] + ' ' + now.getDate() + ' ' + monthNames[now.getMonth()];
  }
  setInterval(updatePanelClock, 1000);
  updatePanelClock();

  // Clock temp in panel
  function updateClockTemp() {
    if (!clockEl) return;
    ipc('getHardwareInfo').then(function(hw) {
      if (hw && hw.cpuTempC) {
        var ct = clockEl.querySelector('.clock-temp');
        if (!ct) { ct = document.createElement('span'); ct.className = 'clock-temp'; ct.style.cssText = 'font-size:12px;color:#FF9500'; clockEl.appendChild(ct); }
        ct.textContent = hw.cpuTempC + '°C';
      }
    });
  }
  setInterval(updateClockTemp, 30000);
  setTimeout(updateClockTemp, 2000);

  // ── Init ──
  ipc('getSystemInfo').then(info => {
    if (!info) return;
    if (info.volume !== undefined) { volSlider.value = info.volume; volVal.textContent = info.volume + '%'; }
    if (info.brightness !== undefined) { brightSlider.value = info.brightness; brightVal.textContent = info.brightness + '%'; }
    if (info.deviceName) { document.getElementById('comp-device-name').textContent = info.deviceName; var td = document.getElementById('topbar-device'); if (td) td.textContent = info.deviceName; }
    if (info.version) document.getElementById('comp-version').textContent = info.version;
    if (info.sensors) document.getElementById('comp-sensor-info').textContent = 'Sensors: ' + info.sensors;
    if (!info.hasBacklight) { var br = document.getElementById('comp-brightness-row'); if(br) br.style.display='none'; }
  });
})();
