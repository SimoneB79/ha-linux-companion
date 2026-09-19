#!/bin/bash
# HA Linux Companion — Installer for Raspberry Pi OS
# Usage: curl -sSL <this-file> | bash

set -e

APP_NAME="ha-linux-companion"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
REPO_URL="https://github.com/simonebonizzardi/ha-linux-companion"
NODE_MAJOR=20

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  HA Linux Companion — Installer      ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Check root ──
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root: sudo bash install.sh${NC}"
  exit 1
fi

# ── Identify the target (desktop) user — never hardcode ──
TARGET_USER="${SUDO_USER:-}"
if [ -z "${TARGET_USER}" ] || [ "${TARGET_USER}" = "root" ]; then
  # Fall back to the owner of the active graphical session
  TARGET_USER="$(loginctl list-sessions --no-legend 2>/dev/null \
    | awk '{print $3}' | grep -v '^root$' | head -1)"
fi
if [ -z "${TARGET_USER}" ]; then
  echo -e "${RED}Cannot determine the desktop user. Re-run with: sudo bash install.sh${NC}"
  exit 1
fi
TARGET_UID="$(id -u "${TARGET_USER}")"
TARGET_DISPLAY="$(sudo -u "${TARGET_USER}" bash -c 'echo ${DISPLAY:-}' 2>/dev/null)"
[ -z "${TARGET_DISPLAY}" ] && TARGET_DISPLAY=":0"
echo -e "  Target user: ${GREEN}${TARGET_USER}${NC} (uid ${TARGET_UID}, DISPLAY ${TARGET_DISPLAY})"
echo ""

# ── Install Node.js ──
echo -e "${BLUE}[1/5] Installing Node.js ${NODE_MAJOR}...${NC}"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi
echo "  Node $(node --version), npm $(npm --version)"

# ── Install dependencies ──
# Package names differ across releases (the t64 ABI transition renamed several
# of these), so install one by one and report what is genuinely missing.
echo -e "${BLUE}[2/5] Installing system dependencies...${NC}"
apt-get update -qq || true
MISSING=()
for pkg in libgtk-3-0t64:libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
           xdg-utils libatspi2.0-0t64:libatspi2.0-0 libdrm2 libgbm1 \
           libasound2t64:libasound2; do
  primary="${pkg%%:*}"; fallback="${pkg#*:}"
  if apt-get install -y -qq "${primary}" >/dev/null 2>&1; then
    continue
  elif [ "${fallback}" != "${primary}" ] && apt-get install -y -qq "${fallback}" >/dev/null 2>&1; then
    continue
  else
    MISSING+=("${primary}")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${YELLOW}  Warning: could not install: ${MISSING[*]}${NC}"
  echo -e "${YELLOW}  Electron may fail to start. Install these manually.${NC}"
fi

# ── Install app ──
echo -e "${BLUE}[3/5] Installing application...${NC}"
mkdir -p "${INSTALL_DIR}"

# Copy all files
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/package.json" ]; then
  cp -r "${SCRIPT_DIR}/"* "${INSTALL_DIR}/"
else
  # Running from curl — download from GitHub
  echo "  Downloading from GitHub..."
  # TODO: implement GitHub releases download
  echo -e "${RED}Direct download not yet available. Use git clone.${NC}"
  exit 1
fi

cd "${INSTALL_DIR}"

# NOT --production: electron lives in devDependencies, so --production/--omit=dev
# installs everything EXCEPT the one binary the app needs to run.
npm install

