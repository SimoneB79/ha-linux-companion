/**
 * HA Auth Module — OAuth2 token management with persistent sessions
 * 
 * Uses home-assistant-js-websocket for auth, adds:
 * - File-based token persistence (config.json)
 * - Proactive token refresh (5 min before expiry)
 * - Robust error handling: NEVER wipes config on refresh failure
 * - Automatic refresh timer
 */

const {
  getAuth,
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH,
} = require('home-assistant-js-websocket');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'ha-linux-companion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Refresh token 5 minutes before it expires
const REFRESH_SKEW_MS = 5 * 60 * 1000;

let authInstance = null;
let refreshTimer = null;
let logFn = console.log;

function setLogger(fn) {
  logFn = fn;
}

function log(msg) {
  logFn(msg);
}

// ── Config persistence ──

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch { return {}; }
  }
  return {};
}

function saveConfig(data) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── Token storage callbacks for home-assistant-js-websocket ──
// These are called by getAuth() to persist/load tokens

function saveTokens(tokens) {
  if (!tokens) return;
  log('[AUTH] Saving tokens via callback');
  const config = loadConfig();
  
  config.hassTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires: tokens.expires,
    clientId: tokens.clientId,
    hassUrl: tokens.hassUrl,
    token_type: tokens.token_type || 'Bearer',
  };
  
  // Also update the top-level token for backward compat
  if (tokens.access_token) {
    config.token = tokens.access_token;
  }
  // Save URL for session restore
  if (tokens.hassUrl) {
    config.url = tokens.hassUrl;
  }
  // Calculate expiry time
  if (tokens.expires) {
    config.tokenExpires = tokens.expires;
  }
  
  saveConfig(config);
}

function loadSavedTokens() {
  const config = loadConfig();
  if (config.hassTokens && (config.hassTokens.access_token || config.hassTokens.refresh_token)) {
    return config.hassTokens;
  }
  // Migrate from old format
  if (config.refreshToken && config.token) {
    return {
      access_token: config.token,
      refresh_token: config.refreshToken,
      expires: config.tokenExpires || 0,
      hassUrl: config.url,
    };
  }
  return undefined;
}

// ── Token refresh schedule ──

function scheduleRefresh(expiresAt) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!expiresAt) return;
  
  const refreshAt = expiresAt - REFRESH_SKEW_MS;
  const delay = refreshAt - Date.now();
  
  if (delay <= 0) {
    // Already expired or about to — refresh now
    log('[AUTH] Token expired or near expiry, refreshing immediately');
    doRefresh();
    return;
  }
  
  log(`[AUTH] Token refresh scheduled in ${Math.round(delay / 1000)}s`);
  refreshTimer = setTimeout(doRefresh, delay);
}

async function doRefresh() {
  if (!authInstance || typeof authInstance.refreshAccessToken !== 'function') {
    log('[AUTH] No auth instance to refresh');
    return;
  }
  
  try {
    log('[AUTH] Refreshing access token...');
    await authInstance.refreshAccessToken();
    
    // Save updated tokens
    const newTokens = {
      access_token: authInstance.accessToken,
      refresh_token: authInstance.refreshToken,
      expires: authInstance.expiration,
      hassUrl: authInstance.data?.hassUrl,
    };
    saveTokens(newTokens);
    
    // Schedule next refresh
    if (authInstance.expiration) {
      scheduleRefresh(authInstance.expiration);
    }
    
    log('[AUTH] Token refreshed successfully');
  } catch (err) {
    // CRITICAL: do NOT wipe config on refresh failure
    // The refresh token is still valid, we'll retry later
    log('[AUTH] Token refresh failed: ' + err.message);
    
    // Retry in 30 seconds
    refreshTimer = setTimeout(doRefresh, 30000);
  }
}

// ── Get current access token ──

function getAccessToken() {
  if (authInstance && authInstance.accessToken) {
    return authInstance.accessToken;
  }
  // Fallback to saved config
  const config = loadConfig();
  return config.token || null;
}

// ── Initialize auth from saved session ──

