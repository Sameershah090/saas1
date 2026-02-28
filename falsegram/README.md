# 🌉 WhatsApp-Telegram Bridge

A **bidirectional bridge** that mirrors your WhatsApp messages, media, and calls into a Telegram group with organized forum topics — one thread per contact, one unified call log. Reply directly from Telegram to send messages back to WhatsApp.

---

## ✨ Features

### 📬 Message Bridging
- **Incoming + outgoing** messages mirrored to Telegram forum topics
- **Reply from Telegram** — type in a contact's topic to send to WhatsApp
- Supports **text, photos, videos, audio, voice notes, documents, stickers, GIFs, locations, contact cards**
- **Quoted message threading** maps replies across platforms
- **Message edit sync** — edits in WhatsApp show as notifications in Telegram
- **Message delete sync** — deletions in WhatsApp are flagged in Telegram
- **Delivery receipts** — ✅ delivered, 👀 read, 🔊 played badges on your messages
- **Reaction sync** — emoji reactions from WhatsApp appear on Telegram messages

### 📞 Call Logging
- All calls logged to a single **"📞 Call Logs"** topic
- Shows caller name, phone, type (voice/video), direction, timestamp

### 👥 Contact & Group Management
- **Auto-creates forum topics** per contact/group
- **Aliases** — set custom nicknames with `/alias`
- **Mute/unmute** contacts to stop forwarding
- **Archive** inactive contacts to keep things tidy
- **Group events** — join/leave/rename notifications forwarded
- **Profile picture sync** — API support for topic icons
- **Searchable contacts** via `/contacts` and `/search` (searches aliases too)

### 🔑 On-Demand Login & Session Management
- `/login` generates a **fresh QR code** on demand (no auto-spam)
- `/logout` fully clears session for clean re-login
- **Auto-reconnect** with exponential backoff on disconnect (5s → 5min)

### ⏰ Scheduled Messages
- `/schedule` a message to be sent at a future time
- View upcoming with `/scheduled`, cancel with `/cancelschedule`
- Background scheduler checks every 30 seconds

### 📡 Broadcast
- `/broadcast` to send a message to all active contacts
- Safety: requires `/broadcast confirm <msg>` to execute

### 🔍 Message Search
- `/find <keyword>` searches through encrypted message history
- Shows sender, direction, and content snippets

### 💾 Backup & Restore
- `/backup` exports the database as a file to Telegram
- `/restore` by replying to a `.db` file (auto-backs up current DB first)
- Keeps last 5 backups automatically

### 📷 Stories / Status Viewer
- `/stories` fetches recent WhatsApp statuses with text and media

### ✍️ Typing Indicators
- When you type in a Telegram topic, a typing indicator is sent to WhatsApp

### 🎛️ Bot Command Buttons
- `/start` and `/help` show a 6-row **inline keyboard** with all commands

### 🔒 Security
- **Admin-only** — all commands and callbacks restricted to your Telegram ID
- **AES-256-GCM encryption** for stored message content
- **Log redaction** — bot tokens and passwords stripped from all logs
- **Input validation** on all user inputs (phone, message size, file paths)
- **Startup warnings** for weak passwords and default encryption keys
- **Rate limiting** on commands and messages
- **No error leaks** — sanitized errors sent to Telegram

### 📊 Web Dashboard & Monitoring
- **Dashboard** at `http://localhost:3001` with live stats
- `/health` — JSON health check endpoint (for monitoring tools)
- `/metrics` — Prometheus-compatible metrics (contacts, messages, calls, memory)
- `/status` — Component status JSON

### 🐳 Docker Support
- `Dockerfile` with Chromium for Puppeteer
- `docker-compose.yml` with persistent volumes
- Built-in health check

