// ─── Analyse Technique — FVG, OB, BOS, CHoCH, RSI, ATR, Liquidité ───

function toNum(v) { return parseFloat(v); }

// Twelve Data retourne les bougies du plus récent au plus ancien → on inverse
function prepareCandles(raw) {
  return raw.slice().reverse().map(c => ({
    time:   c.datetime,
    open:   toNum(c.open),
    high:   toNum(c.high),
    low:    toNum(c.low),
    close:  toNum(c.close),
    volume: toNum(c.volume || 0),
  }));
}

// ─── ATR (Average True Range) ─────────────────────────────────
function calcATR(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    ));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// ─── RSI ──────────────────────────────────────────────────────
function calcRSI(candles, period = 14) {
  const closes = candles.map(c => c.close);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// ─── FVG (Fair Value Gap / Imbalance) ────────────────────────
function detectFVGs(candles, lookback = 60) {
  const recent  = candles.slice(-lookback);
  const price   = candles[candles.length - 1].close;
  const atr     = calcATR(candles);
  const tol     = atr * 0.5;
  const results = [];

  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i - 1];
    const next = recent[i + 1];

    // Bullish FVG : le bas de next > le haut de prev
    if (next.low > prev.high) {
      const top    = next.low;
      const bottom = prev.high;
      const inZone = price >= bottom && price <= top;
      const near   = price > top && price <= top + tol;
      if (inZone || near) {
        results.push({ type: 'BULLISH', top, bottom, inZone, near, time: recent[i].time });
      }
    }

    // Bearish FVG : le haut de next < le bas de prev
    if (next.high < prev.low) {
      const top    = prev.low;
      const bottom = next.high;
      const inZone = price >= bottom && price <= top;
      const near   = price < bottom && price >= bottom - tol;
      if (inZone || near) {
        results.push({ type: 'BEARISH', top, bottom, inZone, near, time: recent[i].time });
      }
    }
  }
  return results.slice(-4);
}

// ─── Order Blocks ─────────────────────────────────────────────
function detectOBs(candles, lookback = 80, highVolSet = null) {
  const recent  = candles.slice(-lookback);
  const price   = candles[candles.length - 1].close;
  const atr     = calcATR(candles);
  const minMove = atr * 1.5;
  const tol     = atr * 0.4;
  const results = [];

  for (let i = 1; i < recent.length - 1; i++) {
    const curr = recent[i];
    const next = recent[i + 1];
    const move = Math.abs(next.close - curr.open);
    if (move < minMove) continue;

    // Validation volume OANDA (si disponible)
    const candleMin  = curr.time ? Math.floor(new Date(curr.time).getTime() / 60_000) : null;
    const highVolume = highVolSet && candleMin ? highVolSet.has(candleMin) : false;

    if (next.close > curr.open && curr.close < curr.open) {
      const top    = curr.open;
      const bottom = curr.close;
      const inZone = price >= bottom && price <= top;
      const near   = price > top && price <= top + tol;
      if (inZone || near) {
        results.push({ type: 'DEMAND', top, bottom, mid: (top + bottom) / 2, inZone, near, highVolume, time: curr.time });
      }
    } else if (next.close < curr.open && curr.close > curr.open) {
      const top    = curr.close;
      const bottom = curr.open;
      const inZone = price >= bottom && price <= top;
      const near   = price < bottom && price >= bottom - tol;
      if (inZone || near) {
        results.push({ type: 'SUPPLY', top, bottom, mid: (top + bottom) / 2, inZone, near, highVolume, time: curr.time });
      }
    }
  }
  return results.slice(-4);
}

// ─── Structure (Swing H/L → BOS / CHoCH) ─────────────────────
function detectStructure(candles, lookback = 80) {
  const recent = candles.slice(-lookback);
  const price  = candles[candles.length - 1].close;
  const swingH = [], swingL = [];

  for (let i = 3; i < recent.length - 3; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swingH.push({ price: recent[i].high, time: recent[i].time });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low  && recent[i].low < recent[i+2].low) {
      swingL.push({ price: recent[i].low, time: recent[i].time });
    }
  }

  let trend = 'RANGING';
  let lastBOS = null, lastCHoCH = null;

  if (swingH.length >= 2 && swingL.length >= 2) {
    const lH  = swingH[swingH.length - 1];
    const pH  = swingH[swingH.length - 2];
    const lL  = swingL[swingL.length - 1];
    const pL  = swingL[swingL.length - 2];

    if (lH.price > pH.price && lL.price > pL.price) trend = 'BULLISH';
    if (lH.price < pH.price && lL.price < pL.price) trend = 'BEARISH';

    // BOS : cassure du dernier swing dans la direction opposée à la tendance
    if (trend === 'BEARISH' && price > lH.price) {
      lastBOS = { direction: 'UP', level: lH.price };
    }
    if (trend === 'BULLISH' && price < lL.price) {
      lastBOS = { direction: 'DOWN', level: lL.price };
    }

    // CHoCH : premier signe de retournement (approche du niveau)
    if (trend === 'BEARISH' && price > lH.price * 0.998) {
      lastCHoCH = { direction: 'UP', level: lH.price, swingTime: lH.time };
    }
    if (trend === 'BULLISH' && price < lL.price * 1.002) {
      lastCHoCH = { direction: 'DOWN', level: lL.price, swingTime: lL.time };
    }
  }

  return { trend, lastBOS, lastCHoCH, swingHighs: swingH.slice(-3), swingLows: swingL.slice(-3) };
}

