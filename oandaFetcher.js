// ─── OANDA Practice API — Tick Volume ─────────────────────────
// Compte démo gratuit — https://www.oanda.com/fr-fr/trading/

const OANDA_URL = 'https://api-fxpractice.oanda.com/v3';

const PAIR_MAP = {
  'EUR/USD': 'EUR_USD', 'GBP/USD': 'GBP_USD', 'GBP/JPY': 'GBP_JPY',
  'XAU/USD': 'XAU_USD', 'XAG/USD': 'XAG_USD',
};

const TF_MAP = { '15min': 'M15', '1h': 'H1', '4h': 'H4' };

async function fetchOandaCandles(pair, tf, apiKey, count = 100) {
  const instrument = PAIR_MAP[pair] || pair.replace('/', '_');
  const granularity = TF_MAP[tf] || tf;
  const url = `${OANDA_URL}/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OANDA ${res.status} pour ${pair} ${tf}`);
  const data = await res.json();
  return (data.candles || []).filter(c => c.complete);
}

// Récupère le volume 15M et 1H pour toutes les paires en parallèle
async function fetchVolumeData(pairs, apiKey) {
  if (!apiKey) return {};
  const result = {};

  await Promise.all(pairs.map(async (pair) => {
    try {
      const [c15m, c1h] = await Promise.all([
        fetchOandaCandles(pair, '15min', apiKey, 100),
        fetchOandaCandles(pair, '1h',    apiKey, 80),
      ]);
      result[pair] = {
        tf15m: c15m.map(c => ({ time: c.time, volume: c.volume })),
        tf1h:  c1h.map(c => ({ time: c.time, volume: c.volume })),
      };
    } catch (e) {
      console.error(`[oanda] ${pair} : ${e.message}`);
    }
  }));

  return result;
}

// Calcule le seuil de haut volume (moyenne × multiplicateur)
function avgVolume(candles, period = 20) {
  if (!candles || candles.length < 5) return 0;
  const slice = candles.slice(-Math.min(period, candles.length));
  return slice.reduce((s, c) => s + (c.volume || 0), 0) / slice.length;
}

// Retourne un Set des timestamps-minute correspondant à des bougies haut volume
function buildHighVolSet(oandaCandles, multiplier = 1.5) {
  if (!oandaCandles?.length) return new Set();
  const threshold = avgVolume(oandaCandles) * multiplier;
  const set = new Set();
  for (const c of oandaCandles) {
    if ((c.volume || 0) >= threshold) {
      set.add(Math.floor(new Date(c.time).getTime() / 60_000));
    }
  }
  return set;
}

module.exports = { fetchVolumeData, buildHighVolSet };
