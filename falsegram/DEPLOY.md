# 🚀 Linux VPS Deployment Guide

Step-by-step instructions to deploy the WhatsApp-Telegram Bridge on a Linux VPS (Ubuntu/Debian).

---

## Prerequisites

1. A **Linux VPS** (Ubuntu 20.04+ or Debian 11+ recommended, min 1GB RAM)
2. **SSH access** to your server
3. A **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather))
4. Your **Telegram User ID** (from [@userinfobot](https://t.me/userinfobot))
5. A **Telegram Group** with **Topics/Forum Mode** enabled

---

## Step 1: SSH Into Your Server

```bash
ssh root@your-server-ip
```

---

## Step 2: Install System Dependencies

```bash
# Update packages
apt update && apt upgrade -y

# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node -v   # Should show v20.x
npm -v    # Should show 10.x

# Install Chromium dependencies (needed for WhatsApp Web via Puppeteer)
apt install -y \
  chromium-browser \
  fonts-liberation \
  libappindicator3-1 \
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
  --no-install-recommends

# Install build tools (for native modules like better-sqlite3)
apt install -y build-essential python3
```

---

## Step 3: Create a Dedicated User (Security Best Practice)

```bash
# Create user (never run as root in production)
adduser --disabled-password --gecos "" bridge
usermod -aG sudo bridge

# Switch to the new user
su - bridge
```

---

## Step 4: Upload / Clone Your Project

**Option A: Clone from Git (if you've pushed it)**
```bash
cd ~
git clone https://your-repo-url.git wa-tg-bridge
cd wa-tg-bridge
```

**Option B: Upload from your Windows machine using SCP**

Run this **on your Windows machine** (PowerShell):
```powershell
# Compress the project first (exclude node_modules)
cd C:\Users\HP\Downloads\wa-tg-bridge
tar -czf wa-tg-bridge.tar.gz --exclude="node_modules" --exclude="wa_session" --exclude="data" --exclude="logs" --exclude="media" wa-tg-bridge

# Upload to server
scp wa-tg-bridge.tar.gz bridge@your-server-ip:~/
```

Then **on your server**:
```bash
cd ~
tar -xzf wa-tg-bridge.tar.gz
cd wa-tg-bridge
rm ~/wa-tg-bridge.tar.gz
```

---

## Step 5: Install Node.js Dependencies

```bash
cd ~/wa-tg-bridge
npm install --production
```

> This will compile `better-sqlite3` and `sharp` native modules for your Linux system. It may take 1-2 minutes.

---

## Step 6: Configure Environment Variables

```bash
# Copy the example env file
cp .env.example .env

# Edit with nano
nano .env
```

Fill in your values:
```env
TELEGRAM_BOT_TOKEN=your_actual_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_numeric_telegram_id
ADMIN_PASSWORD=a_strong_unique_password
ENCRYPTION_KEY=generate_a_random_32_char_string_here

# Leave defaults for these unless needed:
MEDIA_DIR=./media
DB_PATH=./data/bridge.db
LOG_DIR=./logs
WA_SESSION_DIR=./wa_session
DASHBOARD_PORT=3001
```

**Generate a random encryption key:**
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Save and exit nano: `Ctrl+X` → `Y` → `Enter`

---

## Step 7: Create Required Directories

```bash
mkdir -p data logs media wa_session
```

---

## Step 8: Test Run (Manual Start)

```bash
node src/index.js
```

You should see:
```
============================================
  WhatsApp-Telegram Bridge v2.0 Starting...
============================================
Database connected and initialized
Database schema is up to date
Telegram bot initialized: @your_bot_name
No WhatsApp session found. Use /login in Telegram to connect.
Dashboard running on http://localhost:3001
✅ Bridge is running!
```

**Now in Telegram:**
1. Open your bot → Send `/start` (you'll see buttons)
2. Add the bot to your forum group → Send `/setgroup` in the group
3. Send `/login` → Scan the QR code with WhatsApp

Once connected, press `Ctrl+C` to stop (we'll set up auto-start next).

---

## Step 9: Set Up as a System Service (pm2)

This keeps the bridge running 24/7 and auto-restarts on crash or reboot.

```bash
# Install pm2 globally
sudo npm install -g pm2

# Start the bridge with pm2
cd ~/wa-tg-bridge
pm2 start src/index.js --name "wa-tg-bridge"

# Save the process list (so it restarts on reboot)
pm2 save

# Set up auto-start on system boot
pm2 startup
# pm2 will print a command — copy and run it with sudo, e.g.:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u bridge --hp /home/bridge
```

### Useful pm2 commands:
```bash
pm2 status              # Check status
pm2 logs wa-tg-bridge   # View live logs
pm2 restart wa-tg-bridge # Restart the bridge
pm2 stop wa-tg-bridge   # Stop the bridge
pm2 monit               # Live monitoring dashboard
```

---

## Step 10: (Optional) Open Dashboard Port

If you want to access the dashboard from your browser at `http://your-server-ip:3001`:

```bash
# Allow port 3001 through firewall
sudo ufw allow 3001/tcp
```

Then visit: `http://your-server-ip:3001`

> ⚠️ For production, use a reverse proxy (nginx) with HTTPS instead of exposing the port directly.

---

## Step 11: (Optional) Set Up Nginx Reverse Proxy

If you want HTTPS and a domain name for the dashboard:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Create nginx config
sudo nano /etc/nginx/sites-available/wa-bridge
```

Paste:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/wa-bridge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d your-domain.com
```

---

## Step 12: (Alternative) Deploy with Docker

If you prefer Docker:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker bridge
# Log out and back in, then:

cd ~/wa-tg-bridge

# Create .env file (same as Step 6)
cp .env.example .env
nano .env

# Build and run
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start | `pm2 start wa-tg-bridge` |
| Stop | `pm2 stop wa-tg-bridge` |
| Restart | `pm2 restart wa-tg-bridge` |
| View logs | `pm2 logs wa-tg-bridge --lines 100` |
| Check status | `pm2 status` |
| Dashboard | `http://your-server-ip:3001` |
| Health check | `curl http://localhost:3001/health` |
| Metrics | `curl http://localhost:3001/metrics` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `better-sqlite3` build fails | `sudo apt install build-essential python3` then `npm rebuild` |
| Chromium not found | `sudo apt install chromium-browser` or set `PUPPETEER_EXECUTABLE_PATH` |
| Permission denied | Make sure you're running as `bridge` user, not root |
| QR code not appearing | Send `/login` in Telegram, check `pm2 logs` |
| Dashboard not accessible | Check `ufw allow 3001/tcp` or use nginx |
| Session lost after reboot | Normal — scan QR again with `/login`, pm2 restarts app automatically |
| Out of memory (1GB VPS) | Add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
