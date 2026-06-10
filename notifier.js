// ─── Push notifications via ntfy.sh ──────────────────────────
// Gratuit, pas de compte requis côté serveur
// L'utilisateur installe l'app ntfy sur iOS/Android et s'abonne au topic

function fmt(pair, val) {
  if (val === null || val === undefined) return '—';
  const n = Number(val);
  const p = pair || '';
  if (p.includes('JPY') || p.includes('XAU') || p.includes('XAG')) return n.toFixed(2);
  return n.toFixed(5);
}

async function notify(topic, { pair, direction, score, priority, signals, price, levels }) {
  if (!topic) return false;

  const emoji  = direction === 'LONG' ? '🟢' : '🔴';
  const prio   = priority === 'HIGH' ? 'urgent' : priority === 'MEDIUM' ? 'high' : 'default';
  const title  = `${emoji} WOLKS — ${pair} ${direction} (score ${score})`;
  const top3   = signals.slice(0, 5).join('\n');

  const levelsLine = levels
    ? `\nEntry : ${fmt(pair, levels.entry)}  |  SL : ${fmt(pair, levels.sl)}  |  TP : ${fmt(pair, levels.tp)}  |  R:R ${levels.rr}`
    : '';

  const body = `Prix : ${price}${levelsLine}\n\n${top3}`;

  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title':        title,
        'Priority':     prio,
        'Tags':         direction === 'LONG' ? 'chart_with_upwards_trend,moneybag' : 'chart_with_downwards_trend,moneybag',
      },
      body,
    });
    return res.ok;
  } catch (e) {
    console.error('[notifier] ntfy.sh erreur :', e.message);
    return false;
  }
}

async function notifyRaw(topic, title, body, priority = 'default') {
  if (!topic) return false;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Title': title, 'Priority': priority },
      body,
    });
  } catch {}
}

module.exports = { notify, notifyRaw };
