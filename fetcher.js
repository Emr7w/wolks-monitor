// ─── Twelve Data — récupération OHLCV multi-TF ───────────────
// Free tier : 800 crédits/jour, 8 req/min
// 1 requête batch (plusieurs symboles) = 1 crédit par symbole

const BASE = 'https://api.twelvedata.com';

// Pause pour respecter la limite 8 req/min
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchCandles(symbols, interval, apiKey, outputsize = 100) {
  const url = `${BASE}/time_series?symbol=${encodeURIComponent(symbols.join(','))}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&format=JSON`;
  const res = await fetch(url);
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
// Utilise des requêtes batch pour économiser les crédits
async function fetchAllPairs(pairs, apiKey) {
  const BATCH1 = pairs.slice(0, 3);
  const BATCH2 = pairs.slice(3);
  const intervals = ['4h', '1h', '15min'];
  const result = {};

  for (const pair of pairs) result[pair] = {};

  for (const interval of intervals) {
    await sleep(500); // 8 req/min = 1 req / 7.5s → 500ms entre batches suffit
    const b1data = await fetchCandles(BATCH1, interval, apiKey);
    Object.assign(result, mergeData(b1data, interval, result));

    if (BATCH2.length > 0) {
      await sleep(500);
      const b2data = await fetchCandles(BATCH2, interval, apiKey);
      Object.assign(result, mergeData(b2data, interval, result));
    }
  }

  return result;
}

function mergeData(batchData, interval, result) {
  const tfKey = { '4h': 'tf4h', '1h': 'tf1h', '15min': 'tf15m' }[interval];
  for (const [sym, values] of Object.entries(batchData)) {
    if (!result[sym]) result[sym] = {};
    result[sym][tfKey] = values;
  }
  return result;
}

module.exports = { fetchAllPairs };