# ── Verify the Electron binary actually landed ──
# electron's install.js extracts the download via extract-zip, which can exit 0
# without extracting anything on newer Node releases. Verify, and fall back to
# unzipping the cached archive ourselves.
echo -e "${BLUE}[4/5] Verifying Electron runtime...${NC}"
ELECTRON_BIN="${INSTALL_DIR}/node_modules/electron/dist/electron"
if [ ! -x "${ELECTRON_BIN}" ]; then
  echo -e "${YELLOW}  Electron not extracted — repairing from cache...${NC}"
  ZIP="$(find "$(getent passwd "${TARGET_USER}" | cut -d: -f6)/.cache/electron" /root/.cache/electron \
        -name 'electron-v*.zip' 2>/dev/null | head -1)"
  if [ -z "${ZIP}" ]; then
    echo -e "${RED}  No cached Electron archive found. Re-run: npm rebuild electron${NC}"
    exit 1
  fi
  rm -rf "${INSTALL_DIR}/node_modules/electron/dist"
  mkdir -p "${INSTALL_DIR}/node_modules/electron/dist"
  unzip -q "${ZIP}" -d "${INSTALL_DIR}/node_modules/electron/dist"
  printf 'electron' > "${INSTALL_DIR}/node_modules/electron/path.txt"
  chmod +x "${ELECTRON_BIN}" "${INSTALL_DIR}/node_modules/electron/dist/chrome_crashpad_handler"
fi
chown -R "${TARGET_USER}:${TARGET_USER}" "${INSTALL_DIR}"
# Enable the Chromium sandbox properly instead of passing --no-sandbox.
# Must come after the recursive chown, which would otherwise strip the setuid bit.
SANDBOX="${INSTALL_DIR}/node_modules/electron/dist/chrome-sandbox"
if [ -f "${SANDBOX}" ]; then
  chown root:root "${SANDBOX}" && chmod 4755 "${SANDBOX}"
fi
echo "  $("${ELECTRON_BIN}" --version 2>/dev/null || echo 'version check skipped')"

# ── Desktop integration ──
echo -e "${BLUE}[4/5] Creating desktop integration...${NC}"

# Desktop entry
cat > /usr/share/applications/${APP_NAME}.desktop << EOF
[Desktop Entry]
Name=HA Companion
Comment=Home Assistant Linux Companion
Exec=${INSTALL_DIR}/run.sh
Icon=${INSTALL_DIR}/assets/icon.png
Terminal=false
Type=Application
Categories=Utility;
StartupNotify=true
EOF

# Autostart entry
mkdir -p /etc/xdg/autostart
cp /usr/share/applications/${APP_NAME}.desktop /etc/xdg/autostart/

# Run script
cat > "${INSTALL_DIR}/run.sh" << 'RUNEOF'
#!/bin/bash
export DISPLAY="${DISPLAY:-@@DISPLAY@@}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
cd "@@INSTALL_DIR@@"
exec ./node_modules/electron/dist/electron . --ozone-platform-hint=auto "$@"
RUNEOF
sed -i -e "s|@@DISPLAY@@|${TARGET_DISPLAY}|g" -e "s|@@INSTALL_DIR@@|${INSTALL_DIR}|g" \
  "${INSTALL_DIR}/run.sh"
chmod +x "${INSTALL_DIR}/run.sh"

# ── systemd unit (installed, not enabled) ──
echo -e "${BLUE}[5/5] Installing systemd unit (not enabled)...${NC}"
if [ -f "${INSTALL_DIR}/scripts/${APP_NAME}.service" ]; then
  sed -e "s|@@USER@@|${TARGET_USER}|g" \
      -e "s|@@UID@@|${TARGET_UID}|g" \
      -e "s|@@DISPLAY@@|${TARGET_DISPLAY}|g" \
      -e "s|@@WORKDIR@@|${INSTALL_DIR}|g" \
      "${INSTALL_DIR}/scripts/${APP_NAME}.service" > "${SERVICE_FILE}"
  systemctl daemon-reload
  echo "  Installed ${SERVICE_FILE}"
  echo "  Enable with: sudo systemctl enable --now ${APP_NAME}"
fi

# ── Done ──
echo ""
echo -e "${GREEN}✓ HA Linux Companion installed!${NC}"
echo ""
echo "  Run from menu:  Applications → HA Companion"
echo "  Run from CLI:   ${INSTALL_DIR}/run.sh"
echo "  Autostart:      Enabled (xdg autostart)"
echo ""
echo -e "${BLUE}First launch will show the connection screen.${NC}"
