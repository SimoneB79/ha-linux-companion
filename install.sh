#!/bin/bash
# HA Linux Companion — Installer for Debian-based systems
# Usage: sudo bash install.sh
# Optional env:
#   INSTALL_DIR=/path/to/app
#   HA_COMPANION_PROFILE=auto|raspi|generic
#   HA_HOST_WAIT=ha.lan|none

set -e

APP_NAME="ha-linux-companion"
INSTALL_DIR="${INSTALL_DIR:-/opt/${APP_NAME}}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
REPO_URL="https://github.com/SimoneB79/ha-linux-companion"
NODE_MAJOR=20
HA_COMPANION_PROFILE="${HA_COMPANION_PROFILE:-auto}"
HA_HOST_WAIT="${HA_HOST_WAIT:-ha.lan}"

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
  # Fall back to the owner of the first non-root login session.
  TARGET_USER="$(loginctl list-sessions --no-legend 2>/dev/null \
    | awk '{print $3}' | grep -v '^root$' | head -1)"
fi
if [ -z "${TARGET_USER}" ]; then
  echo -e "${RED}Cannot determine the desktop user. Re-run with: sudo bash install.sh${NC}"
  exit 1
fi
TARGET_UID="$(id -u "${TARGET_USER}")"
TARGET_DISPLAY="$(sudo -u "${TARGET_USER}" bash -lc 'echo ${DISPLAY:-}' 2>/dev/null)"
[ -z "${TARGET_DISPLAY}" ] && TARGET_DISPLAY=":0"
echo -e "  Target user: ${GREEN}${TARGET_USER}${NC} (uid ${TARGET_UID}, DISPLAY ${TARGET_DISPLAY})"
echo ""

# ── Profile detection ──
if [ "${HA_COMPANION_PROFILE}" = "auto" ]; then
  if grep -qi 'raspberry pi\|bcm' /proc/device-tree/model /proc/cpuinfo 2>/dev/null; then
    HA_COMPANION_PROFILE="raspi"
  else
    HA_COMPANION_PROFILE="generic"
  fi
fi
case "${HA_COMPANION_PROFILE}" in
  raspi|generic) ;;
  *) echo -e "${RED}Invalid HA_COMPANION_PROFILE: ${HA_COMPANION_PROFILE}${NC}"; exit 1 ;;
esac
echo -e "  Install profile: ${GREEN}${HA_COMPANION_PROFILE}${NC}"
echo ""