async function initFromSavedSession() {
  const config = loadConfig();
  
  if (!config.url) {
    log('[AUTH] No saved URL');
    return null;
  }
  
  const savedTokens = loadSavedTokens();
  if (!savedTokens || !savedTokens.access_token) {
    log('[AUTH] No saved tokens');
    return null;
  }
  
  // Check if tokens belong to the correct HA instance
  if (savedTokens.hassUrl && savedTokens.hassUrl !== config.url.replace(/\/+$/, '')) {
    log('[AUTH] Token URL mismatch, clearing');
    return null;
  }
  
  // Try getAuth first (handles refresh automatically)
  try {
    log('[AUTH] Restoring session from saved tokens...');
    authInstance = await getAuth({
      hassUrl: config.url,
      saveTokens,
      loadTokens: () => Promise.resolve(savedTokens),
    });
    
    // Save updated tokens
    if (authInstance.accessToken) {
      const updatedTokens = {
        access_token: authInstance.accessToken,
        refresh_token: authInstance.refreshToken,
        expires: authInstance.expiration,
        hassUrl: config.url,
      };
      saveTokens(updatedTokens);
    }
    
    if (authInstance.expiration) {
      scheduleRefresh(authInstance.expiration);
    }
    
    log('[AUTH] Session restored via getAuth');
    return authInstance;
  } catch (err) {
    // getAuth fails in Electron main process (no window.location)
    // Fallback: create a minimal auth object and try refresh if token expired
    log('[AUTH] getAuth unavailable (' + err.message + '), using direct token restore');
  }
  
  // Direct token restore — works in Electron main process
  const baseUrl = config.url.replace(/\/+$/, '');
  const clientId = savedTokens.clientId || `${baseUrl}/`;
  let accessToken = savedTokens.access_token;
  let refreshToken = savedTokens.refresh_token;
  let expires = savedTokens.expires || 0;
  
  // Check if access token is expired and try refresh
  if (expires && Date.now() > expires && refreshToken) {
    log('[AUTH] Access token expired, refreshing...');
    try {
      const refreshRes = await haRequest(baseUrl, 'POST', '/auth/token',
        `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(clientId)}`,
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      
      if (refreshRes.status === 200 && refreshRes.data?.access_token) {
        accessToken = refreshRes.data.access_token;
        if (refreshRes.data.refresh_token) refreshToken = refreshRes.data.refresh_token;
        expires = refreshRes.data.expires_in ? Date.now() + refreshRes.data.expires_in * 1000 : 0;
        
        // Save refreshed tokens
        const refreshedTokens = {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires: expires,
          hassUrl: baseUrl,
          clientId: clientId,
        };
        saveTokens(refreshedTokens);
        log('[AUTH] Token refreshed successfully');
      } else {
        log('[AUTH] Token refresh failed: ' + refreshRes.status);
        // DON'T clear tokens — the access token might still work briefly
        // or we'll retry later
      }
    } catch (err) {
      log('[AUTH] Refresh error: ' + err.message + ' — will retry');
    }
  }
  
  // Create fallback auth object
  authInstance = {
    accessToken: accessToken,
    refreshToken: refreshToken,
    expiration: expires,
    refreshAccessToken: async () => {
      if (!refreshToken) throw new Error('No refresh token');
      const res = await haRequest(baseUrl, 'POST', '/auth/token',
        `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(clientId)}`,
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      if (res.status === 200 && res.data?.access_token) {
        accessToken = res.data.access_token;
        if (res.data.refresh_token) refreshToken = res.data.refresh_token;
        expires = res.data.expires_in ? Date.now() + res.data.expires_in * 1000 : 0;
        authInstance.accessToken = accessToken;
        authInstance.refreshToken = refreshToken;
        authInstance.expiration = expires;
        saveTokens({ access_token: accessToken, refresh_token: refreshToken, expires, hassUrl: baseUrl, clientId });
        log('[AUTH] Token refreshed via fallback');
      } else {
        throw new Error('Refresh failed: ' + res.status);
      }
    },
  };
  
  // Schedule proactive refresh
  if (expires) {
    scheduleRefresh(expires);
  }
  
  log('[AUTH] Session restored via direct token');
  return authInstance;
}

// ── Login with credentials (username/password) ──
// This still uses the login_flow API directly because the OAuth redirect
// flow from home-assistant-js-websocket requires a browser environment.
// After login, we store the tokens in the format getAuth() expects.

async function loginWithCredentials(hassUrl, username, password) {
  // We'll do the login_flow manually, then store the resulting tokens
  // in a format that home-assistant-js-websocket can restore
  
  const baseUrl = hassUrl.replace(/\/+$/, '');
  const clientId = `${baseUrl}/`;
  
  // Step 1: Initiate auth flow
  const initRes = await haRequest(baseUrl, 'POST', '/auth/login_flow', {
    client_id: clientId,
    handler: ['homeassistant', null],
    redirect_uri: `${baseUrl}/?auth_callback=1`,
  });
  
  if (initRes.status !== 200 || !initRes.data?.flow_id) {
    throw new Error(`Auth init failed: ${initRes.status}`);
  }
  
  const flowId = initRes.data.flow_id;
  
  // Step 2: Submit credentials
  const passRes = await haRequest(baseUrl, 'POST', `/auth/login_flow/${flowId}`, {
    client_id: clientId,
    username: username,
    password: password,
  });
  
  // Check for MFA requirement
  if (passRes.data?.step?.id === 'mfa' || 
      (passRes.data?.type === 'form' && passRes.data?.step?.id !== undefined)) {
    return { mfa_required: true, flow_id: flowId, hass_url: baseUrl };
  }
  
  if (passRes.data?.type !== 'create_entry') {
    const errMsg = passRes.data?.errors?.base || passRes.data?.errors?.password || 'Invalid credentials';
    throw new Error(errMsg);
  }
  
  // Step 3: Exchange code for tokens
  const code = passRes.data.result;
  const tokenRes = await haRequest(baseUrl, 'POST', '/auth/token',
    `grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(clientId)}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  
  if (tokenRes.status !== 200 || !tokenRes.data?.access_token) {
    throw new Error('Token exchange failed');
  }
  
  // Step 4: Store tokens in getAuth-compatible format
  const tokens = {
    access_token: tokenRes.data.access_token,
    refresh_token: tokenRes.data.refresh_token,
    expires: tokenRes.data.expires_in ? Date.now() + tokenRes.data.expires_in * 1000 : 0,
    hassUrl: baseUrl,
    clientId: clientId,
    token_type: 'Bearer',
  };
  
  // Create auth instance from these tokens
  try {
    authInstance = await getAuth({
      hassUrl: baseUrl,
      saveTokens,
      loadTokens: () => Promise.resolve(tokens),
    });
  } catch (err) {
    // If getAuth fails with our tokens, create a minimal auth-like object
    log('[AUTH] getAuth failed after login, using fallback: ' + err.message);
    authInstance = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiration: tokens.expires,
      refreshAccessToken: async () => {
        const res = await haRequest(baseUrl, 'POST', '/auth/token',
          `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokens.refresh_token)}&client_id=${encodeURIComponent(clientId)}`,
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );
        if (res.status === 200 && res.data?.access_token) {
          authInstance.accessToken = res.data.access_token;
          if (res.data.refresh_token) {
            authInstance.refreshToken = res.data.refresh_token;
          }
          authInstance.expiration = res.data.expires_in ? Date.now() + res.data.expires_in * 1000 : 0;
          tokens.access_token = authInstance.accessToken;
          tokens.refresh_token = authInstance.refreshToken;
          tokens.expires = authInstance.expiration;
          saveTokens(tokens);
          log('[AUTH] Token refreshed via fallback');
        } else {
          throw new Error('Refresh failed: ' + res.status);
        }
      },
    };
  }
  
  // Save everything
  saveTokens(tokens);
  scheduleRefresh(tokens.expires);
  
  return { success: true, access_token: tokens.access_token };
}

// ── Submit MFA code ──

async function submitMfa(hassUrl, flowId, mfaCode) {
  const baseUrl = hassUrl.replace(/\/+$/, '');
  const clientId = `${baseUrl}/`;
  
  const result = await haRequest(baseUrl, 'POST', `/auth/login_flow/${flowId}`, {
    client_id: clientId,
    user_code: mfaCode,
  });
  
  if (result.data?.type !== 'create_entry') {
    const errMsg = result.data?.errors?.code || 'Invalid code';
    throw new Error(errMsg);
  }
  
  // Same token exchange as login
  const code = result.data.result;
  const tokenRes = await haRequest(baseUrl, 'POST', '/auth/token',
    `grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(clientId)}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  
  if (tokenRes.status !== 200 || !tokenRes.data?.access_token) {
    throw new Error('Token exchange failed');
  }
  
  const tokens = {
    access_token: tokenRes.data.access_token,
    refresh_token: tokenRes.data.refresh_token,
    expires: tokenRes.data.expires_in ? Date.now() + tokenRes.data.expires_in * 1000 : 0,
    hassUrl: baseUrl,
    clientId: clientId,
    token_type: 'Bearer',
  };
  
  try {
    authInstance = await getAuth({
      hassUrl: baseUrl,
      saveTokens,
      loadTokens: () => Promise.resolve(tokens),
    });
  } catch (err) {
    log('[AUTH] getAuth failed after MFA, using fallback: ' + err.message);
    authInstance = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiration: tokens.expires,
      refreshAccessToken: async () => {
        const res = await haRequest(baseUrl, 'POST', '/auth/token',
          `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokens.refresh_token)}&client_id=${encodeURIComponent(clientId)}`,
          { 'Content-Type': 'application/x-www-form-urlencoded' }
        );
        if (res.status === 200 && res.data?.access_token) {
          authInstance.accessToken = res.data.access_token;
          authInstance.refreshToken = res.data.refresh_token || authInstance.refreshToken;
          authInstance.expiration = res.data.expires_in ? Date.now() + res.data.expires_in * 1000 : 0;
          tokens.access_token = authInstance.accessToken;
          tokens.refresh_token = authInstance.refreshToken;
          tokens.expires = authInstance.expiration;
          saveTokens(tokens);
        } else {
          throw new Error('Refresh failed: ' + res.status);
        }
      },
    };
  }
  
  saveTokens(tokens);
  scheduleRefresh(tokens.expires);
  
  return { success: true, access_token: tokens.access_token };
}

