// ─── Scoring des confluences multi-TF ─────────────────────────
// Entrée : analyse 4H + 1H + 15M
// Sortie : score, direction, signaux filtrés par direction, priorité

function score(tf4h, tf1h, tf15m) {
  if (!tf4h || !tf1h || !tf15m) return null;

  let longScore = 0, shortScore = 0;
  const longSig = [], shortSig = [], sharedSig = [];

  // ─ Filtre RANGING : 4H et 1H tous les deux sans tendance ────
  if (tf4h.structure.trend === 'RANGING' && tf1h.structure.trend === 'RANGING') {
    return { direction: null, longScore: 0, shortScore: 0, totalScore: 0,
      signals: ['✗ Marché en range sur 4H et 1H — signal ignoré'],
      priority: 'NONE', price: tf15m.price, levels: null };
  }

  // ─ Session ──────────────────────────────────────────────────
  if (tf15m.session.active) {
    longScore += 1; shortScore += 1;
    sharedSig.push(`✓ Session ${tf15m.session.name}`);
  }

  // ─ Structure 4H ─────────────────────────────────────────────
  if (tf4h.structure.trend === 'BULLISH') {
    longScore += 2;
    longSig.push('✓ 4H : Structure haussière (HH/HL)');
  }
  if (tf4h.structure.trend === 'BEARISH') {
    shortScore += 2;
    shortSig.push('✓ 4H : Structure baissière (LH/LL)');
  }
  if (tf4h.structure.lastBOS?.direction === 'UP') {
    longScore += 2;
    longSig.push(`✓ 4H : BOS haussier @ ${tf4h.structure.lastBOS.level.toFixed(4)}`);
  }
  if (tf4h.structure.lastBOS?.direction === 'DOWN') {
    shortScore += 2;
    shortSig.push(`✓ 4H : BOS baissier @ ${tf4h.structure.lastBOS.level.toFixed(4)}`);
  }

  // ─ Alignement 1H + 4H ───────────────────────────────────────
  if (tf1h.structure.trend === 'BULLISH' && tf4h.structure.trend === 'BULLISH') {
    longScore += 1;
    longSig.push('✓ 1H : Alignée 4H haussier');
  }
  if (tf1h.structure.trend === 'BEARISH' && tf4h.structure.trend === 'BEARISH') {
    shortScore += 1;
    shortSig.push('✓ 1H : Alignée 4H baissier');
  }

  // ─ Order Blocks 1H ──────────────────────────────────────────
  for (const ob of tf1h.obs) {
    const vol = ob.highVolume ? ' ⚡vol' : '';
    if (ob.type === 'DEMAND' && ob.inZone) { longScore  += ob.highVolume ? 4 : 3; longSig.push(`✓ 1H : DANS OB Demande @ ${ob.mid.toFixed(4)}${vol}`); }
    if (ob.type === 'SUPPLY' && ob.inZone) { shortScore += ob.highVolume ? 4 : 3; shortSig.push(`✓ 1H : DANS OB Supply @ ${ob.mid.toFixed(4)}${vol}`); }
    if (ob.type === 'DEMAND' && ob.near)   { longScore  += 1; longSig.push(`→ 1H : Approche OB Demande @ ${ob.mid.toFixed(4)}${vol}`); }
    if (ob.type === 'SUPPLY' && ob.near)   { shortScore += 1; shortSig.push(`→ 1H : Approche OB Supply @ ${ob.mid.toFixed(4)}${vol}`); }
  }

  // ─ FVG 1H ───────────────────────────────────────────────────
  for (const fvg of tf1h.fvgs) {
    if (fvg.type === 'BULLISH' && fvg.inZone) { longScore  += 2; longSig.push('✓ 1H : Dans FVG haussier'); }
    if (fvg.type === 'BEARISH' && fvg.inZone) { shortScore += 2; shortSig.push('✓ 1H : Dans FVG baissier'); }
  }

  // ─ CHoCH 15M (max 15 bougies = 3h45) ───────────────────────
  const choch = tf15m.structure.lastCHoCH;
  if (choch) {
    const ageMin = choch.swingTime
      ? (Date.now() - new Date(choch.swingTime).getTime()) / 60_000
      : 999;
    const fresh = ageMin <= 225;
    if (choch.direction === 'UP') {
      if (fresh) { longScore  += 2; longSig.push(`✓ 15M : CHoCH haussier — signal d'entrée (${Math.round(ageMin)}min)`); }
      else        { sharedSig.push(`→ 15M : CHoCH haussier périmé (${Math.round(ageMin / 60)}h) — ignoré`); }
    }
    if (choch.direction === 'DOWN') {
      if (fresh) { shortScore += 2; shortSig.push(`✓ 15M : CHoCH baissier — signal d'entrée (${Math.round(ageMin)}min)`); }
      else        { sharedSig.push(`→ 15M : CHoCH baissier périmé (${Math.round(ageMin / 60)}h) — ignoré`); }
    }
  }

  // ─ BOS 15M ──────────────────────────────────────────────────
  if (tf15m.structure.lastBOS?.direction === 'UP')   { longScore  += 1; longSig.push(`✓ 15M : BOS haussier @ ${tf15m.structure.lastBOS.level.toFixed(4)}`); }
  if (tf15m.structure.lastBOS?.direction === 'DOWN')  { shortScore += 1; shortSig.push(`✓ 15M : BOS baissier @ ${tf15m.structure.lastBOS.level.toFixed(4)}`); }

  // ─ Order Blocks 15M ─────────────────────────────────────────
  for (const ob of tf15m.obs) {
    const vol = ob.highVolume ? ' ⚡vol' : '';
    if (ob.type === 'DEMAND' && ob.inZone) { longScore  += ob.highVolume ? 3 : 2; longSig.push(`✓ 15M : Dans OB Demande @ ${ob.mid.toFixed(4)}${vol}`); }
    if (ob.type === 'SUPPLY' && ob.inZone) { shortScore += ob.highVolume ? 3 : 2; shortSig.push(`✓ 15M : Dans OB Supply @ ${ob.mid.toFixed(4)}${vol}`); }
  }

  // ─ FVG 15M ──────────────────────────────────────────────────
  for (const fvg of tf15m.fvgs) {
    if (fvg.type === 'BULLISH' && fvg.inZone) { longScore  += 2; longSig.push('✓ 15M : Dans FVG haussier'); }
    if (fvg.type === 'BEARISH' && fvg.inZone) { shortScore += 2; shortSig.push('✓ 15M : Dans FVG baissier'); }
    if (fvg.type === 'BULLISH' && fvg.near)   { longScore  += 1; longSig.push('→ 15M : Approche FVG haussier'); }
    if (fvg.type === 'BEARISH' && fvg.near)   { shortScore += 1; shortSig.push('→ 15M : Approche FVG baissier'); }
  }

  // ─ RSI filtres ──────────────────────────────────────────────
  if (tf1h.rsi < 35)  { longScore  += 1; longSig.push(`✓ 1H RSI survente : ${tf1h.rsi.toFixed(0)}`); }
  if (tf1h.rsi > 65)  { shortScore += 1; shortSig.push(`✓ 1H RSI surachat : ${tf1h.rsi.toFixed(0)}`); }
  if (tf15m.rsi < 30) { longScore  += 1; longSig.push(`✓ 15M RSI survente : ${tf15m.rsi.toFixed(0)}`); }
  if (tf15m.rsi > 70) { shortScore += 1; shortSig.push(`✓ 15M RSI surachat : ${tf15m.rsi.toFixed(0)}`); }

  // ─ Liquidité proche ─────────────────────────────────────────
  for (const liq of tf15m.liquidity) {
    if (liq.approaching && liq.type === 'EQL') { longScore  += 1; longSig.push(`⚡ Liquidité EQL proche @ ${liq.price.toFixed(4)}`); }
    if (liq.approaching && liq.type === 'EQH') { shortScore += 1; shortSig.push(`⚡ Liquidité EQH proche @ ${liq.price.toFixed(4)}`); }
  }

  // ─ Marge de conviction ≥ 3 ──────────────────────────────────
  const margin = Math.abs(longScore - shortScore);
  if (margin < 3) {
    return { direction: null, longScore, shortScore, totalScore: 0,
      signals: [...sharedSig, `✗ Signal ambigu — écart insuffisant (LONG ${longScore} vs SHORT ${shortScore})`],
      priority: 'NONE', price: tf15m.price, levels: null };
  }

  const direction  = longScore > shortScore ? 'LONG' : 'SHORT';
  const totalScore = direction === 'LONG' ? longScore : shortScore;

  // ─ Filtre inZone : au moins un OB ou FVG doit être atteint ─
  const hasInZone = direction === 'LONG'
    ? [...tf1h.obs, ...tf15m.obs].some(o => o.type === 'DEMAND' && o.inZone) ||
      [...tf1h.fvgs, ...tf15m.fvgs].some(f => f.type === 'BULLISH' && f.inZone)
    : [...tf1h.obs, ...tf15m.obs].some(o => o.type === 'SUPPLY' && o.inZone) ||
      [...tf1h.fvgs, ...tf15m.fvgs].some(f => f.type === 'BEARISH' && f.inZone);

  if (!hasInZone) {
    return { direction: null, longScore, shortScore, totalScore: 0,
      signals: [...sharedSig, ...(direction === 'LONG' ? longSig : shortSig),
        '✗ Aucune zone OB/FVG atteinte — entrée prématurée'],
      priority: 'NONE', price: tf15m.price, levels: null };
  }

  const priority = totalScore >= 8 ? 'HIGH'
                 : totalScore >= 5 ? 'MEDIUM'
                 : totalScore >= 3 ? 'LOW'
                 : 'NONE';

  // Signaux filtrés pour la direction gagnante uniquement
  const signals = [
    ...sharedSig,
    ...(direction === 'LONG' ? longSig : shortSig),
  ];

  // ─ Confirmation 15M ─────────────────────────────────────────
  const confirm   = tf15m.confirmation;
  const confirmed = direction === 'LONG' ? confirm?.bull : confirm?.bear;
  if (confirmed && confirm.pattern) {
    signals.push(`✓ 15M : ${confirm.pattern} — confirmation entrée`);
  } else {
    signals.push(`⏳ 15M : En attente confirmation (engulfing / pin bar)`);
  }

  const levels = calcLevels(direction, tf15m, tf1h, tf4h);
  return { direction, longScore, shortScore, totalScore, signals, priority, price: tf15m.price, levels, confirmed };
}

