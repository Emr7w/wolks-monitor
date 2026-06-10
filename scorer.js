// ─── Scoring des confluences multi-TF ─────────────────────────
// Entrée : analyse 4H + 1H + 15M
// Sortie : score, direction, signaux, priorité

function score(tf4h, tf1h, tf15m) {
  let longScore = 0, shortScore = 0;
  const signals = [];

  if (!tf4h || !tf1h || !tf15m) return null;

  // ─ Session ────────────────────────────────────────────────
  if (tf15m.session.active) {
    longScore += 1; shortScore += 1;
    signals.push(`✓ Session ${tf15m.session.name}`);
  }

  // ─ Structure 4H ───────────────────────────────────────────
  if (tf4h.structure.trend === 'BULLISH')   { longScore  += 2; signals.push('✓ 4H : Structure haussière (HH/HL)'); }
  if (tf4h.structure.trend === 'BEARISH')   { shortScore += 2; signals.push('✓ 4H : Structure baissière (LH/LL)'); }
  if (tf4h.structure.lastBOS?.direction === 'UP')   { longScore  += 2; signals.push(`✓ 4H : BOS haussier @ ${tf4h.structure.lastBOS.level.toFixed(4)}`); }
  if (tf4h.structure.lastBOS?.direction === 'DOWN')  { shortScore += 2; signals.push(`✓ 4H : BOS baissier @ ${tf4h.structure.lastBOS.level.toFixed(4)}`); }

  // ─ Alignement 1H + 4H ────────────────────────────────────
  if (tf1h.structure.trend === 'BULLISH' && tf4h.structure.trend === 'BULLISH') {
    longScore += 1; signals.push('✓ 1H : Alignée 4H haussier');
  }
  if (tf1h.structure.trend === 'BEARISH' && tf4h.structure.trend === 'BEARISH') {
    shortScore += 1; signals.push('✓ 1H : Alignée 4H baissier');
  }

  // ─ Order Blocks 1H (signal fort) ─────────────────────────
  for (const ob of tf1h.obs) {
    if (ob.type === 'DEMAND' && ob.inZone)  { longScore  += 3; signals.push(`✓ 1H : DANS OB Demande @ ${ob.mid.toFixed(4)}`); }
    if (ob.type === 'SUPPLY' && ob.inZone)  { shortScore += 3; signals.push(`✓ 1H : DANS OB Supply   @ ${ob.mid.toFixed(4)}`); }
    if (ob.type === 'DEMAND' && ob.near)    { longScore  += 1; signals.push(`→ 1H : Approche OB Demande @ ${ob.mid.toFixed(4)}`); }
    if (ob.type === 'SUPPLY' && ob.near)    { shortScore += 1; signals.push(`→ 1H : Approche OB Supply  @ ${ob.mid.toFixed(4)}`); }
  }

  // ─ FVG 1H ─────────────────────────────────────────────────
  for (const fvg of tf1h.fvgs) {
    if (fvg.type === 'BULLISH' && fvg.inZone) { longScore  += 2; signals.push('✓ 1H : Dans FVG haussier'); }
    if (fvg.type === 'BEARISH' && fvg.inZone) { shortScore += 2; signals.push('✓ 1H : Dans FVG baissier'); }
  }

  // ─ CHoCH 15M (signal d'entrée) ───────────────────────────
  if (tf15m.structure.lastCHoCH?.direction === 'UP')   { longScore  += 2; signals.push('✓ 15M : CHoCH haussier — signal d\'entrée'); }
  if (tf15m.structure.lastCHoCH?.direction === 'DOWN')  { shortScore += 2; signals.push('✓ 15M : CHoCH baissier — signal d\'entrée'); }

  // ─ BOS 15M ────────────────────────────────────────────────
  if (tf15m.structure.lastBOS?.direction === 'UP')   { longScore  += 1; signals.push(`✓ 15M : BOS haussier @ ${tf15m.structure.lastBOS.level.toFixed(4)}`); }
  if (tf15m.structure.lastBOS?.direction === 'DOWN')  { shortScore += 1; signals.push(`✓ 15M : BOS baissier @ ${tf15m.structure.lastBOS.level.toFixed(4)}`); }

  // ─ Order Blocks 15M ───────────────────────────────────────
  for (const ob of tf15m.obs) {
    if (ob.type === 'DEMAND' && ob.inZone) { longScore  += 2; signals.push(`✓ 15M : Dans OB Demande @ ${ob.mid.toFixed(4)}`); }
    if (ob.type === 'SUPPLY' && ob.inZone) { shortScore += 2; signals.push(`✓ 15M : Dans OB Supply  @ ${ob.mid.toFixed(4)}`); }
  }

  // ─ FVG 15M ────────────────────────────────────────────────
  for (const fvg of tf15m.fvgs) {
    if (fvg.type === 'BULLISH' && fvg.inZone) { longScore  += 2; signals.push('✓ 15M : Dans FVG haussier'); }
    if (fvg.type === 'BEARISH' && fvg.inZone) { shortScore += 2; signals.push('✓ 15M : Dans FVG baissier'); }
    if (fvg.type === 'BULLISH' && fvg.near)   { longScore  += 1; signals.push('→ 15M : Approche FVG haussier'); }
    if (fvg.type === 'BEARISH' && fvg.near)   { shortScore += 1; signals.push('→ 15M : Approche FVG baissier'); }
  }

  // ─ RSI filtres ────────────────────────────────────────────
  if (tf1h.rsi < 35)  { longScore  += 1; signals.push(`✓ 1H RSI survente  : ${tf1h.rsi.toFixed(0)}`); }
  if (tf1h.rsi > 65)  { shortScore += 1; signals.push(`✓ 1H RSI surachat  : ${tf1h.rsi.toFixed(0)}`); }
  if (tf15m.rsi < 30) { longScore  += 1; signals.push(`✓ 15M RSI survente : ${tf15m.rsi.toFixed(0)}`); }
  if (tf15m.rsi > 70) { shortScore += 1; signals.push(`✓ 15M RSI surachat : ${tf15m.rsi.toFixed(0)}`); }

  // ─ Liquidité proche ───────────────────────────────────────
  for (const liq of tf15m.liquidity) {
    if (liq.approaching && liq.type === 'EQL') { longScore  += 1; signals.push(`⚡ Liquidité EQL proche @ ${liq.price.toFixed(4)}`); }
    if (liq.approaching && liq.type === 'EQH') { shortScore += 1; signals.push(`⚡ Liquidité EQH proche @ ${liq.price.toFixed(4)}`); }
  }

  const direction = longScore > shortScore ? 'LONG'
                  : shortScore > longScore ? 'SHORT'
                  : null;
  const totalScore = direction === 'LONG' ? longScore : direction === 'SHORT' ? shortScore : 0;

  const priority = totalScore >= 8 ? 'HIGH'
                 : totalScore >= 5 ? 'MEDIUM'
                 : totalScore >= 3 ? 'LOW'
                 : 'NONE';

  return { direction, longScore, shortScore, totalScore, signals, priority, price: tf15m.price };
}

module.exports = { score };