### ⚙️ Infrastructure
- **Database migrations** — automatic schema versioning
- **GitHub Actions CI** — syntax check + tests on Node 18/20 + Docker build
- **Automated tests** — 11 test cases covering models, encryption, security

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18 or later
- A **Telegram Bot** (create via [@BotFather](https://t.me/BotFather))
- A **Telegram Group** with **Topics/Forum Mode** enabled

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd wa-tg-bridge
npm install
```

### 2. Configure `.env`

```bash
cp .env.example .env
# Edit .env with your values
```

Key settings:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_numeric_id
ADMIN_PASSWORD=your_strong_password
ENCRYPTION_KEY=random_32_char_string_here
```

### 3. Set Up Telegram Group

1. Create a new Telegram **Group** → Enable **Topics**
2. Add bot as **Admin** (manage topics + send messages)

### 4. Start

```bash
npm start          # Production
npm run dev        # Development (auto-reload)
npm test           # Run tests
```

### 5. First-Time Setup

1. Send `/setgroup` in the forum group
2. Send `/login` to get a WhatsApp QR code
3. Scan with WhatsApp → Settings → Linked Devices

---

## 📖 Commands Reference

| Command | Description |
|---------|-------------|
| `/start` | Welcome + button keyboard |
| `/help` | All commands + buttons |
| `/login` | Connect WhatsApp (QR code) |
| `/logout` | Disconnect + clear session |
| `/restart` | Restart WhatsApp |
| `/status` | Full status overview |
| `/setgroup` | Link forum group |
| `/send <phone> <msg>` | Send to a phone number |
| `/broadcast confirm <msg>` | Send to all contacts |
| `/schedule <phone> <time> <msg>` | Schedule a message (e.g. `30m`, `2h`) |
| `/scheduled` | View pending scheduled |
| `/cancelschedule <id>` | Cancel a scheduled message |
| `/find <keyword>` | Search message history |
| `/contacts` | List active contacts |
| `/search <query>` | Search contacts |
| `/alias <phone> <name>` | Set contact nickname |
| `/mute <phone>` | Mute (stop forwarding) |
| `/unmute <phone>` | Unmute contact |
| `/muted` | List muted contacts |
| `/calls` | Recent call log |
| `/stories` | View WhatsApp statuses |
| `/archive` | Show/archive inactive contacts |
| `/unarchive <phone>` | Unarchive a contact |
| `/backup` | Export database file |
| `/restore` | Restore DB (reply to .db file) |
| `/cleanup` | Delete old media files |

---

## 🐳 Docker

```bash
# Build and run
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

---

## 📊 Monitoring

| Endpoint | Format | Description |
|----------|--------|-------------|
| `http://localhost:3001/` | HTML | Live dashboard |
| `http://localhost:3001/health` | JSON | Health check |
| `http://localhost:3001/metrics` | JSON | Metrics |
| `http://localhost:3001/metrics?format=prometheus` | Text | Prometheus scrape target |

---

## 📁 Project Structure

```
wa-tg-bridge/
├── .env / .env.example        # Configuration
├── .github/workflows/ci.yml   # CI pipeline
├── Dockerfile                  # Container build
├── docker-compose.yml          # Container orchestration
├── tests/test.js               # Automated tests
├── src/
│   ├── index.js                # Entry point
│   ├── config/index.js         # Config + validation
│   ├── database/
│   │   ├── connection.js       # SQLite setup
│   │   ├── migrations.js       # Schema migrations
│   │   └── models/             # Contact, MessageMap, CallRecord, ScheduledMessage, ReactionMap
│   ├── handlers/
│   │   ├── callHandler.js      # Unified call log topic
│   │   ├── incomingWhatsApp.js # WA→TG with encryption
│   │   ├── outgoingWhatsApp.js # Phone→TG mirror
│   │   ├── telegramCommands.js # 26 bot commands
│   │   ├── telegramReply.js    # TG→WA reply + typing
│   │   └── whatsappEvents.js   # Receipts, reactions, edits, groups
│   ├── middleware/security.js  # Auth + validation
│   ├── services/
│   │   ├── dashboard.js        # Web dashboard + metrics
│   │   ├── encryption.js       # AES-256-GCM
│   │   ├── mediaHandler.js     # Media save/convert
│   │   ├── messageMapper.js    # Contact + topic management
│   │   ├── scheduler.js        # Scheduled message delivery
│   │   ├── telegram.js         # Telegram bot service
│   │   └── whatsapp.js         # WA client + auto-reconnect
│   └── utils/                  # Logger, rate limiter, sanitizer, error handler
├── data/                       # SQLite database
├── logs/                       # Log files
├── media/                      # Downloaded media
└── wa_session/                 # WhatsApp session
```

---

## 🔒 Security Checklist

- [ ] `TELEGRAM_BOT_TOKEN` is secret (never commit `.env`)
- [ ] `ADMIN_PASSWORD` changed from default
- [ ] `ENCRYPTION_KEY` is a random 32+ char string
- [ ] `.env` is in `.gitignore`
- [ ] Bot is admin only in your private group

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| QR not appearing | Run `/login` (not auto-sent) |
| Messages not forwarding | Check `/setgroup` and bot admin perms |
| "Disconnected" error | Auto-reconnect runs. Or try `/login` |
| Session issues | `/logout` clears all data, then `/login` |
| Native module errors | Run `npm rebuild better-sqlite3` |
| Docker build fails | Ensure Docker has internet for Chromium |

---

## 📄 License

MIT