// ─── Calcul Entry / SL / TP ───────────────────────────────────
function calcLevels(direction, tf15m, tf1h, tf4h) {
  const price  = tf15m.price;
  const atr    = tf15m.atr;
  const buffer = atr * 0.2;

  let sl, tp;

  if (direction === 'LONG') {
    const demandOBs = tf15m.obs.filter(o => o.type === 'DEMAND' && (o.inZone || o.near));
    if (demandOBs.length > 0) {
      sl = Math.min(...demandOBs.map(o => o.bottom)) - buffer;
    } else if (tf15m.structure.swingLows?.length > 0) {
      sl = tf15m.structure.swingLows[tf15m.structure.swingLows.length - 1].price - buffer;
    } else {
      sl = price - atr * 1.5;
    }

    const eqhAbove = tf15m.liquidity.filter(l => l.type === 'EQH' && l.price > price);
    const swingH1h = (tf1h.structure.swingHighs || []).filter(s => s.price > price);
    const swingH4h = (tf4h.structure.swingHighs || []).filter(s => s.price > price);

    if (eqhAbove.length)   tp = Math.min(...eqhAbove.map(l => l.price));
    else if (swingH1h.length) tp = Math.min(...swingH1h.map(s => s.price));
    else if (swingH4h.length) tp = Math.min(...swingH4h.map(s => s.price));
    else                    tp = price + atr * 2.5;

    if (sl >= price) sl = price - atr * 1.5;
    const risk = price - sl;
    if (risk > 0 && tp - price < risk * 2) tp = price + risk * 2;

  } else {
    const supplyOBs = tf15m.obs.filter(o => o.type === 'SUPPLY' && (o.inZone || o.near));
    if (supplyOBs.length > 0) {
      sl = Math.max(...supplyOBs.map(o => o.top)) + buffer;
    } else if (tf15m.structure.swingHighs?.length > 0) {
      sl = tf15m.structure.swingHighs[tf15m.structure.swingHighs.length - 1].price + buffer;
    } else {
      sl = price + atr * 1.5;
    }

    const eqlBelow = tf15m.liquidity.filter(l => l.type === 'EQL' && l.price < price);
    const swingL1h = (tf1h.structure.swingLows || []).filter(s => s.price < price);
    const swingL4h = (tf4h.structure.swingLows || []).filter(s => s.price < price);

    if (eqlBelow.length)   tp = Math.max(...eqlBelow.map(l => l.price));
    else if (swingL1h.length) tp = Math.max(...swingL1h.map(s => s.price));
    else if (swingL4h.length) tp = Math.max(...swingL4h.map(s => s.price));
    else                    tp = price - atr * 2.5;

    if (sl <= price) sl = price + atr * 1.5;
    const risk = sl - price;
    if (risk > 0 && price - tp < risk * 2) tp = price - risk * 2;
  }

  const risk   = Math.abs(price - sl);
  const reward = Math.abs(tp - price);
  const rr     = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;

  return { entry: price, sl, tp, rr };
}

module.exports = { score };