// ── Login with long-lived token ──

async function loginWithToken(hassUrl, token) {
  const baseUrl = hassUrl.replace(/\/+$/, '');
  
  // Verify token works
  const test = await haRequest(baseUrl, 'GET', '/api/', null, {
    'Authorization': `Bearer ${token}`
  });
  
  if (test.status !== 200) {
    throw new Error(`Invalid token: HTTP ${test.status}`);
  }
  
  // Long-lived tokens don't expire, but we wrap in the same structure
  const tokens = {
    access_token: token,
    refresh_token: null, // No refresh for long-lived
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, // 10 years
    hassUrl: baseUrl,
    clientId: null,
    token_type: 'Bearer',
    long_lived: true,
  };
  
  authInstance = {
    accessToken: token,
    refreshToken: null,
    expiration: tokens.expires,
    refreshAccessToken: async () => { /* noop for long-lived */ },
  };
  
  saveTokens(tokens);
  
  return { success: true, access_token: token };
}

// ── Logout ──

function logout() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  authInstance = null;
  
  // Clear tokens but keep URL for convenience
  const config = loadConfig();
  delete config.hassTokens;
  delete config.token;
  delete config.refreshToken;
  delete config.tokenExpires;
  saveConfig(config);
}

// ── HTTP helper ──

function haRequest(baseUrl, method, reqPath, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(baseUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? require('https') : require('http');
    
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: reqPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      rejectUnauthorized: false,
    };
    
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

// ── Stop refresh timer (for app quit) ──

function cleanup() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

module.exports = {
  setLogger,
  loadConfig,
  saveConfig,
  initFromSavedSession,
  loginWithCredentials,
  submitMfa,
  loginWithToken,
  getAccessToken,
  getAuthInstance: () => authInstance,
  logout,
  cleanup,
  haRequest,
};
