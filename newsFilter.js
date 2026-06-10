// ─── Filtre News — Calendrier Forex Factory (gratuit, sans clé) ─
// Bloque les alertes si un événement HIGH impact est prévu
// dans la fenêtre -1h / +2h sur les devises de la paire

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';

// Mapping paire → devises surveillées
const PAIR_CURRENCIES = {
  'EUR/USD': ['EUR', 'USD'],
  'GBP/USD': ['GBP', 'USD'],
  'GBP/JPY': ['GBP', 'JPY'],
  'XAU/USD': ['USD'],          // Gold : USD est le driver principal
  'XAG/USD': ['USD'],
};

let cache = { events: [], fetchedAt: null };

// ─── Parsing XML minimal (pas de dépendance) ──────────────────
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function parseCalendar(xml) {
  const events = [];
  const blocks = xml.match(/<event>([\s\S]*?)<\/event>/g) || [];

  for (const block of blocks) {
    const impact = extractTag(block, 'impact').toLowerCase();
    if (impact !== 'high') continue;

    const country  = extractTag(block, 'country').toUpperCase();
    const dateStr  = extractTag(block, 'date');
    const timeStr  = extractTag(block, 'time');
    const title    = extractTag(block, 'title');

    if (!dateStr || !timeStr || timeStr === 'All Day' || timeStr === 'Tentative') continue;

    // "Jun 12, 2026" + "8:30am" → Date UTC
    try {
      const dt = new Date(`${dateStr} ${timeStr} UTC`);
      if (isNaN(dt.getTime())) continue;
      events.push({ country, title, time: dt });
    } catch {}
  }
  return events;
}

// ─── Chargement (cache 1h) ────────────────────────────────────
async function loadCalendar() {
  const now = Date.now();
  if (cache.fetchedAt && now - cache.fetchedAt < 3_600_000) return cache.events;

  try {
    const res = await fetch(CALENDAR_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    cache.events    = parseCalendar(xml);
    cache.fetchedAt = now;
    console.log(`[news] Calendrier mis à jour — ${cache.events.length} événements HIGH impact`);
  } catch (e) {
    console.error('[news] Erreur chargement calendrier :', e.message);
  }
  return cache.events;
}

// ─── Vérification pour une paire ─────────────────────────────
async function isNewsBlocked(pair) {
  const currencies = PAIR_CURRENCIES[pair] || pair.split('/');
  const events     = await loadCalendar();
  const now        = new Date();
  const winStart   = new Date(now.getTime() - 60  * 60_000); // -1h
  const winEnd     = new Date(now.getTime() + 120 * 60_000); // +2h

  for (const ev of events) {
    if (ev.time < winStart || ev.time > winEnd) continue;
    if (currencies.includes(ev.country)) {
      const rel = ev.time > now ? `dans ${Math.round((ev.time - now) / 60_000)} min` : `il y a ${Math.round((now - ev.time) / 60_000)} min`;
      return { blocked: true, reason: `⚡ News HIGH ${ev.country} : ${ev.title} (${rel})` };
    }
  }
  return { blocked: false };
}

module.exports = { isNewsBlocked, loadCalendar };
