const http = require('http');
const { config } = require('../config');
const logger = require('../utils/logger');
const { Contact, MessageMap, CallRecord, ScheduledMessage } = require('../database');

class DashboardService {
    constructor() {
        this.server = null;
        this.port = parseInt(process.env.DASHBOARD_PORT) || 3001;
        this.startTime = Date.now();
        this.statusProviders = {};
    }

    /**
     * Register a function that returns status info for a component.
     */
    registerStatus(name, provider) {
        this.statusProviders[name] = provider;
    }

    start() {
        this.server = http.createServer((req, res) => {
            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');

            const url = new URL(req.url, 'http://localhost');

            try {
                switch (url.pathname) {
                    case '/health':
                        return this._handleHealth(req, res);
                    case '/metrics':
                        return this._handleMetrics(req, res);
                    case '/status':
                        return this._handleStatus(req, res);
                    case '/':
                        res.setHeader('Content-Type', 'text/html');
                        return this._handleDashboard(req, res);
                    default:
                        res.writeHead(404);
                        return res.end(JSON.stringify({ error: 'Not found' }));
                }
            } catch (error) {
                logger.error('Dashboard error:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        });

        this.server.listen(this.port, () => {
            logger.info('Dashboard running on http://localhost:' + this.port);
        });

        this.server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.warn('Dashboard port ' + this.port + ' in use, skipping dashboard');
            } else {
                logger.error('Dashboard server error:', err);
            }
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    _handleHealth(req, res) {
        const status = {};
        for (const [name, provider] of Object.entries(this.statusProviders)) {
            try { status[name] = provider(); } catch (e) { status[name] = 'error'; }
        }

        const healthy = status.whatsapp === 'connected' || status.whatsapp === true;
        res.writeHead(healthy ? 200 : 503);
        res.end(JSON.stringify({
            status: healthy ? 'healthy' : 'degraded',
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            components: status,
            timestamp: new Date().toISOString(),
        }));
    }

    _handleMetrics(req, res) {
        try {
            const contacts = Contact.getAll().length;
            const totalMessages = MessageMap.getCount();
            const incomingMessages = MessageMap.getCount('incoming');
            const outgoingMessages = MessageMap.getCount('outgoing');
            const callRecords = CallRecord.getRecent(9999).length;
            const scheduledPending = ScheduledMessage.getUpcoming().length;
            const mutedContacts = Contact.getMuted().length;
            const archivedContacts = Contact.getArchived().length;

            const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const memUsage = process.memoryUsage();

            // Prometheus-compatible text format
            const accept = req.headers['accept'] || '';
            if (accept.includes('text/plain') || req.url.includes('format=prometheus')) {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.writeHead(200);
                const lines = [
                    '# HELP bridge_uptime_seconds Bridge uptime in seconds',
                    '# TYPE bridge_uptime_seconds gauge',
                    'bridge_uptime_seconds ' + uptimeSeconds,
                    '# HELP bridge_contacts_total Total number of active contacts',
                    '# TYPE bridge_contacts_total gauge',
                    'bridge_contacts_total ' + contacts,
                    '# HELP bridge_messages_total Total messages bridged',
                    '# TYPE bridge_messages_total counter',
                    'bridge_messages_total{direction="incoming"} ' + incomingMessages,
                    'bridge_messages_total{direction="outgoing"} ' + outgoingMessages,
                    '# HELP bridge_calls_total Total calls recorded',
                    '# TYPE bridge_calls_total counter',
                    'bridge_calls_total ' + callRecords,
                    '# HELP bridge_scheduled_pending Pending scheduled messages',
                    '# TYPE bridge_scheduled_pending gauge',
                    'bridge_scheduled_pending ' + scheduledPending,
                    '# HELP bridge_contacts_muted Muted contacts',
                    '# TYPE bridge_contacts_muted gauge',
                    'bridge_contacts_muted ' + mutedContacts,
                    '# HELP bridge_contacts_archived Archived contacts',
                    '# TYPE bridge_contacts_archived gauge',
                    'bridge_contacts_archived ' + archivedContacts,
                    '# HELP bridge_memory_bytes Memory usage in bytes',
                    '# TYPE bridge_memory_bytes gauge',
                    'bridge_memory_bytes{type="rss"} ' + memUsage.rss,
                    'bridge_memory_bytes{type="heapUsed"} ' + memUsage.heapUsed,
                    'bridge_memory_bytes{type="heapTotal"} ' + memUsage.heapTotal,
                ];
                return res.end(lines.join('\n') + '\n');
            }

            // JSON format
            res.writeHead(200);
            res.end(JSON.stringify({
                uptime_seconds: uptimeSeconds,
                contacts: { active: contacts, muted: mutedContacts, archived: archivedContacts },
                messages: { total: totalMessages, incoming: incomingMessages, outgoing: outgoingMessages },
                calls: callRecords,
                scheduled_pending: scheduledPending,
                memory: {
                    rss_mb: (memUsage.rss / 1024 / 1024).toFixed(2),
                    heap_used_mb: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
                    heap_total_mb: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
                },
                timestamp: new Date().toISOString(),
            }, null, 2));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Failed to collect metrics' }));
        }
    }

    _handleStatus(req, res) {
        const status = {};
        for (const [name, provider] of Object.entries(this.statusProviders)) {
            try { status[name] = provider(); } catch (e) { status[name] = 'error'; }
        }
        res.writeHead(200);
        res.end(JSON.stringify({
            components: status,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            timestamp: new Date().toISOString(),
        }, null, 2));
    }

    _handleDashboard(req, res) {
        const uptimeMin = Math.floor((Date.now() - this.startTime) / 60000);
        let contacts = 0, messages = 0, calls = 0;
        try { contacts = Contact.getAll().length; } catch (e) { }
        try { messages = MessageMap.getCount(); } catch (e) { }
        try { calls = CallRecord.getRecent(9999).length; } catch (e) { }

        const statusInfo = {};
        for (const [name, provider] of Object.entries(this.statusProviders)) {
            try { statusInfo[name] = provider(); } catch (e) { statusInfo[name] = 'error'; }
        }

        const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WA-TG Bridge Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:2rem}
h1{text-align:center;margin-bottom:2rem;font-size:1.8rem;background:linear-gradient(135deg,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;max-width:900px;margin:0 auto 2rem}
.card{background:#1e293b;border-radius:12px;padding:1.5rem;text-align:center;border:1px solid #334155}
.card h3{font-size:.85rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem}
.card .value{font-size:2rem;font-weight:700;color:#38bdf8}
.card .value.ok{color:#4ade80} .card .value.err{color:#f87171}
.status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem;max-width:900px;margin:0 auto}
.status-item{background:#1e293b;border-radius:8px;padding:1rem;border:1px solid #334155;display:flex;justify-content:space-between;align-items:center}
.status-item .dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}
.dot.green{background:#4ade80} .dot.red{background:#f87171} .dot.yellow{background:#fbbf24}
footer{text-align:center;margin-top:2rem;color:#64748b;font-size:.8rem}
</style>
</head><body>
<h1>🌉 WhatsApp-Telegram Bridge</h1>
<div class="grid">
<div class="card"><h3>Uptime</h3><div class="value">${uptimeMin}m</div></div>
<div class="card"><h3>Contacts</h3><div class="value">${contacts}</div></div>
<div class="card"><h3>Messages</h3><div class="value">${messages}</div></div>
<div class="card"><h3>Calls</h3><div class="value">${calls}</div></div>
</div>
<div class="status-grid">
${Object.entries(statusInfo).map(([k, v]) => {
            const ok = v === 'connected' || v === true || v === 'ready';
            return '<div class="status-item"><span><span class="dot ' + (ok ? 'green' : 'red') + '"></span>' + k + '</span><span>' + String(v) + '</span></div>';
        }).join('')}
</div>
<footer>Auto-refreshes in 30s &bull; <a href="/health" style="color:#38bdf8">/health</a> &bull; <a href="/metrics" style="color:#38bdf8">/metrics</a> &bull; <a href="/metrics?format=prometheus" style="color:#38bdf8">/metrics (prometheus)</a></footer>
<script>setTimeout(()=>location.reload(),30000)</script>
</body></html>`;

        res.writeHead(200);
        res.end(html);
    }
}

module.exports = new DashboardService();
