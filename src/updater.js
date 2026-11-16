// ── Self-updater ─────────────────────────────────────────────────────────────
// Checks GitHub releases and applies an update from the tag source tarball.
// Written dependency-free (core modules only) so it can be unit-tested with
// plain node, outside Electron: every entry point takes explicit arguments.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const REPO = 'SimoneB79/ha-linux-companion';
const UA = 'ha-linux-companion-updater';

function httpsGet(url, opts, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    const req = https.get(url, Object.assign({ headers: { 'User-Agent': UA }, timeout: 15000 }, opts || {}), (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpsGet(new URL(res.headers.location, url).toString(), opts, redirects + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

// Latest version = highest semver among git tags (NOT /releases: several
// versions were shipped as tag-only, e.g. v4.2.x–v4.3.x, and /releases would
// report a stale v4.1.4 as "latest").
async function fetchLatestStable() {
  const res = await httpsGet('https://api.github.com/repos/' + REPO + '/tags?per_page=30');
  let body = '';
  res.setEncoding('utf8');
  for await (const chunk of res) body += chunk;
  const tags = JSON.parse(body);
  if (!Array.isArray(tags) || !tags.length) throw new Error('unexpected GitHub API response');
  const parsed = tags.map((t) => t.name).filter((n) => /^v?\d+\.\d+\.\d+$/.test(n));
  let best = null;
  for (const t of parsed) {
    if (!best || isNewer(t, best)) best = t;
  }
  const tag = best.startsWith('v') ? best : 'v' + best;
  return { tag, name: tag, url: 'https://github.com/' + REPO + '/releases/tag/' + tag };
}

// Compare dotted version strings ('4.3.9' vs '4.10.0') numerically.
function isNewer(candidate, current) {
  const num = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = num(candidate), b = num(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function downloadToFile(url, dest) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await httpsGet(url);
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    } catch (e) { reject(e); }
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(new Error(cmd + ' failed: ' + (stderr || err.message)));
      resolve(stdout);
    });
  });
}

// Applies the given tag to the app rooted at appDir (defaults to this file's
// grandparent, i.e. the running installation). Never touches node_modules or
// the user config in ~/.config: only src/ and package.json are replaced.
async function applyUpdate(tag, appDir, log) {
  log = log || (() => {});
  appDir = appDir || path.join(__dirname, '..');
  if (!/^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) throw new Error('invalid tag: ' + tag);
  const vtag = tag.startsWith('v') ? tag : 'v' + tag;

  const workDir = path.join(appDir, 'updates');
  fs.mkdirSync(workDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);

  // 1. Download the tag source tarball (public repo, no token needed)
  const tarball = path.join(workDir, vtag + '.tar.gz');
  log('[Updater] downloading ' + vtag + '...');
  await downloadToFile('https://github.com/' + REPO + '/archive/refs/tags/' + vtag + '.tar.gz', tarball);

  // 2. Extract and sanity-check
  const extractDir = path.join(workDir, 'extract-' + vtag);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await run('tar', ['-xzf', tarball, '-C', extractDir]);
  // GitHub names the root folder <repo>-<version> WITHOUT the owner — find it
  // dynamically instead of guessing the exact name.
  const srcDir = path.join(extractDir, (fs.readdirSync(extractDir).find((e) =>
    fs.existsSync(path.join(extractDir, e, 'src', 'main.js')) &&
    fs.existsSync(path.join(extractDir, e, 'package.json'))
  ) || ''));
  if (!srcDir.endsWith(path.sep) && !fs.existsSync(path.join(srcDir, 'package.json'))) {
    throw new Error('extracted tarball does not look like a companion release');
  }

  // 3. Backup current src/ and package.json
  if (fs.existsSync(path.join(appDir, 'src'))) {
    await run('cp', ['-a', path.join(appDir, 'src'), path.join(appDir, 'src.bak-' + stamp)]);
    await run('cp', ['-a', path.join(appDir, 'package.json'), path.join(appDir, 'package.json.bak-' + stamp)]);
  }

  // 4. Replace src/ and package.json atomically-ish: move old aside, copy new
  const oldSrc = path.join(workDir, 'prev-src-' + stamp);
  fs.rmSync(oldSrc, { recursive: true, force: true });
  if (fs.existsSync(path.join(appDir, 'src'))) {
    fs.renameSync(path.join(appDir, 'src'), oldSrc);
  }
  await run('cp', ['-a', path.join(srcDir, 'src'), path.join(appDir, 'src')]);
  await run('cp', [path.join(srcDir, 'package.json'), path.join(appDir, 'package.json')]);

  // 5. Syntax-check the new main.js before declaring success
  await run('node', ['--check', path.join(appDir, 'src', 'main.js')]);

  log('[Updater] applied ' + vtag + ' (backup: src.bak-' + stamp + ')');
  return { ok: true, tag: vtag, backup: 'src.bak-' + stamp };
}

module.exports = { fetchLatestStable, isNewer, applyUpdate, httpsGet, REPO };
