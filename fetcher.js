// ─── Twelve Data — récupération OHLCV multi-TF ───────────────
// Free tier : 800 crédits/jour, 8 req/min
// 1 requête batch (plusieurs symboles) = 1 crédit par symbole

const BASE = 'https://api.twelvedata.com';

// ─── Binance Futures — Funding Rate (public, sans clé) ───────
const BINANCE_MAP = { 'BTC/USD': 'BTCUSDT', 'ETH/USD': 'ETHUSDT' };

async function fetchFundingRates(pairs) {
  const cryptoPairs = pairs.filter(p => BINANCE_MAP[p]);
  if (!cryptoPairs.length) return {};
  const result = {};
  await Promise.all(cryptoPairs.map(async (pair) => {
    try {
      const sym = BINANCE_MAP[pair];
      const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`);
      if (!res.ok) return;
      const d = await res.json();
      const rate = parseFloat(d.lastFundingRate);
      result[pair] = {
        fundingRate:     rate,
        nextFundingTime: d.nextFundingTime,
        markPrice:       parseFloat(d.markPrice),
        bias: rate > 0.0005  ? 'LONGS_HEAVY'
            : rate < -0.0001 ? 'SHORTS_HEAVY'
            : 'NEUTRAL',
      };
    } catch {}
  }));
  return result;
}

// Pause pour respecter la limite 8 req/min
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchCandles(symbols, interval, apiKey, outputsize = 100, attempt = 1) {
  const url = `${BASE}/time_series?symbol=${encodeURIComponent(symbols.join(','))}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&format=JSON`;
  const res = await fetch(url);

  // 429 → on attend 70s et on réessaie (max 3 tentatives)
  if (res.status === 429) {
    if (attempt >= 3) throw new Error(`Twelve Data 429 — limite atteinte après ${attempt} tentatives`);
    console.log(`[fetcher] 429 sur ${interval} — attente 70s avant tentative ${attempt + 1}/3...`);
    await sleep(70_000);
    return fetchCandles(symbols, interval, apiKey, outputsize, attempt + 1);
  }

  if (!res.ok) throw new Error(`Twelve Data ${res.status} pour ${interval}`);
  const data = await res.json();

  if (data.code && data.code !== 200) {
    throw new Error(data.message || `Erreur Twelve Data : ${data.code}`);
  }

  // Normalise : 1 symbole → objet direct ; plusieurs → objet keyed
  if (symbols.length === 1) {
    const sym = symbols[0];
    if (!data.values) throw new Error(`Pas de données pour ${sym}`);
    return { [sym]: data.values };
  }

  const result = {};
  for (const sym of symbols) {
    if (data[sym]?.values) result[sym] = data[sym].values;
  }
  return result;
}

// Récupère 4H + 1H + 15M pour toutes les paires
// Free tier : 8 crédits/min, 1 crédit par symbole par requête
// Stratégie : 1 requête par TF avec tous les symboles, 45s entre chaque TF
// → 3 requêtes × 5 symboles = 15 crédits en ~90s ≈ 10 crédits/min (safe)
async function fetchAllPairs(pairs, apiKey) {
  const intervals = ['4h', '1h', '15min'];
  const result = {};
  for (const pair of pairs) result[pair] = {};

  for (let i = 0; i < intervals.length; i++) {
    if (i > 0) {
      console.log(`[fetcher] Pause 65s (rate limit Twelve Data)...`);
      await sleep(65_000);
    }
    const interval = intervals[i];
    console.log(`[fetcher] Récupération ${interval} pour ${pairs.join(', ')}`);
    const data = await fetchCandles(pairs, interval, apiKey);
    mergeData(data, interval, result);
  }

  return result;
}

function mergeData(batchData, interval, result) {
  const tfKey = { '4h': 'tf4h', '1h': 'tf1h', '15min': 'tf15m' }[interval];
  for (const [sym, values] of Object.entries(batchData)) {
    if (!result[sym]) result[sym] = {};
    result[sym][tfKey] = values;
  }
}

module.exports = { fetchAllPairs, fetchFundingRates };
