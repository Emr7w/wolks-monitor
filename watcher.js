// ─── Watcher — Scan cyclique toutes les 30 min ────────────────
const cron           = require('node-cron');
const { fetchAllPairs } = require('./fetcher');
const { analyzeTF, getSession } = require('./analyzer');
const { score }      = require('./scorer');
const { notify, notifyRaw } = require('./notifier');
const { isNewsBlocked, loadCalendar } = require('./newsFilter');

// État partagé (lu par server.js via les getters)
const state = {
  lastScan:   null,
  scanning:   false,
  pairs:      {},   // { 'EUR/USD': { score, direction, signals, priority, lastAlert } }
  alerts:     [],   // historique des 50 dernières alertes
  errors:     [],
};

let config = {
  twelveDataKey:       process.env.TWELVE_DATA_KEY || '',
  ntfyTopic:           process.env.NTFY_TOPIC || '',
  pairs:               (process.env.PAIRS || 'EUR/USD,GBP/USD,GBP/JPY,XAU/USD,XAG/USD').split(',').map(p => p.trim()),
  threshold:           parseInt(process.env.CONFLUENCE_THRESHOLD || '5'),
  sessionOnly:         process.env.SESSION_ONLY !== 'false',
  intervalMin:         parseInt(process.env.SCAN_INTERVAL_MIN || '15'),
};

// ─── Scan principal ───────────────────────────────────────────
async function runScan() {
  if (state.scanning) return;
  if (!config.twelveDataKey) {
    state.errors.push({ time: new Date().toISOString(), msg: 'TWELVE_DATA_KEY manquant' });
    return;
  }

  // En dehors des sessions → skip si sessionOnly
  const session = getSession();
  if (config.sessionOnly && !session.active) {
    state.lastScan = new Date().toISOString();
    console.log(`[watcher] Hors session (${new Date().toUTCString()}) — scan ignoré`);
    return;
  }

  state.scanning = true;
  console.log(`[watcher] Scan démarré — ${new Date().toUTCString()}`);

  try {
    const raw = await fetchAllPairs(config.pairs, config.twelveDataKey);

    for (const pair of config.pairs) {
      const data = raw[pair];
      if (!data?.tf4h || !data?.tf1h || !data?.tf15m) continue;

      const tf4h  = analyzeTF(data.tf4h);
      const tf1h  = analyzeTF(data.tf1h);
      const tf15m = analyzeTF(data.tf15m);

      if (!tf4h || !tf1h || !tf15m) continue;

      const result = score(tf4h, tf1h, tf15m);
      if (!result) continue;

      // Mise à jour de l'état
      state.pairs[pair] = {
        ...result,
        pair,
        scanTime: new Date().toISOString(),
        rsi15m:   tf15m.rsi?.toFixed(0),
        rsi1h:    tf1h.rsi?.toFixed(0),
        trend4h:  tf4h.structure?.trend,
        trend1h:  tf1h.structure?.trend,
        session:  tf15m.session?.name || null,
      };

      console.log(`[watcher] ${pair} → ${result.direction || 'NEUTRE'} score=${result.totalScore} (${result.priority})`);

      // Notification si score suffisant
      if (result.priority !== 'NONE' && result.totalScore >= config.threshold && result.direction) {
        const last = state.pairs[pair]?.lastAlert;
        const cooldown = 90 * 60 * 1000;
        if (!last || Date.now() - new Date(last).getTime() > cooldown) {

          // Filtre news avant d'alerter
          const news = await isNewsBlocked(pair);
          if (news.blocked) {
            console.log(`[watcher] ${pair} bloqué — ${news.reason}`);
            state.pairs[pair].newsBlock = news.reason;
            continue;
          }
          state.pairs[pair].newsBlock = null;

          state.pairs[pair].lastAlert = new Date().toISOString();
          const sent = await notify(config.ntfyTopic, { ...result, pair });
          if (sent) {
            const alert = {
              pair, direction: result.direction, score: result.totalScore,
              priority: result.priority, price: result.price,
              signals: result.signals.slice(0, 5),
              time: new Date().toISOString(),
            };
            state.alerts.unshift(alert);
            if (state.alerts.length > 50) state.alerts.pop();
            console.log(`[watcher] 🔔 Notification envoyée : ${pair} ${result.direction}`);
          }
        }
      }
    }

    state.lastScan = new Date().toISOString();
    state.errors   = state.errors.slice(-10);
  } catch (err) {
    console.error('[watcher] Erreur scan :', err.message);
    state.errors.push({ time: new Date().toISOString(), msg: err.message });
  } finally {
    state.scanning = false;
  }
}

// ─── Démarrage ────────────────────────────────────────────────
function start() {
  // Délai initial pour laisser la fenêtre rate-limit se réinitialiser après un redéploiement
  console.log('[watcher] Démarrage dans 70s (fenêtre rate-limit)...');
  setTimeout(runScan, 70_000);

  // Cron selon l'intervalle configuré (défaut 30 min)
  const min = config.intervalMin;
  const expr = min === 15  ? '*/15 * * * *'
             : min === 30  ? '*/30 * * * *'
             : min === 60  ? '0 * * * *'
             : `*/${min} * * * *`;

  cron.schedule(expr, runScan);
  console.log(`[watcher] Cron démarré — scan toutes les ${min} min`);

  // Calendrier chargé au premier scan (lazy) pour éviter le 429 au démarrage
  if (config.ntfyTopic) {
    notifyRaw(config.ntfyTopic, '🚀 WOLKS Scanner démarré', `Surveillance active : ${config.pairs.join(', ')}`, 'low');
  }
}

function updateConfig(newCfg) {
  Object.assign(config, newCfg);
}

module.exports = { start, runScan, state, updateConfig, getConfig: () => config };