# ── Install Node.js ──
echo -e "${BLUE}[1/6] Installing Node.js ${NODE_MAJOR}...${NC}"
CURRENT_MAJOR="$(node --version 2>/dev/null | sed 's/^v//; s/\..*//')"
if [ -z "${CURRENT_MAJOR}" ] || [ "${CURRENT_MAJOR}" -lt "${NODE_MAJOR}" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "  Node $(node --version), npm $(npm --version)"

# ── Install dependencies ──
# Package names differ across releases (t64 transition renamed several of them).
echo -e "${BLUE}[2/6] Installing system dependencies...${NC}"
apt-get update -qq || true
MISSING=()
for pkg in curl unzip libgtk-3-0t64:libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
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
echo -e "${BLUE}[3/6] Installing application...${NC}"
mkdir -p "${INSTALL_DIR}"

# Copy all files
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/package.json" ]; then
  cp -r "${SCRIPT_DIR}/"* "${INSTALL_DIR}/"
else
  echo "  Downloading from GitHub..."
  echo -e "${RED}Direct download not yet available. Use git clone.${NC}"
  exit 1
fi

cd "${INSTALL_DIR}"

# Electron is currently a devDependency, so --production/--omit=dev would skip
# the runtime binary. Keep dev dependencies for now; future packaging can move
# electron to dependencies or bundle release artifacts.
npm install

# ── Verify the Electron binary actually landed ──
echo -e "${BLUE}[4/6] Verifying Electron runtime...${NC}"
ELECTRON_BIN="${INSTALL_DIR}/node_modules/electron/dist/electron"
if [ ! -x "${ELECTRON_BIN}" ]; then
  echo -e "${YELLOW}  Electron not extracted — repairing from cache...${NC}"
  USER_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
  ZIP="$(find "${USER_HOME}/.cache/electron" /root/.cache/electron \
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

# On generic Linux, use Chromium's sandbox when available. On Raspberry Pi kiosk
# panels keep the known-working no-sandbox flags from the production service.
SANDBOX="${INSTALL_DIR}/node_modules/electron/dist/chrome-sandbox"
if [ "${HA_COMPANION_PROFILE}" = "generic" ] && [ -f "${SANDBOX}" ]; then
  chown root:root "${SANDBOX}" && chmod 4755 "${SANDBOX}"
fi
echo "  $("${ELECTRON_BIN}" --version 2>/dev/null || echo 'version check skipped')"

# ── Desktop integration ──
echo -e "${BLUE}[5/6] Creating desktop integration...${NC}"

# Desktop entry
cat > /usr/share/applications/${APP_NAME}.desktop << EOF_DESKTOP
[Desktop Entry]
Name=HA Companion
Comment=Home Assistant Linux Companion
Exec=${INSTALL_DIR}/run.sh
Icon=${INSTALL_DIR}/assets/icon.png
Terminal=false
Type=Application
Categories=Utility;
StartupNotify=true
EOF_DESKTOP

# Autostart for the target user only, not every account on the machine.
USER_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
install -d -o "${TARGET_USER}" -g "${TARGET_USER}" "${USER_HOME}/.config/autostart"
cp "/usr/share/applications/${APP_NAME}.desktop" "${USER_HOME}/.config/autostart/"
chown "${TARGET_USER}:${TARGET_USER}" "${USER_HOME}/.config/autostart/${APP_NAME}.desktop"

if [ "${HA_COMPANION_PROFILE}" = "raspi" ]; then
  ELECTRON_FLAGS="--no-sandbox --disable-gpu-sandbox --disable-gpu --enable-features=UseOzonePlatform --ozone-platform=wayland"
  WAYLAND_DISPLAY_VALUE="wayland-0"
  WANTED_BY="multi-user.target"
else
  ELECTRON_FLAGS="--ozone-platform-hint=auto"
  WAYLAND_DISPLAY_VALUE=""
  WANTED_BY="graphical.target"
fi

# Run script
cat > "${INSTALL_DIR}/run.sh" << RUNEOF
#!/bin/bash
export DISPLAY="\${DISPLAY:-${TARGET_DISPLAY}}"
if [ -n "${WAYLAND_DISPLAY_VALUE}" ]; then
  export WAYLAND_DISPLAY="\${WAYLAND_DISPLAY:-${WAYLAND_DISPLAY_VALUE}}"
fi
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}"
cd "${INSTALL_DIR}"
exec ./node_modules/electron/dist/electron . ${ELECTRON_FLAGS} "\$@"
RUNEOF
chmod +x "${INSTALL_DIR}/run.sh"
chown "${TARGET_USER}:${TARGET_USER}" "${INSTALL_DIR}/run.sh"

# ── systemd unit ──
echo -e "${BLUE}[6/6] Installing systemd unit...${NC}"
if [ -f "${INSTALL_DIR}/scripts/${APP_NAME}.service" ]; then
  WAYLAND_ENV=""
  [ -n "${WAYLAND_DISPLAY_VALUE}" ] && WAYLAND_ENV="Environment=WAYLAND_DISPLAY=${WAYLAND_DISPLAY_VALUE}"
  EXEC_START_PRE=""
  if [ "${HA_HOST_WAIT}" != "none" ] && [ -n "${HA_HOST_WAIT}" ]; then
    EXEC_START_PRE="ExecStartPre=/bin/bash -c 'for i in 1 2 3 4 5 6 7 8 9 10; do getent hosts ${HA_HOST_WAIT} && break; sleep 2; done'"
  fi
  sed_escape() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }
  WAYLAND_ENV_ESC="$(sed_escape "${WAYLAND_ENV}")"
  EXEC_START_PRE_ESC="$(sed_escape "${EXEC_START_PRE}")"
  ELECTRON_FLAGS_ESC="$(sed_escape "${ELECTRON_FLAGS}")"
  sed -e "s|@@USER@@|${TARGET_USER}|g" \
      -e "s|@@UID@@|${TARGET_UID}|g" \
      -e "s|@@DISPLAY@@|${TARGET_DISPLAY}|g" \
      -e "s|@@WAYLAND_ENV@@|${WAYLAND_ENV_ESC}|g" \
      -e "s|@@WORKDIR@@|${INSTALL_DIR}|g" \
      -e "s|@@EXEC_START_PRE@@|${EXEC_START_PRE_ESC}|g" \
      -e "s|@@ELECTRON_FLAGS@@|${ELECTRON_FLAGS_ESC}|g" \
      -e "s|@@WANTED_BY@@|${WANTED_BY}|g" \
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
echo "  Profile:        ${HA_COMPANION_PROFILE}"
echo "  Autostart:      Enabled for ${TARGET_USER}"
echo ""
echo -e "${BLUE}First launch will show the connection screen.${NC}"