// ─── Niveaux de liquidité (Equal Highs/Lows) ─────────────────
function detectLiquidity(candles, lookback = 40) {
  const recent  = candles.slice(-lookback);
  const price   = candles[candles.length - 1].close;
  const atr     = calcATR(candles);
  const tol     = atr * 0.3;
  const levels  = [];

  for (let i = 0; i < recent.length - 5; i++) {
    for (let j = i + 5; j < recent.length; j++) {
      if (Math.abs(recent[i].high - recent[j].high) < tol) {
        const lvl = (recent[i].high + recent[j].high) / 2;
        if (Math.abs(price - lvl) < atr * 1.5 && !levels.find(l => l.type === 'EQH' && Math.abs(l.price - lvl) < tol)) {
          levels.push({ type: 'EQH', price: lvl, approaching: Math.abs(price - lvl) < atr * 0.5 });
        }
      }
      if (Math.abs(recent[i].low - recent[j].low) < tol) {
        const lvl = (recent[i].low + recent[j].low) / 2;
        if (Math.abs(price - lvl) < atr * 1.5 && !levels.find(l => l.type === 'EQL' && Math.abs(l.price - lvl) < tol)) {
          levels.push({ type: 'EQL', price: lvl, approaching: Math.abs(price - lvl) < atr * 0.5 });
        }
      }
    }
  }
  return levels.slice(0, 4);
}

// ─── Session UTC ──────────────────────────────────────────────
function getSession() {
  const now  = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const asia   = mins >= 0    && mins < 480;   // 00h-08h UTC
  const london = mins >= 480  && mins < 960;   // 08h-16h UTC
  const ny     = mins >= 780  && mins < 1260;  // 13h-21h UTC
  const active = asia || london || ny;
  const name   = london && ny ? 'London/New York' : london ? 'London' : ny ? 'New York' : asia ? 'Asia' : null;
  return { active, name, asia, london, ny };
}

// ─── Haut volume (tick volume Twelve Data) ────────────────────
function buildHighVolSet(candles, multiplier = 1.5) {
  if (!candles || candles.length < 5) return new Set();
  const period = Math.min(20, candles.length);
  const avg = candles.slice(-period).reduce((s, c) => s + (c.volume || 0), 0) / period;
  if (avg === 0) return new Set(); // pas de données volume — on n'invente rien
  const threshold = avg * multiplier;
  const set = new Set();
  for (const c of candles) {
    if ((c.volume || 0) >= threshold && c.time) {
      set.add(Math.floor(new Date(c.time).getTime() / 60_000));
    }
  }
  return set;
}

// ─── Analyse complète d'une paire sur un TF ───────────────────
function analyzeTF(rawCandles) {
  if (!rawCandles || rawCandles.length < 20) return null;
  const candles    = prepareCandles(rawCandles);
  const highVolSet = buildHighVolSet(candles);
  const price      = candles[candles.length - 1].close;
  const atr        = calcATR(candles);
  const rsi        = calcRSI(candles);
  const fvgs       = detectFVGs(candles);
  const obs        = detectOBs(candles, 80, highVolSet);
  const structure    = detectStructure(candles);
  const liquidity    = detectLiquidity(candles);
  const session      = getSession();
  const period       = Math.min(20, candles.length);
  const avgVol       = candles.slice(-period).reduce((s, c) => s + (c.volume || 0), 0) / period;
  const lastVol      = candles[candles.length - 1].volume || 0;
  const volRatio     = avgVol > 0 ? parseFloat((lastVol / avgVol).toFixed(2)) : null;
  const confirmation = detectConfirmation(candles);
  return { price, atr, rsi, fvgs, obs, structure, liquidity, session, volRatio, confirmation };
}

// ─── Figure de confirmation 15M ───────────────────────────────
function detectConfirmation(candles) {
  if (!candles || candles.length < 3) return { bull: false, bear: false, pattern: null };
  const c1 = candles[candles.length - 1]; // dernière bougie
  const c2 = candles[candles.length - 2];

  const range1  = (c1.high - c1.low) || 0.0001;
  const body1   = Math.abs(c1.close - c1.open);
  const lower1  = Math.min(c1.open, c1.close) - c1.low;
  const upper1  = c1.high - Math.max(c1.open, c1.close);

  // Engulfing haussier
  const bullEngulf = c2.close < c2.open && c1.close > c1.open
                  && c1.open <= c2.close && c1.close >= c2.open;
  // Hammer / Pin bar haussier : mèche basse > 60% de la range
  const bullPin    = lower1 > range1 * 0.6 && body1 < range1 * 0.35;

  // Engulfing baissier
  const bearEngulf = c2.close > c2.open && c1.close < c1.open
                  && c1.open >= c2.close && c1.close <= c2.open;
  // Shooting star / Pin bar baissier : mèche haute > 60% de la range
  const bearPin    = upper1 > range1 * 0.6 && body1 < range1 * 0.35;

  const bull = bullEngulf || bullPin;
  const bear = bearEngulf || bearPin;
  const pattern = bullEngulf ? 'Engulfing haussier'
                : bullPin    ? 'Hammer / Pin bar'
                : bearEngulf ? 'Engulfing baissier'
                : bearPin    ? 'Shooting star / Pin bar'
                : null;

  return { bull, bear, pattern };
}

module.exports = { analyzeTF, getSession };
