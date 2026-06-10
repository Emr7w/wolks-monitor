// ─── WOLKS Monitor — Express API ──────────────────────────────
const express = require('express');
const cors    = require('cors');
const { start, state, updateConfig, getConfig, runScan } = require('./watcher');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Buffer de logs (200 lignes max) ──────────────────────────
const logBuffer = [];
const _log   = console.log.bind(console);
const _error = console.error.bind(console);

function pushLog(level, args) {
  const line = { time: new Date().toISOString(), level, msg: args.map(String).join(' ') };
  logBuffer.push(line);
  if (logBuffer.length > 200) logBuffer.shift();
}

console.log   = (...a) => { pushLog('info',  a); _log(...a);   };
console.error = (...a) => { pushLog('error', a); _error(...a); };

// ─── Endpoints ─────────────────────────────────────────────────

// Santé du serveur
app.get('/health', (_, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' });
});

// Statut global + état par paire
app.get('/status', (_, res) => {
  const cfg = getConfig();
  res.json({
    lastScan:    state.lastScan,
    scanning:    state.scanning,
    pairs:       state.pairs,
    errors:      state.errors.slice(-5),
    sessionOnly: cfg.sessionOnly,
    interval:    cfg.intervalMin,
    threshold:   cfg.threshold,
    monitoredPairs: cfg.pairs,
  });
});

// Historique des 50 dernières alertes
app.get('/alerts', (_, res) => {
  res.json({ alerts: state.alerts });
});

// Logs en temps réel (dernières N lignes)
app.get('/logs', (req, res) => {
  const n = Math.min(parseInt(req.query.n || '50'), 200);
  res.json({ logs: logBuffer.slice(-n) });
});

// Forcer un scan immédiat (ne pas attendre le cron)
app.post('/scan', (_, res) => {
  if (state.scanning) return res.json({ ok: false, msg: 'Scan déjà en cours' });
  runScan().catch(() => {});
  res.json({ ok: true, msg: 'Scan lancé' });
});

// Mettre à jour la config (pairs, threshold, etc.) sans redémarrer
app.post('/config', (req, res) => {
  const { twelveDataKey, ntfyTopic, pairs, threshold, sessionOnly, intervalMin } = req.body;
  const patch = {};
  if (twelveDataKey !== undefined) patch.twelveDataKey = twelveDataKey;
  if (ntfyTopic     !== undefined) patch.ntfyTopic     = ntfyTopic;
  if (pairs          !== undefined) patch.pairs          = pairs;
  if (threshold      !== undefined) patch.threshold      = Number(threshold);
  if (sessionOnly    !== undefined) patch.sessionOnly    = Boolean(sessionOnly);
  if (intervalMin    !== undefined) patch.intervalMin    = Number(intervalMin);
  updateConfig(patch);
  res.json({ ok: true, config: getConfig() });
});

// ─── Démarrage ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] WOLKS Monitor écoute sur le port ${PORT}`);
  start();
});
