// ─── Watcher — Scan cyclique toutes les 30 min ────────────────
const cron           = require('node-cron');

function parisTime() {
  return new Date().toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}
const { fetchAllPairs, fetchFundingRates } = require('./fetcher');
const { analyzeTF, getSession } = require('./analyzer');
const { score }      = require('./scorer');
const { notify, notifyRaw } = require('./notifier');
const { isNewsBlocked, loadCalendar } = require('./newsFilter');

// ─── Modes de scan ────────────────────────────────────────────
const MODE_PAIRS = {
  forex:   ['EUR/USD', 'GBP/USD', 'GBP/JPY', 'XAU/USD', 'XAG/USD', 'USD/JPY', 'AUD/USD'],
  indices: ['SPX', 'DJI'],
  crypto:  ['BTC/USD', 'ETH/USD'],
  actions: [], // paires actions à ajouter selon besoins
};

let activeScanMode = process.env.DEFAULT_SCAN_MODE || 'forex';

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
  pairs:               (process.env.PAIRS || 'EUR/USD,GBP/USD,GBP/JPY,XAU/USD,XAG/USD,USD/JPY,AUD/USD,SPX,DJI,BTC/USD,ETH/USD').split(',').map(p => p.trim()),
  threshold:           parseInt(process.env.CONFLUENCE_THRESHOLD || '5'),
  sessionOnly:         process.env.SESSION_ONLY !== 'false',
  intervalMin:         parseInt(process.env.SCAN_INTERVAL_MIN || '30'),
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
  const activePairs = MODE_PAIRS[activeScanMode]?.length
    ? MODE_PAIRS[activeScanMode]
    : config.pairs;
  console.log(`[watcher] Scan démarré — mode=${activeScanMode} (${activePairs.length} paires) — ${new Date().toUTCString()}`);

  try {
    const raw         = await fetchAllPairs(activePairs, config.twelveDataKey);
    const fundingData = await fetchFundingRates(activePairs);

    for (const pair of activePairs) {
      const data = raw[pair];
      if (!data?.tf4h || !data?.tf1h || !data?.tf15m) continue;

      const tf4h  = analyzeTF(data.tf4h);
      const tf1h  = analyzeTF(data.tf1h);
      const tf15m = analyzeTF(data.tf15m);

      if (!tf4h || !tf1h || !tf15m) continue;

      const result = score(tf4h, tf1h, tf15m);
      if (!result) continue;

      // Bonus funding rate pour les cryptos
      const fd = fundingData[pair];
      if (fd && result.direction) {
        if (result.direction === 'LONG'  && fd.bias === 'SHORTS_HEAVY') {
          result.totalScore += 1;
          result.signals.push(`Funding ${(fd.fundingRate * 100).toFixed(4)}% — shorts surchargés → confluence LONG`);
        } else if (result.direction === 'SHORT' && fd.bias === 'LONGS_HEAVY') {
          result.totalScore += 1;
          result.signals.push(`Funding ${(fd.fundingRate * 100).toFixed(4)}% — longs surchargés → confluence SHORT`);
        }
      }

      // Mise à jour de l'état
      state.pairs[pair] = {
        ...result,
        pair,
        scanTime:    new Date().toISOString(),
        rsi15m:      tf15m.rsi?.toFixed(0),
        rsi1h:       tf1h.rsi?.toFixed(0),
        trend4h:     tf4h.structure?.trend,
        trend1h:     tf1h.structure?.trend,
        session:     tf15m.session?.name || null,
        volRatio15m: tf15m.volRatio,
        volRatio1h:  tf1h.volRatio,
        fundingRate: fd?.fundingRate ?? null,
        fundingBias: fd?.bias        ?? null,
      };

      console.log(`[watcher] ${pair} → ${result.direction || 'NEUTRE'} score=${result.totalScore} (${result.priority})`);

      // Notification si score suffisant
      if (result.priority !== 'NONE' && result.totalScore >= config.threshold && result.direction) {
        const last = state.pairs[pair]?.lastAlert;
        const cooldown = 90 * 60 * 1000;
        if (!last || Date.now() - new Date(last).getTime() > cooldown) {

          // Pas de notification push pendant Asia (setup visible dans Surveillance)
          const sess = getSession();
          if (!sess.london && !sess.ny) {
            console.log(`[watcher] ${pair} — setup détecté (score=${result.totalScore}) mais session Asia → pas de notification`);
            continue;
          }

          // Confirmation 15M requise (engulfing ou pin bar)
          if (!result.confirmed) {
            console.log(`[watcher] ${pair} — score=${result.totalScore} ⏳ attente confirmation 15M`);
            state.pairs[pair].awaitingConfirmation = true;
            continue;
          }
          state.pairs[pair].awaitingConfirmation = false;

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
              time: parisTime(),
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

function setScanMode(mode) {
  if (!MODE_PAIRS.hasOwnProperty(mode)) return false;
  activeScanMode = mode;
  console.log(`[watcher] Mode de scan → ${mode} (${(MODE_PAIRS[mode] || []).join(', ') || 'vide'})`);
  return true;
}

function getActiveScanMode() { return activeScanMode; }
function getModePairs(mode)  { return MODE_PAIRS[mode || activeScanMode] || []; }
function getAllModes()        { return Object.fromEntries(Object.entries(MODE_PAIRS).map(([k, v]) => [k, v])); }

module.exports = { start, runScan, state, updateConfig, getConfig: () => config, setScanMode, getActiveScanMode, getModePairs, getAllModes };
