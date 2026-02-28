#!/bin/bash
set -e

# =============================================
#  WhatsApp-Telegram Bridge — VPS Setup Script
#  Run: chmod +x setup.sh && sudo ./setup.sh
# =============================================

echo ""
echo "=========================================="
echo "  🌉 WhatsApp-Telegram Bridge Setup"
echo "=========================================="
echo ""

# ---- Step 1: System Update ----
echo "📦 [1/8] Updating system packages..."
apt update -y && apt upgrade -y

# ---- Step 2: Install Node.js 20 LTS ----
echo "📦 [2/8] Installing Node.js 20..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
echo "   Node: $(node -v) | npm: $(npm -v)"

# ---- Step 3: Install Chromium & Build Tools ----
echo "📦 [3/8] Installing Chromium & build tools..."
apt install -y \
  chromium-browser \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  ca-certificates \
  build-essential \
  python3 \
  --no-install-recommends 2>/dev/null || true

# ---- Step 4: Fix Oracle Cloud iptables (if applicable) ----
echo "🔓 [4/8] Fixing firewall rules (Oracle Cloud fix)..."
iptables -F 2>/dev/null || true
iptables -F -t nat 2>/dev/null || true
iptables -F -t mangle 2>/dev/null || true
iptables -P INPUT ACCEPT 2>/dev/null || true
iptables -P FORWARD ACCEPT 2>/dev/null || true
iptables -P OUTPUT ACCEPT 2>/dev/null || true
if command -v netfilter-persistent &> /dev/null; then
  netfilter-persistent save 2>/dev/null || true
fi

# ---- Step 5: Clean previous installation ----
echo "🧹 [5/8] Cleaning previous installation..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

rm -rf node_modules package-lock.json 2>/dev/null || true
rm -rf data logs media wa_session 2>/dev/null || true
echo "   Cleaned: node_modules, data, logs, media, wa_session"

# ---- Step 6: Install fresh dependencies ----
echo "📦 [6/8] Installing Node.js dependencies (this may take 2-3 min)..."
npm install --production

# ---- Step 7: Create directories ----
echo "📁 [7/8] Creating directories..."
mkdir -p data logs media wa_session

# ---- Step 8: Configure .env ----
if [ ! -f .env ]; then
  RANDOM_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  cp .env.example .env
  sed -i "s/change_this_to_a_random_32_char_string/$RANDOM_KEY/" .env
  echo ""
  echo "=========================================="
  echo "  ⚠️  CONFIGURE YOUR .env FILE NOW!"
  echo "=========================================="
  echo ""
  echo "  Run:  nano .env"
  echo ""
  echo "  You MUST set:"
  echo "    TELEGRAM_BOT_TOKEN=your_bot_token"
  echo "    TELEGRAM_ADMIN_CHAT_ID=your_user_id"
  echo "    ADMIN_PASSWORD=a_strong_password"
  echo ""
  echo "  ENCRYPTION_KEY has been auto-generated ✅"
  echo ""
  echo "  After editing .env, start the bridge with:"
  echo "    node src/index.js"
  echo ""
  echo "  Or use pm2 for 24/7 running:"
  echo "    npm install -g pm2"
  echo "    pm2 start src/index.js --name wa-tg-bridge"
  echo "    pm2 save && pm2 startup"
  echo ""
else
  echo "   .env already exists, keeping it"
  echo ""
  echo "=========================================="
  echo "  ✅ Setup complete!"
  echo "=========================================="
  echo ""
  echo "  Start:  node src/index.js"
  echo ""
  echo "  Or with pm2 (24/7):"
  echo "    npm install -g pm2"
  echo "    pm2 start src/index.js --name wa-tg-bridge"
  echo "    pm2 save && pm2 startup"
  echo ""
  echo "  Dashboard: http://localhost:3001"
  echo ""
fi
