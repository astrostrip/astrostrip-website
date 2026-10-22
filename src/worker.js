// astro.strip order backend (Cloudflare Worker).
//
// Routes
//   GET  /api/slots            free slots per strip: this week and the next free week (up to WEEKS_AHEAD)
//   POST /api/checkout         validates an order, checks slots, creates a Stripe Checkout Session
//   POST /api/stripe-webhook   Stripe calls this after payment: mails the order to Sandra and the confirmation to the customer
//   POST /api/withdraw         electronic withdrawal function (§ 356a BGB): mails an immediate receipt
//   POST /api/transit-weekly   Transit Weekly booked later (or renewed) with the order number of a Maxi/Ultra Strip:
//                               checks the payment at Stripe, then creates a Stripe Checkout Session like /api/checkout
//   POST /api/cancel           cancellation button (§ 312k BGB) for Transit Weekly: mails an immediate confirmation
// Everything else is served from ./public (static assets).
//
// Birth data never goes to Stripe. It waits in KV (ORDERS) until payment, is mailed to Sandra, then deleted.
// A Transit Weekly booking is kept in KV for its term plus 14 days (tw:<strip order>:<order>): email, language,
// life areas, time zone and dates. No name, no birth data, no city (Sandra, 11.10.2026).
//
//   POST /api/subscribe        newsletter signup: stores the consent and sends the double opt-in mail
//   GET  /api/confirm          double opt-in link: logs the confirmation, adds the address to the Mailjet list
//   POST /api/stat             anonymous counter (Sandra, 07.10.2026): a page visit (by source: Instagram, TikTok,
//                               direct) or a click on one of the three preview tabs; visits also carry the country
//                               Cloudflare estimates from the IP (request.cf.country, Sandra 09.10.2026; the IP itself
//                               is never read or stored). No cookie, no IP, no per-visitor
//                               id — only categories go into Workers Analytics Engine (STATS), which is built for
//                               exactly this and free up to 100,000 points/day (KV's free write limit is 1,000/day,
//                               too little once traffic grows). Triggered by a small first-party fetch() from
//                               public/index.html, not a third-party script.
//   GET  /api/stats            weekly rollups from KV (?key=STATS_READ_KEY&weeks=n, default 1, max 12), for the
//                               Monday Telegram report. Not for the public; wrong/missing key = 404.
//   POST /api/tw-texts         Transit Weekly texts approved by Sandra, from tools/transit-weekly-hochladen.py
//                               (Authorization: Bearer TW_UPLOAD_KEY; wrong/missing key = 404): upload, status,
//                               stop, resume. Sending: see "Transit Weekly: weekly emails" below.
//   cron (hourly)              retention: buyer list after 3 years without purchase, consent proofs 3 years after the end
//   cron (every 5 minutes)     invoices: one step of one queued e-invoice per run (build, mail to the customer, copy to Sandra)
//   cron (every 5 minutes, +2) invoice corrections: one refund per run (Rechnungskorrektur), same way as the invoices
//                               both: when their queue is idle, a portion of due Transit Weekly emails
//   cron (hourly), Friday 12:00 Berlin: warning to Sandra about Transit Weekly texts missing for next Monday
//   cron (Monday 01:10 UTC)    stats rollup: sums last week's /api/stat events (SQL API) into one small KV entry,
//                               kept indefinitely (Workers Analytics Engine itself only keeps raw data 3 months)
//
// Secrets (Cloudflare → Worker → Settings → Variables and Secrets, type "Secret"):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, MAILJET_API_KEY, MAILJET_SECRET_KEY, OWNER_EMAIL,
//   CF_ACCOUNT_ID and CF_ANALYTICS_READ_TOKEN (API token, permission "Account Analytics Read") for the stats rollup,
//   STATS_READ_KEY (protects GET /api/stats), TW_UPLOAD_KEY (protects POST /api/tw-texts)
// Plain variables (wrangler.jsonc "vars"): SITE_URL, MAIL_FROM_NAME, MAIL_FROM_ADDRESS,
//   MAILJET_NEWSLETTER_LIST_ID (double opt-in list), MAILJET_CUSTOMER_LIST_ID (buyers, § 7 Abs. 3 UWG; empty = off)

import { buildInvoice, buildCorrection, berlinDate, servicePeriod } from './invoice.js';
import { berlinOffsetMinutes, berlinYmd, longDateText, berlinStampText, isoUtc } from './time.js';

// Mini founding price 29 €, later 39 € (Sandra, 22.10.2026).
// weekly = orders per strip and week (Sandra: 20/5/3 on 30.09.2026, Maxi and Ultra doubled on 03.10.2026, 21/7/6 on 06.10.2026).
export const STRIPS = {
  mini: { name: 'Mini Strip', tag: 'The essentials', cents: 2900, days: 5, weekly: 21 },
  maxi: { name: 'Maxi Strip', tag: 'Full chart reading', cents: 7900, days: 7, weekly: 7 },
  ultra: { name: 'Ultra Strip', tag: 'Complete dossier', cents: 12900, days: 10, weekly: 6 },
};

// Extra layers with a surcharge (Sandra, 19.10.2026: „3 für 15€ jeder weitere 3€“, „Mindestens 3 wählen“,
// „Mondknoten included aber Ahnen bitte 5€“): asteroids none or 3–8 of the eight (Maxi, Ultra), ancestral layer
// +5 € (Ultra only); the karmic nodes reading stays included. Founding prices of the strips unchanged.
export const ASTEROIDS = ['juno', 'pallas', 'ceres', 'vesta', 'eris', 'sedna', 'orcus', 'eros'];
const ASTEROID_NAME = a => a[0].toUpperCase() + a.slice(1);
export const EXTRAS = { astMin: 3, astBaseCents: 1500, astEachCents: 300, ancestryCents: 500 };
export const asteroidCents = n => (n >= EXTRAS.astMin ? EXTRAS.astBaseCents + (n - EXTRAS.astMin) * EXTRAS.astEachCents : 0);
export const extrasCents = o => asteroidCents(o.asteroids?.length || 0) + (o.ancestry ? EXTRAS.ancestryCents : 0);
export const stripCents = o => (STRIPS[o.strip] ? STRIPS[o.strip].cents + extrasCents(o) : 0);
const asteroidList = o => (o.asteroids || []).map(ASTEROID_NAME).join(', ');
// "Ultra Strip 129,00 € + asteroids (4: Juno, Ceres, Vesta, Eros) 18,00 € + ancestral layer 5,00 €"
export function extrasBreakdown(o, lang = 'en') {
  const s = STRIPS[o.strip];
  if (!s) return '';
  const de = lang === 'de';
  const n = o.asteroids?.length || 0;
  return [`${s.name} ${euro(s.cents)}`,
    n ? `${de ? 'Asteroiden' : 'asteroids'} (${n}: ${asteroidList(o)}) ${euro(asteroidCents(n))}` : null,
    o.ancestry ? `${de ? 'Ahnenschicht' : 'ancestral layer'} ${euro(EXTRAS.ancestryCents)}` : null,
  ].filter(Boolean).join(' + ');
}

const STRIP_TAG_DE = { mini: 'Das Wesentliche', maxi: 'Das ganze Horoskop', ultra: 'Das komplette Dossier' }; // Stripe page on /de/
export const LIFE_AREAS = ['Love and relationships', 'Work and calling', 'Money and self-worth', 'Home and family', 'Creativity and self-expression', 'Friends and belonging', 'Personal growth'];
export const RELATIONSHIP = ['Single', 'Dating', 'In a relationship', 'Married', 'Separated or divorced', 'Widowed'];
export const TIME_SOURCES = { certificate: 'Birth certificate or hospital record', family: 'From family memory', approximate: 'Approximate' };

// Transit Weekly (Sandra, 11.10.2026): weekly transit emails for the life areas the customer chooses, added to a
// Maxi or Ultra Strip or booked later with its order number. One term of 13 weeks, 39 € per area and month =
// 117 € per area (founding price for the first 12 bookings: 29 € / 87 €, TW_FOUNDING), several areas without discount, no automatic renewal (renewing = booking again). Each area takes
// TRANSIT.minutes of Sandra's weekly reading budget (TRANSIT.budget), split over two reading weeks (planTransit):
// minutesFirst for part 1 before the first email, the rest for part 2 after the withdrawal period.
// Notice only to the end of the term.
export const TRANSIT = { name: 'Transit Weekly', cents: 11700, monthCents: 3900, weeks: 13, minutes: 60, minutesFirst: 20, budget: 300 };
// Founding price (Sandra, 11.10.2026): the first 12 paid bookings (one booking = 1–5 areas) pay 29 € a month
// per area (87 € for 13 weeks), then 39 €. The page shows only the places left, not out of how many.
// The price is fixed when the checkout starts and travels with the order (transit.unitCents, metadata tw_unit).
export const TW_FOUNDING = { cents: 8700, monthCents: 2900, places: 12 };
const TW_FOUNDING_COUNT = 'twfounding:count';
export async function twPrice(env) {
  const used = Number(await env.ORDERS.get(TW_FOUNDING_COUNT)) || 0;
  const left = Math.max(0, TW_FOUNDING.places - used);
  return left ? { cents: TW_FOUNDING.cents, monthCents: TW_FOUNDING.monthCents, founding: true, left } : { cents: TRANSIT.cents, monthCents: TRANSIT.monthCents, founding: false, left: 0 };
}
// After payment: one place per founding booking, counted once even if Stripe sends the event again.
async function countFounding(env, orderId) {
  if (await env.ORDERS.get(`twfounding:${orderId}`)) return;
  await env.ORDERS.put(`twfounding:${orderId}`, '1', { expirationTtl: 30 * 86400 }); // only against Stripe resending the event
  await env.ORDERS.put(TW_FOUNDING_COUNT, String((Number(await env.ORDERS.get(TW_FOUNDING_COUNT)) || 0) + 1));
}
export const TRANSIT_MAX_AREAS = Math.floor(TRANSIT.budget / TRANSIT.minutes);
// Reading weeks counted ahead: the strip window (8 weeks) plus up to two weeks delivery plus one.
export const TW_WEEKS_AHEAD = 11;
// Booking later is possible as long as the delivered PDF is kept (3 years after the end of the delivery year);
// the Worker does not know the delivery date and counts from the order year, which is never later.
export const TW_BOOKABLE_YEARS = 3;
// Withdrawal period (Sandra, 11.10.2026): Transit Weekly starts at once with the early-start consent, but Sandra
// reads in two parts: part 1 (the emails before day 22) right away, part 2 only after the 14-day withdrawal period
// (from day 15). A withdrawal within the 14 days then costs her only part 1. As a 13-week service the right of
// withdrawal only ends after the last email (§ 356 Abs. 5 Nr. 2 BGB), not with the first one.
export const TW_WITHDRAWAL_DAYS = 14;
export const withdrawalEnds = nowMs => berlinYmd(nowMs + TW_WITHDRAWAL_DAYS * 86400000);
export const afterWithdrawal = nowMs => berlinYmd(nowMs + (TW_WITHDRAWAL_DAYS + 1) * 86400000);
// Birth time from family memory or approximate: Transit Weekly only with this confirmation (Sandra, 11.10.2026).
export const UNSURE_TIME = ['family', 'approximate'];
export const TIME_CONSENT = {
  version: 'v1-2026-10-11',
  en: 'I understand that my birth time is not exact, so my chart is imprecise and the readings of my life areas cannot be 100 % exact.',
  de: 'Mir ist klar, dass meine Geburtszeit nicht genau ist, mein Horoskop deshalb ungenau ist und die Deutungen meiner Lebensbereiche nicht 100 % exakt sein können.',
};
// "America/New_York" -> "New York": the weekly emails name the zone of their times; the booking keeps only the zone.
export const tzLabel = tz => String(tz || '').split('/').pop().replace(/_/g, ' ');

const SESSION_MINUTES = 31; // Stripe minimum is 30; open sessions hold a slot this long

// ---------- time ----------
// No Intl and no toISOString in the Worker: their first call costs 5–40 ms CPU, the free plan allows
// 10 ms (Cloudflare Metrics 03.10.2026: checkout and payment webhook up to 31 ms). See src/time.js.

// Unix seconds of this week's Monday 00:00 in Berlin.
export function weekStart(nowMs = Date.now()) {
  const local = new Date(nowMs + berlinOffsetMinutes(nowMs) * 60000); // Berlin wall clock, read with UTC getters
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  const mondayWall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
  let utc = mondayWall - berlinOffsetMinutes(mondayWall) * 60000;
  utc = mondayWall - berlinOffsetMinutes(utc) * 60000; // second pass for DST edges
  return Math.floor(utc / 1000);
}

export function berlinStamp(ms = Date.now(), lang = 'de') {
  return berlinStampText(ms, lang) + ' (Europe/Berlin)';
}

// ---------- Stripe ----------
function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function stripe(env, method, path, params) {
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && params ? '?' + formEncode(params) : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : formEncode(params || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message || 'unknown error'}`);
  return data;
}

// Booking ahead (Sandra, 30.09.2026): when a week is full, the customer books the next free week,
// at most WEEKS_AHEAD weeks including the current one. Each session carries its week in metadata.week.
export const WEEKS_AHEAD = 8;
// Refunded orders (order id, week, strip), counted back into the free slots; see runCorrections.
const FREED_KEY = 'slots:freed';

// Monday 00:00 (Berlin) n weeks after the week starting at weekSec. Noon offset keeps DST shifts harmless.
export const addWeeks = (weekSec, n) => weekStart((weekSec + n * 7 * 86400 + 12 * 3600) * 1000);

// Berlin calendar date of a week start, YYYY-MM-DD.
export const weekDate = weekSec => berlinYmd(weekSec * 1000);

// Counts paid and still-open sessions per week and strip, for the current week and the weeks ahead.
// Transit Weekly counts minutes per reading week (tw_week, tw_n in the session metadata), over TW_WEEKS_AHEAD weeks.
export async function usedSlots(env, nowMs = Date.now()) {
  const current = weekStart(nowMs);
  const weeks = Array.from({ length: WEEKS_AHEAD }, (_, i) => addWeeks(current, i));
  const used = Object.fromEntries(weeks.map(w => [w, { mini: 0, maxi: 0, ultra: 0 }]));
  const twWeeks = Array.from({ length: TW_WEEKS_AHEAD }, (_, i) => addWeeks(current, i));
  const tw = Object.fromEntries(twWeeks.map(w => [w, 0]));
  const stripSince = addWeeks(current, -WEEKS_AHEAD); // a session for this week may have been created up to 7 weeks ago
  const since = addWeeks(current, -TW_WEEKS_AHEAD);
  let starting_after;
  for (let page = 0; page < 20; page++) {
    const list = await stripe(env, 'GET', 'checkout/sessions', { limit: 100, 'created[gte]': since, starting_after });
    for (const s of list.data) {
      if (!(s.status === 'complete' || (s.status === 'open' && s.expires_at * 1000 > nowMs))) continue;
      const strip = s.metadata?.strip;
      const week = Number(s.metadata?.week) || weekStart(s.created * 1000);
      if (s.created >= stripSince && used[week] && strip in used[week]) used[week][strip]++;
      const tww = Number(s.metadata?.tw_week);
      const tww2 = Number(s.metadata?.tw_week2);
      const n = Number(s.metadata?.tw_n) || 0;
      if (tww2) { if (tww in tw) tw[tww] += n * TRANSIT.minutesFirst; if (tww2 in tw) tw[tww2] += n * (TRANSIT.minutes - TRANSIT.minutesFirst); }
      else if (tww in tw) tw[tww] += n * TRANSIT.minutes;
    }
    if (!list.has_more) break;
    starting_after = list.data[list.data.length - 1].id;
  }
  // Refunded orders give their slot back (Sandra, 03.10.2026: always, also after a partial refund).
  for (const f of JSON.parse(await env.ORDERS.get(FREED_KEY) || '[]')) {
    if (f.s === 'transit') { if (f.w in tw) tw[f.w] = Math.max(0, tw[f.w] - (f.m ?? (f.n || 0) * TRANSIT.minutes)); }
    else if (used[f.w] && used[f.w][f.s] > 0) used[f.w][f.s]--;
  }
  return { weeks, used, twWeeks, tw };
}

// First reading week at or after fromSec with room for n life areas, or null (used for "is anything free").
export function pickTransitWeek(state, fromSec, n) {
  return state.twWeeks.find(w => w >= fromSec && TRANSIT.budget - state.tw[w] >= n * TRANSIT.minutes) || null;
}

const addDays = (ymd, k) => berlinYmd(Date.parse(ymd + 'T12:00:00Z') + k * 86400000);

// Reading plan for n areas from the first reading week fromSec (Sandra, 11.10.2026, two parts): part 2 is read in
// the week starting on the first Monday after the withdrawal period (readWeek2, from day 15), when the Monday
// routine prepares it; part 1 = the weeks whose email goes out before the end of that week, read in the reading week.
// If the reading week already lies after the withdrawal period, everything is read at once.
// Minutes: minutesFirst per area in part 1, the rest in part 2.
export function planTransit(state, fromSec, n, nowMs, seamlessSec = 0) {
  const aw = afterWithdrawal(nowMs);
  const free = w => (w in state.tw ? TRANSIT.budget - state.tw[w] : -1);
  const all = n * TRANSIT.minutes;
  for (const w of state.twWeeks) {
    if (w < fromSec) continue;
    const d = { ...transitDates(w, seamlessSec), withdrawalEnds: withdrawalEnds(nowMs), part2From: aw };
    const w2 = mondayOnOrAfter(aw);
    let n1 = 0;
    while (n1 < TRANSIT.weeks && addDays(d.start, 7 * n1) < weekDate(addWeeks(w2, 1))) n1++;
    if (d.readWeek >= aw || n1 >= TRANSIT.weeks) { if (free(w) >= all) return { ...d, part1Weeks: TRANSIT.weeks, readWeek2: null }; continue; }
    if (n1 === 0) { if (free(w2) >= all) return { ...d, readWeek: weekDate(w2), part1Weeks: TRANSIT.weeks, readWeek2: null }; continue; }
    const m1 = n * TRANSIT.minutesFirst;
    if (w2 === w ? free(w) >= all : free(w) >= m1 && free(w2) >= all - m1) return { ...d, part1Weeks: n1, readWeek2: weekDate(w2) };
  }
  return null;
}

// Monday 00:00 (Berlin) of the week starting on or after a YYYY-MM-DD date.
export function mondayOnOrAfter(ymd) {
  const ws = weekStart(Date.parse(ymd + 'T12:00:00Z'));
  return weekDate(ws) === ymd ? ws : addWeeks(ws, 1);
}

// Reading week -> first email (the Monday after) and the last day of the 13th week (a Sunday).
export function transitDates(readWeekSec, earliestStartSec = 0) {
  const start = Math.max(addWeeks(readWeekSec, 1), earliestStartSec);
  return { readWeek: weekDate(readWeekSec), start: weekDate(start), end: weekDate(addWeeks(start, TRANSIT.weeks) - 86400 + 12 * 3600) };
}

// Per strip: left (current week), next (first week with a free slot: date and unix start, null if all full),
// thisWeek (next is the current week), until (last Sunday of the booking window, for "fully booked until").
// No total per week: the page must not show how many slots there are (Sandra, 06.10.2026).
export async function freeSlots(env, nowMs = Date.now()) {
  return freeSlotsFrom(await usedSlots(env, nowMs));
}
// Transit Weekly: only whether a reading week is free (next), never minutes or areas left.
export function freeSlotsFrom(state) {
  const { weeks, used } = state;
  const lastSunday = weekDate(addWeeks(weeks[weeks.length - 1], 1) - 86400 + 12 * 3600);
  const twNext = pickTransitWeek(state, 0, 1);
  const transit = { next: twNext ? weekDate(twNext) : null, until: weekDate(addWeeks(state.twWeeks[state.twWeeks.length - 1], 1) - 86400 + 12 * 3600) };
  return { ...Object.fromEntries(Object.entries(STRIPS).map(([k, s]) => {
    const free = weeks.find(w => used[w][k] < s.weekly);
    return [k, {
      left: Math.max(0, s.weekly - used[weeks[0]][k]),
      next: free ? weekDate(free) : null,
      nextStart: free || null,
      thisWeek: free === weeks[0],
      until: lastSunday,
    }];
  })), transit };
}

// "19 October 2026" / "19. Oktober 2026" for a YYYY-MM-DD date.
export function longDate(ymd, lang = 'en') {
  return longDateText(ymd, lang);
}

// Delivery wording for mails and Stripe. Current week: from payment; a later week: from its Monday.
function deliveryText(order, lang = 'en') {
  const s = STRIPS[order.strip];
  if (!s) return '';
  if (order.thisWeek !== false) return lang === 'de' ? `Lieferung bis spätestens ${s.days} Werktage nach Zahlungseingang` : `within ${s.days} working days`;
  return lang === 'de'
    ? `Gebuchte Woche ab Montag, ${longDate(order.week, 'de')}; Lieferung bis spätestens ${s.days} Werktage ab diesem Montag`
    : `booked for the week of ${longDate(order.week)}, delivered within ${s.days} working days from that Monday`;
}

// Stripe-Signature: t=...,v1=...  HMAC-SHA256 over `${t}.${body}`
export async function verifyStripeSignature(body, header, secret, toleranceSec = 300, nowMs = Date.now()) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => timingSafeEqual(s, hex));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- mail ----------
// Mailjet (Sinch Mailjet, Paris; EU data). Open and click tracking are switched off on every mail sent
// from here (order, withdrawal, double opt-in): nobody consented to tracking in these mails.
// Newsletter campaigns are sent from the Mailjet dashboard; tracking there only for the list "Newsletter",
// whose consent text (v2) covers it. Never for the list "Kundinnen" (§ 7 Abs. 3 UWG, no consent).
const mailjetAuth = env => 'Basic ' + btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`);

// Returns Mailjet's message id (for the Transit Weekly send log).
async function sendMail(env, { to, subject, text, html, replyTo, attachments }) {
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { Authorization: mailjetAuth(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Messages: [{
        From: { Email: env.MAIL_FROM_ADDRESS || 'hello@astrostrip.com', Name: env.MAIL_FROM_NAME || 'astro.strip' },
        To: [{ Email: to }],
        ReplyTo: replyTo ? { Email: replyTo } : undefined,
        Subject: subject,
        TextPart: text,
        HTMLPart: html || undefined,
        TrackOpens: 'disabled',
        TrackClicks: 'disabled',
        Attachments: attachments?.map(a => ({ ContentType: 'application/pdf', Filename: a.filename, Base64Content: a.base64 })),
      }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.Messages?.[0]?.Status !== 'success') throw new Error(`Mail ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
  return String(out.Messages[0].To?.[0]?.MessageID || '');
}

// Adds a contact to a Mailjet list. addforce only after a confirmed double opt-in;
// addnoforce for customers, so an earlier unsubscribe is respected.
async function mailjetList(env, listId, email, action) {
  if (!listId) return;
  const res = await fetch(`https://api.mailjet.com/v3/REST/contactslist/${encodeURIComponent(listId)}/managecontact`, {
    method: 'POST',
    headers: { Authorization: mailjetAuth(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ Email: email, Action: action }),
  });
  if (!res.ok) throw new Error(`Mailjet list ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---------- validation ----------
const isEmail = s => typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const clean = (s, max = 200) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

const cleanPlace = p => (p && clean(p.label) && isFinite(p.lat) && isFinite(p.lon) && clean(p.tz) ? { label: clean(p.label), lat: Number(p.lat), lon: Number(p.lon), tz: clean(p.tz, 60) } : null);

// Name, email and birth data: the same checks for a strip order and for booking Transit Weekly later.
function checkPerson(o, errors) {
  const name = clean(o.name, 120);
  if (name.length < 2) errors.push('Please enter your name.');
  if (!isEmail(o.email)) errors.push('Please enter a valid email address.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.birthDate || '')) errors.push('Please enter your date of birth.');
  if (!/^\d{2}:\d{2}$/.test(o.birthTime || '')) errors.push('Please enter your birth time.');
  if (!TIME_SOURCES[o.timeSource]) errors.push('Please tell us where your birth time comes from.');
  const place = o.place || {};
  if (!cleanPlace(place)) errors.push('Please choose your birth place from the list.');
  return { name, place };
}

// Transit Weekly part of an order: life areas, the time zone of the residence, the confirmations.
function checkTransit(t, timeSource, residence, errors) {
  const areas = Array.isArray(t?.areas) ? [...new Set(t.areas.map(a => clean(a, 80)))] : [];
  if (!areas.length) return null;
  if (!areas.every(a => LIFE_AREAS.includes(a))) errors.push('Please choose the life areas for Transit Weekly from the list.');
  if (areas.length > TRANSIT_MAX_AREAS) errors.push(`You can book Transit Weekly for at most ${TRANSIT_MAX_AREAS} life areas at once.`);
  if (!residence) errors.push('For Transit Weekly, please choose where you live now from the list: the times in your emails follow its time zone.');
  const unsure = UNSURE_TIME.includes(timeSource);
  if (unsure && t.timeConsent !== true) errors.push('Your birth time is not exact. Please tick the box that you understand what this means for Transit Weekly.');
  if (t.earlyStart !== true) errors.push('Please confirm that we may start preparing Transit Weekly before the withdrawal period ends.');
  return { areas, timeConsent: unsure && t.timeConsent === true, tz: residence ? residence.tz : '', tzLabel: residence ? tzLabel(residence.tz) : '' };
}

export function validateOrder(o) {
  const errors = [];
  if (!o || typeof o !== 'object') return { errors: ['Invalid request.'] };
  const strip = String(o.strip || '');
  if (!STRIPS[strip]) errors.push('Please choose a strip.');
  const { name, place } = checkPerson(o, errors);
  const lang = o.language === 'de' ? 'de' : 'en';
  let lifeArea = '';
  if (strip === 'ultra') {
    lifeArea = clean(o.lifeArea, 80);
    if (!LIFE_AREAS.includes(lifeArea)) errors.push('Please choose the life area for your Ultra Strip.');
  }
  // Asteroids chosen in the form (Maxi, Ultra): none, or at least three of the eight; unknown names are dropped.
  let asteroids = [];
  if (strip === 'maxi' || strip === 'ultra') {
    const raw = Array.isArray(o.asteroids) ? o.asteroids.map(a => String(a).toLowerCase()) : [];
    asteroids = ASTEROIDS.filter(a => raw.includes(a));
    if (asteroids.length && asteroids.length < EXTRAS.astMin) errors.push('Please choose at least three asteroids, or none.');
  }
  // Questionnaire for Maxi and Ultra. Only the current city is required (Ultra: solar return and transits).
  let questionnaire = null;
  if (strip === 'maxi' || strip === 'ultra') {
    const q = o.questionnaire || {};
    const residence = cleanPlace(q.residence);
    if (strip === 'ultra' && !residence) errors.push('Please choose where you live now from the list.');
    questionnaire = {
      residence,
      occupation: clean(q.occupation, 120),
      passions: clean(q.passions, 200),
      relationship: RELATIONSHIP.includes(q.relationship) ? q.relationship : '',
      focus: clean(q.focus, 300),
    };
  }
  // Free text may contain sensitive details (Art. 9 GDPR). Consent is required whenever any free-text field is filled;
  // without free text no consent is needed (Sandra, 05.10.2026). Older clients sent the flag inside the questionnaire.
  const sensitiveConsent = o.sensitiveConsent === true || (o.questionnaire && o.questionnaire.sensitiveConsent === true);
  const freeText = [clean(o.note, 500), questionnaire?.occupation, questionnaire?.passions, questionnaire?.focus].some(Boolean);
  if (freeText && !sensitiveConsent) errors.push('You wrote something in the free-text fields. Please tick the consent box for sensitive information, or clear those fields.');
  if (o.acceptTerms !== true) errors.push('Please confirm that you are 18 or older and accept the terms and the cancellation policy.');
  if (o.earlyStart !== true) errors.push('Please confirm that we may start before the withdrawal period ends.');
  // Transit Weekly as an add-on to a Maxi or Ultra Strip (Sandra, 11.10.2026); residence then required.
  let transit = null;
  if (o.transit && Array.isArray(o.transit.areas) && o.transit.areas.length) {
    if (strip !== 'maxi' && strip !== 'ultra') errors.push('Transit Weekly can be added to a Maxi or Ultra Strip.');
    else transit = checkTransit(o.transit, o.timeSource, questionnaire?.residence || null, errors);
  }
  const order = {
    strip, name, email: String(o.email || '').trim(), language: lang,
    birthDate: o.birthDate, birthTime: o.birthTime, timeSource: o.timeSource,
    place: { label: clean(place.label), lat: Number(place.lat), lon: Number(place.lon), tz: clean(place.tz, 60) },
    lifeArea, nodes: strip !== 'mini' && o.nodes === true, ancestry: strip === 'ultra' && o.ancestry === true, // Mini = Big Three only, no nodes layer
    asteroids,
    note: clean(o.note, 500),
    questionnaire,
    sensitiveConsent,
    newsletter: o.newsletter === true,
    // week the customer saw before ordering (YYYY-MM-DD); the server assigns the week and compares
    week: /^\d{4}-\d{2}-\d{2}$/.test(o.week || '') ? o.week : '',
    transit,
  };
  return { errors, order };
}

// Transit Weekly booked later, or renewed (Sandra, 11.10.2026): order number and email of the Maxi/Ultra Strip
// (both must match at Stripe), birth data and residence again (the reading data is deleted 3 months after delivery).
export const ORDER_ID_RE = /^AS-\d{8}-[A-Z0-9]{5}$/;
export function validateRebook(o) {
  const errors = [];
  if (!o || typeof o !== 'object') return { errors: ['Invalid request.'] };
  const base = clean(o.baseOrder, 30).toUpperCase();
  if (!ORDER_ID_RE.test(base)) errors.push('Please enter the order number of your Maxi or Ultra Strip (for example AS-20261116-3K9QZ).');
  const { name, place } = checkPerson(o, errors);
  const residence = cleanPlace(o.residence);
  const transit = checkTransit({ ...(o.transit || {}), areas: o.transit?.areas || [] }, o.timeSource, residence, errors);
  if (!transit) errors.push('Please choose at least one life area.');
  if (o.acceptTerms !== true) errors.push('Please confirm that you are 18 or older and accept the terms and the cancellation policy.');
  const order = {
    strip: 'transit', base, name, email: String(o.email || '').trim(), language: o.language === 'de' ? 'de' : 'en',
    birthDate: o.birthDate, birthTime: o.birthTime, timeSource: o.timeSource,
    place: cleanPlace(place) || {}, questionnaire: { residence }, transit, newsletter: o.newsletter === true,
  };
  return { errors, order };
}

function orderId(nowMs = Date.now()) {
  const d = berlinYmd(nowMs).replace(/-/g, '');
  const rnd = [...crypto.getRandomValues(new Uint8Array(3))].map(b => b.toString(36).padStart(2, '0')).join('').toUpperCase().slice(0, 5);
  return `AS-${d}-${rnd}`;
}

// ---------- mail texts ----------
const euro = cents => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

// Price of the whole order in cents: the strip (if any) plus the Transit Weekly price per life area
// (87 € founding price or 117 €, fixed at checkout).
export const transitUnit = order => order.transit?.unitCents || TRANSIT.cents;
export const transitCents = order => (order.transit ? order.transit.areas.length * transitUnit(order) : 0);
export const orderCents = order => stripCents(order) + transitCents(order);
// "Ultra Strip and Transit Weekly (2 life areas)", "Transit Weekly (1 life area)"
export function productLabel(order, lang = 'en') {
  const s = STRIPS[order.strip];
  const n = order.transit ? order.transit.areas.length : 0;
  const tw = n ? (lang === 'de' ? `Transit Weekly (${n} ${n === 1 ? 'Lebensbereich' : 'Lebensbereiche'})` : `Transit Weekly (${n} life area${n === 1 ? '' : 's'})`) : '';
  return [s ? s.name : '', tw].filter(Boolean).join(lang === 'de' ? ' und ' : ' and ');
}
const grossLine = cents => `${euro(cents)} inkl. 19 % USt (${euro(Math.round(cents / 1.19))} netto, ${euro(cents - Math.round(cents / 1.19))} USt)`;

// Two mails to Sandra: accounting data (keep 8 years) and reading data (pseudonymous, delete 3 months after delivery).
export function ownerOrderMail(order, id, session) {
  const s = STRIPS[order.strip];
  const t = order.transit;
  return [
    `Bestellung ${id} (Buchhaltung, 8 Jahre aufbewahren)`,
    '',
    `Produkt: ${productLabel(order, 'de')}`,
    s && t ? `  ${s.name}: ${grossLine(stripCents(order))}` : null,
    s && extrasCents(order) ? `  Zusammensetzung ${s.name}: ${extrasBreakdown(order, 'de')}` : null,
    t ? `  Transit Weekly: ${t.areas.length} × ${euro(transitUnit(order))}${t.founding ? ' (Founding-Preis)' : ''} = ${grossLine(transitCents(order))}; Bereiche: ${t.areas.join(', ')}` : null,
    `Preis gesamt: ${grossLine(orderCents(order))}, bezahlt`,
    `Bestellt: ${berlinStamp(order.createdAt)}`,
    s && t ? `Rechnungen: zwei, automatisch in den nächsten Minuten als eigene Mails (E-Rechnung, Kopie an diese Adresse): ${s.name} ${id}, Transit Weekly ${id}-T.`
      : 'Rechnung: folgt automatisch in den nächsten Minuten als eigene Mail (E-Rechnung, Kopie an diese Adresse).',
    s ? deliveryText(order, 'de') : null,
    t ? `Transit Weekly: Lesewoche ab Montag, ${longDate(t.readWeek, 'de')}; erste Wochenmail ${longDate(t.start, 'de')}, Laufzeit 13 Wochen bis ${longDate(t.end, 'de')}; keine automatische Verlängerung.` : null,
    order.base ? `Nachgebucht zu Bestellung ${order.base} (bei Stripe geprüft: bezahlt, nicht erstattet, E-Mail stimmt).` : null,
    '',
    `Name: ${order.name}`,
    `E-Mail: ${order.email}`,
    '',
    s ? `Zustimmung vorzeitiger Beginn und Kenntnis vom Erlöschen des Widerrufsrechts: ja, erteilt am ${berlinStamp(order.createdAt)}` : null,
    t ? `Zustimmung vorzeitiger Beginn Transit Weekly (anteiliger Wertersatz bei Widerruf): ja, erteilt am ${berlinStamp(order.createdAt)}; Widerrufsfrist bis ${longDate(t.withdrawalEnds, 'de')}` : null,
    t && t.timeConsent ? `Bestätigung ungenaue Geburtszeit (${TIME_CONSENT.version}): „${TIME_CONSENT.de}“ ja, erteilt am ${berlinStamp(order.createdAt)}` : null,
    `Stripe-Session: ${session.id} · Zahlungsstatus: ${session.payment_status}`,
    '',
    'Die Bestätigung mit Widerrufsbelehrung ist automatisch an die Kundin gegangen.',
    `Die Deutungsdaten kommen in einer eigenen Mail „Deutungsdaten ${id}“.`,
  ].filter(l => l !== null).join('\n');
}

export function ownerReadingMail(order, id) {
  const s = STRIPS[order.strip];
  const q = order.questionnaire;
  const t = order.transit;
  return [
    `Deutungsdaten ${id} · ${productLabel(order, 'de')}`,
    'Ohne Name und E-Mail. Nur diese Mail in Claude verwenden. 3 Monate nach Lieferung löschen.',
    '',
    `Sprache des Readings: ${order.language === 'de' ? 'Deutsch' : 'Englisch'}`,
    `Geburtsdatum: ${order.birthDate}`,
    `Geburtszeit: ${order.birthTime} (Ortszeit) · Quelle: ${TIME_SOURCES[order.timeSource]}`,
    `Geburtsort: ${order.place.label} · ${order.place.lat}, ${order.place.lon} · ${order.place.tz}`,
    order.strip === 'ultra' ? `Lebensbereich: ${order.lifeArea}` : null,
    s ? `Karmische Mondknoten-Deutung: ${order.nodes ? 'ja' : 'nein'}` : null,
    s && order.strip !== 'mini' ? `Asteroiden: ${order.asteroids?.length ? `${asteroidList(order)} (bestellt) · Skill: asteroiden:${order.asteroids.join(',')}` : 'keine bestellt · Skill: asteroiden:keine'}` : null,
    order.strip === 'ultra' ? `Ahnenschicht: ${order.ancestry ? 'ja' : 'nein'}` : null,
    order.note ? `Anmerkung: ${order.note}` : null,
    s ? `Einwilligung für sensible Angaben (Art. 9 DSGVO): ${order.sensitiveConsent ? 'ja' : 'nicht erteilt (keine Freitextangaben)'}` : null,
    ...(t ? [
      '',
      'Transit Weekly:',
      `Lebensbereiche: ${t.areas.join(', ')}`,
      `Zeitzone (Wohnort, gilt die ganze Laufzeit): ${t.tz} · in den Mails „${t.tzLabel}“ · Rechner: --wohn-tz ${t.tz}`,
      `Geburtszeit: ${t.timeConsent ? `ungenau (${TIME_CONSENT.version} bestätigt): ohne AC, MC, Hausspitzen-Grade und Lose rechnen` : 'genau (Geburtsurkunde/Krankenhaus)'}`,
      t.readWeek2 ? `Lesen in zwei Teilen: Teil 1 (Wochen 1–${t.part1Weeks}) in der Woche ab ${t.readWeek}, in der Session mit dieser Mail; Teil 2 (Wochen ${t.part1Weeks + 1}–13) in der Woche ab ${t.readWeek2} (nach der Widerrufsfrist bis ${t.withdrawalEnds}; Montags-Routine), fertig vor der Mail am ${addDays(t.start, 7 * t.part1Weeks)}`
        : `Lesewoche ab ${t.readWeek}, alle 13 Wochen (Widerrufsfrist bis ${t.withdrawalEnds})`,
      `Erste Wochenmail ${t.start} · Ende ${t.end}`,
      order.base ? `Nachgebucht zu ${order.base}: Radixdeutung aus dem gelieferten PDF (Arbeitsblatt ggf. schon gelöscht).` : null,
      order.renews ? `Verlängerung von ${order.renews} (nahtlos): Fahrplan mit --verlaengerung-von, Rechner mit --anschluss-ab` : null,
    ] : []),
    ...(q && s ? [
      '',
      'Fragebogen:',
      `Wohnort heute: ${q.residence ? `${q.residence.label} · ${q.residence.lat}, ${q.residence.lon} · ${q.residence.tz}` : '–'}`,
      `Beruf: ${q.occupation || '–'}`,
      `Leidenschaften: ${q.passions || '–'}`,
      `Beziehungsstatus: ${q.relationship || 'keine Angabe'}`,
      `Was sie gerade verstehen will: ${q.focus || '–'}`,
    ] : []),
    ...(q && !s ? ['', `Wohnort heute: ${q.residence ? `${q.residence.label} · ${q.residence.lat}, ${q.residence.lon} · ${q.residence.tz}` : '–'}`] : []),
  ].filter(l => l !== null).join('\n');
}

// Customer confirmation lines for Transit Weekly (English, like the rest of the confirmation).
function transitCustomerLines(order, site, id) {
  const t = order.transit;
  if (!t) return [];
  return [
    '',
    'Transit Weekly',
    `Life areas: ${t.areas.join(', ')} (${euro(transitUnit(order))} per area for 13 weeks, ${euro(transitUnit(order) / 3)} a month${t.founding ? ', founding price' : ''}).`,
    `Every Monday from ${longDate(t.start)} you get one email per life area with your transits for that week, written for your chart. The last one comes in the week ending ${longDate(t.end)}.`,
    `Times in the emails are ${t.tzLabel} time, the time zone of where you live now.`,
    'Transit Weekly ends by itself after 13 weeks; nothing renews automatically.',
    `Want another life area or 13 more weeks? Book at ${site}/transit-weekly.html with your order number ${order.base || id} and this email address.`,
    `You can give notice at any time at ${site}/cancel.html; notice takes effect at the end of the 13 weeks, weeks already paid are not refunded. Your right to terminate for good cause is not affected.`,
  ];
}

// Contract confirmation (§ 312f BGB). Cancellation policy = official model text (not yet reviewed by a lawyer).
export function customerMail(order, id, env) {
  const s = STRIPS[order.strip];
  const t = order.transit;
  const site = env.SITE_URL || 'https://astrostrip.com';
  return [
    `Hi ${order.name},`,
    '',
    `thank you for your order. This email confirms your contract.`,
    '',
    `Order: ${id}`,
    s ? `Product: ${s.name} (${s.tag}), a personal astrology reading prepared for your birth chart and delivered as a PDF by email.` : `Product: ${productLabel(order)}, weekly transit emails for your birth chart.`,
    s && t ? `Added: ${productLabel({ transit: t })}.` : null,
    order.base ? `Booked for the reading of your order ${order.base}.` : null,
    s && extrasCents(order) ? `Extra layers: ${extrasBreakdown(order)}.` : null,
    `Price: ${euro(orderCents(order))} including 19 % VAT, paid.`,
    s && t ? 'Invoices: two, for the strip and for Transit Weekly, follow in separate emails within a few minutes (PDF e-invoices).' : 'Invoice: follows in a separate email within a few minutes (PDF e-invoice).',
    s ? `Delivery: ${deliveryText(order)}.` : null,
    `Language: ${order.language === 'de' ? 'German' : 'English'}`,
    ...transitCustomerLines(order, site, id),
    '',
    `Your birth data: ${order.birthDate}, ${order.birthTime} local time, ${order.place.label}.`,
    `If anything here is wrong, reply to this email before we start writing.`,
    '',
    'Your consent',
    s ? `You expressly requested that we start writing your strip before the withdrawal period ends, and you confirmed that you know your right of withdrawal ends once the strip has been fully delivered. (Given on ${berlinStamp(order.createdAt)}.)` : null,
    t ? `You expressly requested that we start preparing Transit Weekly before the withdrawal period ends. If you withdraw, you pay a proportionate amount for the part already provided. (Given on ${berlinStamp(order.createdAt)}.)` : null,
    t && t.timeConsent ? `You confirmed: "${TIME_CONSENT.en}" (Given on ${berlinStamp(order.createdAt)}.)` : null,
    '',
    'Widerrufsbelehrung (Deutsch)',
    ...CANCELLATION_POLICY.de,
    '',
    'Muster-Widerrufsformular',
    ...WITHDRAWAL_FORM.de,
    '',
    'Cancellation policy (English)',
    ...CANCELLATION_POLICY.en,
    '',
    'Model withdrawal form',
    ...WITHDRAWAL_FORM.en,
    '',
    `You can also withdraw online at any time during the withdrawal period: ${site}/withdraw.html`,
    '',
    'Terms: ' + site + '/terms.html',
    'Astrology is a tool for self-reflection. It does not replace medical, legal, financial or psychological advice.',
    '',
    'astro.strip · Sandra Willuweit · Renzelstraße 10c · 20146 Hamburg · Germany · hello@astrostrip.com',
  ].filter(l => l !== null).join('\n');
}

// Generated from public/cancellation.html (German official model, Anlage 1 zu Art. 246a EGBGB, Stand 19.06.2026 mit Gestaltungshinweis 3 zur Widerrufsfunktion,
// and EU model, Directive 2011/83/EU Annex I A). Page and mail must stay identical: edit the page, then regenerate.
export const CANCELLATION_POLICY = {
  "de": [
    "Widerrufsrecht",
    "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.",
    "Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (astro.strip, Sandra Willuweit, Renzelstraße 10c, 20146 Hamburg, Deutschland, hello@astrostrip.com) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Sie können Ihr Widerrufsrecht auch online unter https://astrostrip.com/withdraw.html ausüben. Wenn Sie diese Online-Funktion nutzen, übermitteln wir Ihnen auf einem dauerhaften Datenträger (z. B. durch eine E-Mail) unverzüglich eine Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs.",
    "Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.",
    "Folgen des Widerrufs",
    "Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.",
    "Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.",
    "Erlöschen des Widerrufsrechts",
    "Das Widerrufsrecht erlischt, wenn wir die Dienstleistung vollständig erbracht haben und mit der Ausführung erst begonnen haben, nachdem Sie dazu Ihre ausdrückliche Zustimmung gegeben und gleichzeitig Ihre Kenntnis davon bestätigt haben, dass Sie Ihr Widerrufsrecht bei vollständiger Vertragserfüllung durch uns verlieren."
  ],
  "en": [
    "Right of withdrawal",
    "You have the right to withdraw from this contract within 14 days without giving any reason. The withdrawal period will expire after 14 days from the day of the conclusion of the contract.",
    "To exercise the right of withdrawal, you must inform us (astro.strip, Sandra Willuweit, Renzelstraße 10c, 20146 Hamburg, Germany, hello@astrostrip.com) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or an email). You may use the attached model withdrawal form, but it is not obligatory. You can also exercise your right of withdrawal online at https://astrostrip.com/withdraw.html. If you use this online feature, we will send you an acknowledgement of receipt of the withdrawal on a durable medium (e.g. by email), including its content and the date and time of its submission, without undue delay.",
    "To meet the withdrawal deadline, it is sufficient for you to send your communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.",
    "Effects of withdrawal",
    "If you withdraw from this contract, we shall reimburse to you all payments received from you without undue delay and in any event not later than 14 days from the day on which we are informed about your decision to withdraw from this contract. We will carry out such reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement.",
    "If you requested to begin the performance of services during the withdrawal period, you shall pay us an amount which is in proportion to what has been provided until you have communicated us your withdrawal from this contract, in comparison with the full coverage of the contract.",
    "Expiry of the right of withdrawal",
    "Your right of withdrawal expires once we have fully performed the service, if we began performance only after you gave your express consent and at the same time acknowledged that you will lose your right of withdrawal once we have fully performed the contract."
  ]
};
export const WITHDRAWAL_FORM = {
  "de": [
    "(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)",
    "An astro.strip, Sandra Willuweit, Renzelstraße 10c, 20146 Hamburg, Deutschland, hello@astrostrip.com:",
    "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung: ____",
    "Bestellt am ____ / Bestellnummer ____",
    "Name des/der Verbraucher(s) ____",
    "Anschrift des/der Verbraucher(s) ____",
    "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier) ____",
    "Datum ____",
    "(*) Unzutreffendes streichen."
  ],
  "en": [
    "(Complete and return this form only if you wish to withdraw from the contract.)",
    "To astro.strip, Sandra Willuweit, Renzelstraße 10c, 20146 Hamburg, Germany, hello@astrostrip.com:",
    "I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the provision of the following service: ____",
    "Ordered on ____ / Order number ____",
    "Name of consumer(s) ____",
    "Address of consumer(s) ____",
    "Signature of consumer(s) (only if this form is notified on paper) ____",
    "Date ____",
    "(*) Delete as appropriate."
  ]
};

// Receipt for a withdrawal (§ 356a BGB): full German block, then full English block.
// The note on partial payment follows the cancellation policy (proportionate amount for work already done;
// no withdrawal once the strip has been fully delivered).
export function withdrawalReceipt({ name, contract, email, received, receivedEn, langs = ['de', 'en'] }) {
  const de = [
    `Hallo ${name},`,
    '',
    'wir haben Ihren Widerruf erhalten. Diese E-Mail bestätigt den Eingang.',
    '',
    `Eingegangen: ${received}`,
    `Name: ${name}`,
    `Vertrag: ${contract}`,
    `Bestätigung an: ${email}`,
    'Ihre Erklärung: Hiermit widerrufe ich den oben genannten Vertrag.',
    '',
    'Erstattung: Hatten wir mit Ihrem Strip bzw. Ihrem Transit Weekly noch nicht begonnen, erstatten wir Ihnen den vollen Betrag. Hatten wir bereits begonnen, auch wenn der Strip schon fertig, aber noch nicht an Sie geliefert war, zahlen Sie einen angemessenen Betrag für den Anteil, den wir bis zum Eingang Ihres Widerrufs bereits erbracht hatten; den Rest erstatten wir. Die Erstattung erfolgt spätestens vierzehn Tage nach Eingang Ihres Widerrufs über dasselbe Zahlungsmittel. War Ihr Strip bei Eingang des Widerrufs bereits vollständig geliefert, war Ihr Widerrufsrecht erloschen; dann melden wir uns bei Ihnen.',
  ];
  const en = [
    `Hi ${name},`,
    '',
    'we have received your withdrawal. This email confirms its receipt.',
    '',
    `Received: ${receivedEn}`,
    `Name: ${name}`,
    `Contract: ${contract}`,
    `Confirmation sent to: ${email}`,
    'Your declaration: I hereby withdraw from the contract named above.',
    '',
    'Refund: If we had not yet started your strip or your Transit Weekly, we refund the full amount. If we had already started, even if the strip was finished but not yet delivered to you, you pay a proportionate amount for the part we had already done by the time your withdrawal reached us; we refund the rest. The refund is made within fourteen days of receiving your withdrawal, using the same means of payment. If your strip had already been fully delivered when your withdrawal reached us, your right of withdrawal had expired; in that case we will get in touch with you.',
  ];
  return receiptJoin(langs, de, en);
}

// Both language blocks (German first) or only one, then the address line.
function receiptJoin(langs, de, en) {
  const blocks = [langs.includes('de') ? de : null, langs.includes('en') ? en : null].filter(Boolean).map(b => b.filter(l => l !== null).join('\n'));
  return [blocks.join('\n\n---\n\n'), '', 'astro.strip · Sandra Willuweit · Renzelstraße 10c · 20146 Hamburg · Germany · hello@astrostrip.com'].join('\n');
}

// Language of the receipts for withdrawal and notice (Sandra, 12.10.2026): only the language the order was booked in;
// both languages if it was booked in English with a billing address in a German-speaking country, and whenever no
// paid order matches number and email (then we do not know). The form is never refused for that: a withdrawal or
// notice counts even with a typo. Stripe errors fall back to both languages.
const GERMAN_SPEAKING = new Set(['DE', 'AT', 'CH', 'LI', 'LU']);
const BOTH = ['de', 'en'];
export async function receiptLangs(env, contract, email) {
  const id = (String(contract).toUpperCase().match(/AS-\d{8}-[A-Z0-9]{5}/) || [''])[0];
  if (!id || !env.STRIPE_SECRET_KEY) return BOTH;
  try {
    const found = await stripe(env, 'GET', 'payment_intents/search', { query: `metadata['order_id']:'${id}'`, 'expand[]': 'data.latest_charge' });
    const pi = (found.data || []).find(x => x.status === 'succeeded');
    if (!pi) return BOTH;
    const s = (await stripe(env, 'GET', 'checkout/sessions', { payment_intent: pi.id, limit: 1 })).data?.[0] || {};
    const paidBy = String(s.customer_details?.email || s.customer_email || pi.receipt_email || '').toLowerCase();
    if (!paidBy || paidBy !== String(email).trim().toLowerCase()) return BOTH;
    if (s.locale === 'de') return ['de'];
    if (s.locale !== 'en') return BOTH;
    return GERMAN_SPEAKING.has(String(s.customer_details?.address?.country || '').toUpperCase()) ? BOTH : ['en'];
  } catch { return BOTH; }
}
const langNote = langs => `Bestätigung an die Kundin auf ${langs.length > 1 ? 'Deutsch und Englisch' : langs[0] === 'de' ? 'Deutsch' : 'Englisch'}.`;
const receiptSubject = (langs, de, en) => (langs.length > 1 ? `${de} / ${en}` : langs[0] === 'de' ? de : en);

// ---------- abuse protection ----------
// Simple fixed-window counter per IP in KV. Stops someone from blocking all slots
// with abandoned checkouts, or from using the withdrawal form to mail strangers.
export async function rateLimited(env, request, bucket, max, windowSec = 3600) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${ip}:${win}`;
  const n = Number(await env.ORDERS.get(key)) || 0;
  if (n >= max) return true;
  await env.ORDERS.put(key, String(n + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return false;
}

// ---------- newsletter (double opt-in) ----------
// The consent wording is versioned; the proof stores which version was shown.
export const NEWSLETTER_CONSENT = {
  version: 'v3-2026-10-19', // v3: no frequency (Sandra, 19.10.2026: „Ich weiß noch nicht wie häufig“)
  en: 'Yes, send me the astro.strip newsletter by email: regular updates on the stars and offers for readings and PDFs. astro.strip may see whether I open it and which links I click, to improve it. I can unsubscribe at any time via the link in every email; this also ends that evaluation. Details in the privacy notice.',
  de: 'Ja, schick mir den astro.strip-Newsletter per E-Mail: regelmäßige Updates zu den Sternen und Angebote zu Readings und PDFs. astro.strip darf auswerten, ob ich ihn öffne und welche Links ich anklicke, um ihn zu verbessern. Abmelden geht jederzeit über den Link in jeder Mail; damit endet auch diese Auswertung. Details in der Datenschutzerklärung.',
};

// Notice shown in the order form before payment (§ 7 Abs. 3 Nr. 4 UWG). Must be repeated in every such email.
export const CUSTOMER_NOTICE = {
  version: 'v1-2026-09-30',
  en: 'We will also use your email address to tell you about similar astro.strip readings and PDFs. You can object to this at any time, for example via the link in every such email or by writing to hello@astrostrip.com, without any costs other than the basic transmission costs.',
};

const DOI_TTL = 604800; // confirmation link valid for 7 days
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

// Proof of consent (DSK OH Direktwerbung 3.3/3.7): kept as long as the address gets mail from us,
// and RETAIN_YEARS after the last list ended (see runRetention below).
async function logConsent(env, email, event) {
  const key = `consent:${email.toLowerCase()}`;
  const log = JSON.parse((await env.ORDERS.get(key)) || '{"events":[]}');
  log.events.push(event);
  await env.ORDERS.put(key, JSON.stringify(log));
}

// Free guide "The birth chart, stripped to the degree." (Sandra, 19.10.2026): only after a confirmed newsletter
// signup, said openly on guide.html. The file is a public asset with an unlisted name (robots: Disallow).
export const GUIDE_PATH = '/downloads/astrostrip-birth-chart-guide-34cdce3698ed.pdf';
// German guide „Dein Geburtshoroskop, bis auf den Grad genau.“ for /de/guide (Sandra, 21.10.2026).
export const GUIDE_PATH_DE = '/downloads/astrostrip-geburtshoroskop-leitfaden-f33961a756b6.pdf';
const ADDRESS_LINE = 'astro.strip · Sandra Willuweit · Renzelstraße 10c · 20146 Hamburg · Germany · hello@astrostrip.com';

// Every mail in one language only, the language of the page the person signed up on (Sandra, 21.10.2026: the
// bilingual confirmation landed in spam). Confirmation only, no advertising in these mails (BGH VI ZR 134/15).
// No 'free'/'guide'/'gratis' in a subject: landed in web.de spam (Sandra, 19.10.2026).
const DOI_MAIL = {
  guide: {
    // Plain like the newsletter confirmation: no 'free', 'download', 'get the guide' (Sandra, 21.10.2026: the guide
    // confirmation landed in GMX spam). guide.html says beforehand that this mail only confirms the newsletter.
    en: { subject: 'Please confirm your signup · astro.strip', kicker: 'Confirm your signup', pre: 'Please confirm your signup.',
      body: 'Please confirm that you want to receive the astro.strip newsletter. After that, your guide is waiting for you on the next page.',
      text: 'Please confirm that you want to receive the astro.strip newsletter. After that, your guide is waiting for you on the next page:',
      button: 'Confirm' },
    de: { subject: 'Bitte bestätige deine Anmeldung · astro.strip', kicker: 'Anmeldung bestätigen', pre: 'Bitte bestätige deine Anmeldung.',
      body: 'Bitte bestätige, dass du den astro.strip-Newsletter bekommen möchtest. Danach wartet dein Leitfaden auf der nächsten Seite auf dich.',
      text: 'Bitte bestätige, dass du den astro.strip-Newsletter bekommen möchtest. Danach wartet dein Leitfaden auf der nächsten Seite auf dich:',
      button: 'Bestätigen' },
  },
  newsletter: {
    en: { subject: 'Please confirm your newsletter signup · astro.strip', kicker: 'Confirm your signup', pre: 'Please confirm your newsletter signup.',
      body: 'Please confirm that you want to receive the astro.strip newsletter.', text: 'Please confirm that you want to receive the astro.strip newsletter:',
      button: 'Confirm' },
    de: { subject: 'Bitte bestätige deine Anmeldung · astro.strip', kicker: 'Anmeldung bestätigen', pre: 'Bitte bestätige deine Newsletter-Anmeldung.',
      body: 'Bitte bestätige, dass du den astro.strip-Newsletter erhalten möchtest.', text: 'Bitte bestätige, dass du den astro.strip-Newsletter erhalten möchtest:',
      button: 'Bestätigen' },
  },
};
const DOI_VALID = {
  en: 'The link is valid for 7 days. If you did not sign up, simply ignore this email; you will not hear from us.',
  de: 'Der Link gilt 7 Tage. Wenn du dich nicht angemeldet hast, ignoriere diese Mail einfach; du bekommst dann nichts von uns.',
};

export async function startDoubleOptIn(env, email, source, ip, lang = 'en') {
  lang = lang === 'de' ? 'de' : 'en';
  const token = randomToken();
  await env.ORDERS.put(`doi:${token}`, JSON.stringify({ email, source, lang, version: NEWSLETTER_CONSENT.version, requestedAt: Date.now(), ip }), { expirationTtl: DOI_TTL });
  // l=de: the expired-link page can then answer in German too (the token is gone by then)
  const link = `${env.SITE_URL || 'https://astrostrip.com'}/api/confirm?t=${token}${lang === 'de' ? '&l=de' : ''}`;
  const m = DOI_MAIL[source === 'guide' ? 'guide' : 'newsletter'][lang];
  await sendMail(env, {
    to: email,
    subject: m.subject,
    text: [m.text, link, '', DOI_VALID[lang], '', ADDRESS_LINE].join('\n'),
    // same frame as the other customer mails (Sandra, 19.10.2026: „im Stil der anderen aufbauen“)
    html: brandMail({ lang, kicker: m.kicker, pre: m.pre, body: [
      m.h1 ? bH1(m.h1, 28) : '',
      bP(m.body),
      bButton(m.button, link),
      bSmall(DOI_VALID[lang]),
    ].filter(Boolean).join('\n') }),
  });
}

// After a paid order: optional newsletter double opt-in, and the buyer list under § 7 Abs. 3 UWG.
// Failures here never block the order mails.
async function afterOrderMarketing(env, order) {
  try {
    if (order.newsletter) await startDoubleOptIn(env, order.email, 'order', '', order.language);
    if (env.MAILJET_CUSTOMER_LIST_ID) {
      await mailjetList(env, env.MAILJET_CUSTOMER_LIST_ID, order.email, 'addnoforce');
      await logConsent(env, order.email, { type: 'customer-7-3-uwg', orderId: order.id, at: isoUtc(Date.now()), noticeShown: CUSTOMER_NOTICE.version });
    }
  } catch (err) {
    console.error('marketing after order failed', err);
  }
}

// ---------- retention (Sandra, 02.10.2026) ----------
// Buyer list "Kundinnen": removed 3 years after the last purchase. Consent proof: deleted 3 years after
// the last list relationship ended (newsletter unsubscribed, buyer objected or was removed).
// Runs hourly (wrangler.jsonc "triggers") and checks RETENTION_BATCH proofs per run, because the free plan
// allows 50 subrequests per invocation; a full pass over 1,000 addresses takes about four days.
export const RETAIN_YEARS = 3;
export const RETENTION_BATCH = 10;
const yearsMs = y => y * 365.25 * 86400000;

async function mailjetRecipients(env, email) {
  const res = await fetch(`https://api.mailjet.com/v3/REST/listrecipient?ContactEmail=${encodeURIComponent(email)}&Limit=100`, { headers: { Authorization: mailjetAuth(env) } });
  if (!res.ok) throw new Error(`Mailjet listrecipient ${res.status}`);
  return (await res.json()).Data || [];
}

// Decides one proof. Returns 'kept', 'updated' or 'deleted'. Mailjet errors leave the proof untouched.
export async function retainConsent(env, key, now = Date.now()) {
  const raw = await env.ORDERS.get(key);
  if (!raw) return 'kept';
  const log = JSON.parse(raw);
  const email = key.slice('consent:'.length);
  const recs = await mailjetRecipients(env, email);
  const onList = id => recs.find(r => String(r.ListID) === String(id));
  const before = JSON.stringify(log);
  const ends = [];

  // newsletter
  if (log.events.some(e => e.type === 'newsletter-optin')) {
    const r = onList(env.MAILJET_NEWSLETTER_LIST_ID);
    if (r && !r.IsUnsubscribed) delete log.newsletterEndedAt; // active (again)
    else log.newsletterEndedAt = (r && r.UnsubscribedAt) || log.newsletterEndedAt || isoUtc(now);
    ends.push(log.newsletterEndedAt);
  }

  // buyer list (§ 7 Abs. 3 UWG)
  const buys = log.events.filter(e => e.type === 'customer-7-3-uwg').map(e => Date.parse(e.at));
  if (buys.length) {
    const lastBuy = Math.max(...buys);
    const r = onList(env.MAILJET_CUSTOMER_LIST_ID);
    if (r && !r.IsUnsubscribed) {
      if (now - lastBuy >= yearsMs(RETAIN_YEARS)) {
        await mailjetList(env, env.MAILJET_CUSTOMER_LIST_ID, email, 'remove');
        log.customerEndedAt = isoUtc(now);
        log.events.push({ type: 'customer-list-removed', reason: `${RETAIN_YEARS} years without purchase`, at: log.customerEndedAt });
      } else delete log.customerEndedAt;
    } else log.customerEndedAt = (r && r.UnsubscribedAt) || log.customerEndedAt || isoUtc(now);
    ends.push(log.customerEndedAt || null); // null = still on the list
  }

  if (ends.length && ends.every(Boolean) && Math.max(...ends.map(Date.parse)) + yearsMs(RETAIN_YEARS) <= now) {
    await env.ORDERS.delete(key);
    return 'deleted';
  }
  if (JSON.stringify(log) !== before) { await env.ORDERS.put(key, JSON.stringify(log)); return 'updated'; }
  return 'kept';
}

export async function runRetention(env, now = Date.now()) {
  if (!env.MAILJET_API_KEY) return { skipped: true };
  const cursor = (await env.ORDERS.get('retention:cursor')) || undefined;
  const page = await env.ORDERS.list({ prefix: 'consent:', cursor, limit: RETENTION_BATCH });
  const result = { kept: 0, updated: 0, deleted: 0, failed: 0 };
  for (const { name } of page.keys) {
    try { result[await retainConsent(env, name, now)]++; } catch (err) { result.failed++; console.error('retention', err); }
  }
  if (page.list_complete) await env.ORDERS.delete('retention:cursor');
  else await env.ORDERS.put('retention:cursor', page.cursor);
  return result;
}

// ---------- invoices (Sandra, 02.10.2026) ----------
// The webhook only queues the invoice; a cron run every 5 minutes builds and mails it in its own
// invocation. Reason: the free plan stops an invocation after 10 ms CPU without any chance to catch
// it, and the order mails must never depend on the PDF. A job is retried up to INVOICE_TRIES times,
// then Sandra gets a warning. The job holds the billing address only until the invoice is sent.
// Split into steps (Sandra, 03.10.2026): Cloudflare Metrics showed up to ~13 ms CPU around the first
// test purchase, above the 10 ms. Each run now does one step of one job: 'build' (PDF as base64 into
// the KV), 'customer' (mail to the customer), 'owner' (copy to Sandra, invoice date at Stripe). Every
// step has its own INVOICE_TRIES. The customer gets the invoice after at most ~10 instead of 5 minutes.
export const INVOICE_CRON = '*/5 * * * *';
export const INVOICE_TRIES = 3;
const INVOICE_TTL = 14 * 86400;
const invoicePdfKey = id => `invoicepdf:${id}`; // not under 'invoice:', so the job list stays small

// What an invoice job bills: a strip, or Transit Weekly (n life areas, service period = the 13 weeks).
const dmyText = ymd => ymd.split('-').reverse().join('.');
export function invoiceProduct(o) {
  if (o.strip !== 'transit') {
    // A strip with extra layers: one row with the total, the extras named in the description (Sandra, 19.10.2026).
    const s = STRIPS[o.strip];
    const x = { strip: o.strip, asteroids: Array.isArray(o.ast) ? o.ast.filter(a => ASTEROIDS.includes(a)) : [], ancestry: o.anc === true };
    if (!s || !extrasCents(x)) return s;
    const n = x.asteroids.length;
    const de = [n ? `${n} Asteroiden (${asteroidList(x)})` : '', x.ancestry ? 'Ahnenschicht' : ''].filter(Boolean).join(' + ');
    const en = [n ? `${n} asteroids` : '', x.ancestry ? 'ancestral layer' : ''].filter(Boolean).join(' + ');
    return {
      ...s, cents: stripCents(x),
      desc: `Reading als PDF mit ${de} · Personal reading (PDF) with ${en}`,
      xmlDesc: `Persönliches astrologisches Reading als PDF mit ${de} / personal astrology reading (PDF) with ${en}`,
      noteDe: `persönliches astrologisches Reading als PDF per E-Mail; enthalten: ${extrasBreakdown(x, 'de')}`,
    };
  }
  const n = Number(o.n) || 0;
  if (!n || !o.period) return undefined;
  return {
    name: TRANSIT.name, tag: '13 weeks', cents: n * (Number(o.unit) || TRANSIT.cents), qty: n, period: o.period,
    itemName: 'Transit Weekly – 13 Wochen je Lebensbereich · 13 weeks per life area',
    desc: `Wöchentliche Transite per E-Mail, ${dmyText(o.period.start)}–${dmyText(o.period.end)} · Weekly transit emails`,
    xmlDesc: 'Wöchentliche persönliche Transite per E-Mail, 13 Wochen je Lebensbereich / weekly personal transits by email, 13 weeks per life area',
    noteDe: 'wöchentliche persönliche Transite per E-Mail, 13 Wochen je Lebensbereich',
  };
}

// Transit Weekly bought with a strip gets its own invoice, number = order number + "-T" (one item row per template).
async function queueTransitInvoice(env, order, session) {
  const id = STRIPS[order.strip] ? `${order.id}-T` : order.id;
  const job = {
    order: { id, name: order.name, email: order.email, strip: 'transit', n: order.transit.areas.length, unit: transitUnit(order), period: { start: order.transit.start, end: order.transit.end } },
    customer_details: { name: session.customer_details?.name || '', address: session.customer_details?.address || {} },
    paidAt: Date.now(), attempts: 0, pi: typeof session.payment_intent === 'string' ? session.payment_intent : '',
  };
  await env.ORDERS.put(`invoice:${id}`, JSON.stringify(job), { expirationTtl: INVOICE_TTL });
}

async function queueInvoice(env, order, session) {
  const job = {
    order: { id: order.id, name: order.name, email: order.email, strip: order.strip, week: order.week || '', thisWeek: order.thisWeek !== false, ast: order.asteroids || [], anc: order.ancestry === true },
    customer_details: { name: session.customer_details?.name || '', address: session.customer_details?.address || {} },
    paidAt: Date.now(), attempts: 0, pi: typeof session.payment_intent === 'string' ? session.payment_intent : '',
  };
  await env.ORDERS.put(`invoice:${order.id}`, JSON.stringify(job), { expirationTtl: INVOICE_TTL });
}

export function invoiceMailText(d, strip) {
  return [
    `Hi ${d.buyer.name},`,
    '',
    'thank you for trusting astro.strip with your stars.',
    `Attached is the invoice for your ${strip.name}.`,
    '',
    'Enjoy exploring your chart. Soon your stars will be stripped down to what really matters.',
    '',
    '',
    `Hallo ${d.buyer.name},`,
    '',
    'danke, dass du astro.strip deine Sterne anvertraust.',
    `Anbei die Rechnung für deinen ${strip.name}.`,
    '',
    'Viel Freude beim Erforschen deiner Sterne. Bald lassen sie für dich die Hüllen fallen.',
    '',
    'astro.strip · Sandra Willuweit · Renzelstraße 10c · 20146 Hamburg · Germany · hello@astrostrip.com',
  ].join('\n');
}

export async function runInvoices(env, nowMs = Date.now()) {
  if (!env.MAILJET_API_KEY) return { skipped: true };
  const page = await env.ORDERS.list({ prefix: 'invoice:', limit: 1 });
  if (!page.keys.length) return { sent: 0 };
  const key = page.keys[0].name;
  const raw = await env.ORDERS.get(key);
  if (!raw) return { sent: 0 };
  const job = JSON.parse(raw);
  const id = job.order.id;
  const step = job.step || 'build';
  const pdfKey = invoicePdfKey(id);
  const strip = invoiceProduct(job.order);
  job.attempts = (job.attempts || 0) + 1;
  if (job.attempts > INVOICE_TRIES) {
    await warnInvoiceMissing(env, job, step, step === 'build' ? null : await env.ORDERS.get(pdfKey));
    await env.ORDERS.delete(pdfKey);
    await env.ORDERS.delete(key);
    return { failed: id, step };
  }
  // Count the try before the work: if the invocation is cut off, the next run knows.
  await env.ORDERS.put(key, JSON.stringify(job), { expirationTtl: INVOICE_TTL });
  const next = async (s, result) => {
    job.step = s; job.attempts = 0;
    await env.ORDERS.put(key, JSON.stringify(job), { expirationTtl: INVOICE_TTL });
    return result;
  };

  if (step === 'build') {
    const inv = buildInvoice(job.order, { customer_details: job.customer_details }, strip, nowMs, job.paidAt);
    await env.ORDERS.put(pdfKey, inv.base64, { expirationTtl: INVOICE_TTL });
    const d = inv.data;
    job.inv = { number: d.number, filename: inv.filename, issueDate: d.issueDate, period: d.period, amounts: { gross: d.amounts.gross }, buyer: { name: d.buyer.name }, missingCountry: d.missingCountry };
    return next('customer', { built: d.number });
  }

  const base64 = await env.ORDERS.get(pdfKey);
  if (!base64) return next('build', { rebuild: id }); // stored PDF gone: build it again, customerSent still holds
  const inv = job.inv;
  const attachments = [{ filename: inv.filename, base64 }];
  if (step === 'customer') {
    if (!job.customerSent) {
      await sendMail(env, { to: job.order.email, subject: `Your invoice ${inv.number} · Deine Rechnung`, text: invoiceMailText(inv, strip), html: brandFromText(invoiceMailText(inv, strip), { kicker: 'Your invoice · Deine Rechnung', italic: /^(Enjoy exploring|Viel Freude)/, attach: 'PDF e-invoice · E-Rechnung als PDF' }), attachments, replyTo: env.MAIL_FROM_ADDRESS || 'hello@astrostrip.com' });
      job.customerSent = true;
    }
    return next('owner', { customer: inv.number });
  }

  await sendMail(env, {
    to: env.OWNER_EMAIL,
    subject: `Rechnung ${inv.number} (Buchhaltung, 8 Jahre aufbewahren)`,
    text: `Ausgangsrechnung ${inv.number} · ${strip.name} · ${(inv.amounts.gross / 100).toFixed(2).replace('.', ',')} € inkl. 19 % USt · ausgestellt ${inv.issueDate} · an ${job.order.email} verschickt.${inv.missingCountry ? '\n\nACHTUNG: Stripe hat kein Land geliefert; in der Rechnung steht DE. Bitte prüfen.' : ''}\n\nDiese Mail mit Anhang 8 Jahre aufbewahren (§ 147 AO, § 14b UStG).`,
    attachments,
  });
  // The invoice correction needs the invoice date and service period later, when the job is long gone.
  // They go to the payment at Stripe (no personal data). A failure here must not resend the invoice.
  if (job.pi) {
    try {
      const p = job.order.strip === 'transit' ? 'tw_' : ''; // a strip + Transit Weekly payment has two invoices
      await stripe(env, 'POST', `payment_intents/${job.pi}`, { metadata: { [`${p}invoice_date`]: inv.issueDate, [`${p}invoice_period`]: `${inv.period.start}/${inv.period.end}` } });
    } catch (err) { console.error('invoice metadata', err); }
  }
  await env.ORDERS.delete(pdfKey);
  await env.ORDERS.delete(key);
  return { sent: inv.number };
}

// Warning after INVOICE_TRIES failed tries of one step. If the PDF already exists, it goes along, so
// Sandra can forward it; if the mail fails with the attachment, it goes again without.
async function warnInvoiceMissing(env, job, step, base64) {
  const id = job.order.id;
  const what = {
    build: `konnte nach ${INVOICE_TRIES} Versuchen nicht erzeugt werden. Bitte von Hand ausstellen; die Angaben stehen in der Buchhaltungs-Mail „Bestellung ${id}“.`,
    customer: `ist erzeugt, konnte aber nach ${INVOICE_TRIES} Versuchen nicht an die Kundin verschickt werden. Die Kundin hat noch keine Rechnung.`,
    owner: `ist an die Kundin verschickt, aber die Kopie für die Buchhaltung kam nach ${INVOICE_TRIES} Versuchen nicht zustande.`,
  }[step];
  const text = `Die E-Rechnung zu Bestellung ${id} (${job.order.email}) ${what}`;
  const mail = { to: env.OWNER_EMAIL, subject: `RECHNUNG FEHLT: ${id}` };
  if (base64 && job.inv) {
    try {
      await sendMail(env, { ...mail, text: `${text}\n\nDie Rechnung hängt an: bitte ${step === 'customer' ? 'an die Kundin weiterleiten und ' : ''}8 Jahre aufbewahren (§ 147 AO, § 14b UStG).`, attachments: [{ filename: job.inv.filename, base64 }] });
      return;
    } catch (err) { console.error('invoice warning with attachment', err); }
  }
  await sendMail(env, { ...mail, text: step === 'build' ? text : `${text}\n\nDie Rechnung ließ sich nicht anhängen. Bitte von Hand ausstellen.` });
}

// ---------- invoice corrections for refunds (Sandra, 03.10.2026) ----------
// Sandra refunds in the Stripe dashboard. Stripe sends refund.created; the webhook only queues the refund id.
// A cron run of its own (never together with the invoices, so a cut-off run cannot take other mails along)
// fetches refund, payment and Checkout Session from Stripe, frees the week slot, builds the correction
// (number = invoice number + K1, K2 …) and mails it to the customer with a copy to Sandra. Name and billing
// address come from Stripe again. Like the invoices in three steps, one per run (Sandra, 03.10.2026):
// 'build' (Stripe lookups, slot, PDF as base64 into the KV), 'customer', 'owner'. Until the copy to Sandra
// is sent, the job holds the correction's number, name, email and amounts, and the PDF waits in the KV.
export const CORRECTION_CRON = '2,7,12,17,22,27,32,37,42,47,52,57 * * * *';
const FREED_KEEP_MS = (WEEKS_AHEAD + 1) * 7 * 86400000;
const CORRECTED_TTL = 30 * 86400; // Stripe retries webhooks for up to 3 days
const correctionPdfKey = id => `correctionpdf:${id}`; // not under 'correction:', so the job list stays small

// Frees the strip's week slot and the Transit Weekly reading minutes of a refunded order (each only once).
async function freeSlot(env, session, orderId, nowMs) {
  const w = Number(session.metadata?.week);
  const s = session.metadata?.strip;
  const tww = Number(session.metadata?.tw_week);
  const tww2 = Number(session.metadata?.tw_week2);
  const n = Number(session.metadata?.tw_n) || 0;
  const add = [];
  if (w && STRIPS[s]) add.push({ o: orderId, w, s });
  if (tww && n && tww2) add.push({ o: `${orderId}-T`, w: tww, s: 'transit', n, m: n * TRANSIT.minutesFirst }, { o: `${orderId}-T2`, w: tww2, s: 'transit', n, m: n * (TRANSIT.minutes - TRANSIT.minutesFirst) });
  else if (tww && n) add.push({ o: `${orderId}-T`, w: tww, s: 'transit', n, m: n * TRANSIT.minutes });
  if (!add.length) return false;
  const keep = (TW_WEEKS_AHEAD + 1) * 7 * 86400000;
  const list = JSON.parse(await env.ORDERS.get(FREED_KEY) || '[]').filter(f => f.w * 1000 > nowMs - (f.s === 'transit' ? keep : FREED_KEEP_MS));
  const fresh = add.filter(a => !list.some(f => f.o === a.o));
  if (!fresh.length) return false;
  list.push(...fresh);
  await env.ORDERS.put(FREED_KEY, JSON.stringify(list));
  return true;
}

export function correctionMailText(d, strip) {
  const amount = `${(d.amounts.gross / 100).toFixed(2).replace('.', ',')} €`;
  const name = d.buyer.name ? ` ${d.buyer.name}` : '';
  return [
    `Hi${name},`,
    '',
    `we have refunded ${amount} for your ${strip.name} to your original payment method. Depending on your bank, it shows up within 5 to 10 working days.`,
    'Attached is the invoice correction. Please keep it together with your invoice.',
    '',
    '',
    `Hallo${name},`,
    '',
    `wir haben dir ${amount} für deinen ${strip.name} auf dein ursprüngliches Zahlungsmittel erstattet. Je nach Bank ist der Betrag in 5 bis 10 Werktagen sichtbar.`,
    'Anbei die Rechnungskorrektur. Bitte bewahre sie zusammen mit der Rechnung auf.',
    '',
    'astro.strip · Sandra Willuweit · Renzelstraße 10c · 20146 Hamburg · Germany · hello@astrostrip.com',
  ].join('\n');
}

export async function runCorrections(env, nowMs = Date.now()) {
  if (!env.MAILJET_API_KEY) return { skipped: true };
  const page = await env.ORDERS.list({ prefix: 'correction:', limit: 1 });
  if (!page.keys.length) return { sent: 0 };
  const key = page.keys[0].name;
  const raw = await env.ORDERS.get(key);
  if (!raw) return { sent: 0 };
  const job = JSON.parse(raw);
  const pdfKey = correctionPdfKey(job.refund);
  // Stripe may deliver refund.created more than once: a refund gets exactly one correction.
  if (await env.ORDERS.get(`corrected:${job.refund}`)) { await env.ORDERS.delete(pdfKey); await env.ORDERS.delete(key); return { duplicate: job.refund }; }
  const step = job.step || 'build';
  job.attempts = (job.attempts || 0) + 1;
  if (job.attempts > INVOICE_TRIES) {
    await warnCorrectionMissing(env, job, step, step === 'build' ? null : await env.ORDERS.get(pdfKey));
    await env.ORDERS.delete(pdfKey);
    await env.ORDERS.delete(key);
    return { failed: job.refund, step };
  }
  // Count the try before the work: if the invocation is cut off, the next run knows.
  await env.ORDERS.put(key, JSON.stringify(job), { expirationTtl: INVOICE_TTL });
  const next = async (st, result) => {
    job.step = st; job.attempts = 0;
    await env.ORDERS.put(key, JSON.stringify(job), { expirationTtl: INVOICE_TTL });
    return result;
  };

  if (step === 'build') {
    const refund = await stripe(env, 'GET', `refunds/${job.refund}`);
    if (refund.status === 'failed' || refund.status === 'canceled') {
      await sendMail(env, { to: env.OWNER_EMAIL, subject: `Erstattung ${refund.id}: ${refund.status}, keine Rechnungskorrektur`, text: `Stripe meldet die Erstattung ${refund.id} als „${refund.status}“. Es wurde keine Rechnungskorrektur verschickt. Bitte im Stripe-Dashboard nachsehen und der Kundin das Geld auf anderem Weg erstatten.` });
      await env.ORDERS.delete(key);
      return { skipped: refund.status };
    }
    const pi = await stripe(env, 'GET', `payment_intents/${refund.payment_intent}`);
    const orderId = pi.metadata?.order_id;
    const twOnly = pi.metadata?.strip === 'transit';
    const strip = twOnly ? { name: TRANSIT.name } : STRIPS[pi.metadata?.strip];
    // Strip + Transit Weekly in one payment: two invoices, and which one a refund corrects is Sandra's call.
    if (strip && !twOnly && Number(pi.metadata?.tw_n) > 0) {
      const session = (await stripe(env, 'GET', 'checkout/sessions', { payment_intent: pi.id, limit: 1 })).data[0] || {};
      const freed = await freeSlot(env, session, orderId, nowMs);
      // Fully refunded: Transit Weekly is not sent any more (Sandra, 11.10.2026); a partial refund changes nothing.
      let stopped = false;
      if (refund.amount >= pi.amount) {
        const bkKey = `tw:${orderId}:${orderId}`;
        const bk = JSON.parse((await env.ORDERS.get(bkKey)) || 'null');
        if (bk && !bk.stopped) { bk.stopped = { reason: 'refund', at: isoUtc(nowMs) }; await putBooking(env, bkKey, bk); stopped = true; }
      }
      await sendMail(env, { to: env.OWNER_EMAIL, subject: `Erstattung ${refund.id}: Rechnungskorrektur bitte von Hand (${orderId})`, text: `Die Erstattung ${refund.id} (${(refund.amount / 100).toFixed(2).replace('.', ',')} €) gehört zu Bestellung ${orderId} mit ${strip.name} und Transit Weekly. Diese Bestellung hat zwei Rechnungen (${orderId} für den Strip, ${orderId}-T für Transit Weekly); die Rechnungskorrektur bitte von Hand zur passenden Rechnung ausstellen. ${freed ? 'Wochenplatz und Transit-Minuten sind wieder frei.' : ''} ${stopped ? 'Voll erstattet: Transit Weekly wird nicht mehr verschickt (Versand gestoppt).' : 'Teilerstattung: Transit Weekly läuft weiter; soll es enden: python3 tools/transit-weekly-hochladen.py --stopp ' + orderId}` });
      await env.ORDERS.delete(key);
      return { manual: orderId };
    }
    if (!orderId || !strip) {
      await sendMail(env, { to: env.OWNER_EMAIL, subject: `Erstattung ohne Website-Bestellung: ${refund.id}`, text: `Die Erstattung ${refund.id} (${(refund.amount / 100).toFixed(2).replace('.', ',')} €) gehört zu keiner Bestellung über astrostrip.com. Es wurde keine Rechnungskorrektur verschickt.` });
      await env.ORDERS.delete(key);
      return { skipped: 'no order' };
    }
    const session = (await stripe(env, 'GET', 'checkout/sessions', { payment_intent: pi.id, limit: 1 })).data[0] || {};
    const freed = await freeSlot(env, session, orderId, nowMs);
    // K1, K2 …: position of this refund among all refunds of the payment, oldest first (stable on retries).
    const all = (await stripe(env, 'GET', 'refunds', { payment_intent: pi.id, limit: 100 })).data.slice().sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
    const n = all.findIndex(r => r.id === refund.id) + 1 || all.length + 1;
    const mp = twOnly ? 'tw_' : '';
    const [start, end] = String(pi.metadata[`${mp}invoice_period`] || '').split('/');
    const knownDate = /^\d{4}-\d{2}-\d{2}$/.test(pi.metadata[`${mp}invoice_date`] || '');
    const k = {
      orderId, n, refundCents: refund.amount, refundMs: refund.created * 1000, full: refund.amount >= pi.amount,
      invoiceDate: knownDate ? pi.metadata[`${mp}invoice_date`] : berlinDate(pi.created * 1000),
      period: start && end ? { start, end } : null,
    };
    // A fully refunded Transit Weekly is not sent any more: its booking goes at once (deletion concept).
    if (twOnly && k.full) await env.ORDERS.delete(`tw:${pi.metadata.base || orderId}:${orderId}`);
    const email = session.customer_details?.email || session.customer_email || pi.receipt_email || '';
    const corr = buildCorrection(k, session.customer_details, email, strip, nowMs);
    await env.ORDERS.put(pdfKey, corr.base64, { expirationTtl: INVOICE_TTL });
    const d = corr.data;
    job.corr = {
      number: d.number, filename: corr.filename, issueDate: d.issueDate, orderId, invoiceDate: k.invoiceDate, full: k.full, knownDate, freed, email,
      strip: pi.metadata.strip, amounts: d.amounts, buyer: { name: d.buyer.name }, missingCountry: d.missingCountry,
    };
    return next('customer', { built: d.number });
  }

  const base64 = await env.ORDERS.get(pdfKey);
  if (!base64) return next('build', { rebuild: job.refund }); // stored PDF gone: build it again, customerSent still holds
  const c = job.corr;
  const strip = c.strip === 'transit' ? { name: TRANSIT.name } : STRIPS[c.strip];
  const attachments = [{ filename: c.filename, base64 }];
  if (step === 'customer') {
    if (!job.customerSent && c.email) {
      await sendMail(env, { to: c.email, subject: `Your invoice correction ${c.number} · Deine Rechnungskorrektur`, text: correctionMailText(c, strip), html: brandFromText(correctionMailText(c, strip), { kicker: 'Invoice correction · Rechnungskorrektur', attach: 'PDF invoice correction · Rechnungskorrektur als PDF' }), attachments, replyTo: env.MAIL_FROM_ADDRESS || 'hello@astrostrip.com' });
      job.customerSent = true;
    }
    return next('owner', { customer: c.number });
  }

  const euro = cents => (cents / 100).toFixed(2).replace('.', ',');
  const notes = [
    !c.knownDate ? 'ACHTUNG: Rechnungsdatum nicht bei Stripe hinterlegt (Bestellung vor dem 03.10.2026?); angenommen wurde der Zahltag. Bitte mit der Rechnung vergleichen.' : '',
    c.missingCountry ? 'ACHTUNG: Stripe hat kein Land geliefert; in der Korrektur steht DE. Bitte prüfen.' : '',
    !c.email ? 'ACHTUNG: keine E-Mail-Adresse bei Stripe, die Kundin hat die Korrektur nicht bekommen.' : '',
    c.freed ? (c.strip === 'transit' ? 'Die Transit-Minuten der Lesewoche sind wieder frei.' : 'Der Wochenplatz ist wieder frei.') : '',
  ].filter(Boolean);
  await sendMail(env, {
    to: env.OWNER_EMAIL,
    subject: `Rechnungskorrektur ${c.number} (Buchhaltung, 8 Jahre aufbewahren)`,
    text: `Rechnungskorrektur ${c.number} zur Rechnung ${c.orderId} vom ${c.invoiceDate} · ${strip.name} · ${c.full ? 'volle Erstattung' : 'Teilerstattung'} ${euro(c.amounts.gross)} € inkl. 19 % USt (netto ${euro(c.amounts.net)} €, USt ${euro(c.amounts.vat)} €) · Stripe-Erstattung ${job.refund} · ausgestellt ${c.issueDate}${c.email ? ` · an ${c.email} verschickt` : ''}.${notes.length ? '\n\n' + notes.join('\n') : ''}\n\nDiese Mail mit Anhang 8 Jahre aufbewahren (§ 147 AO, § 14b UStG).`,
    attachments,
  });
  await env.ORDERS.put(`corrected:${job.refund}`, c.number, { expirationTtl: CORRECTED_TTL });
  await env.ORDERS.delete(pdfKey);
  await env.ORDERS.delete(key);
  return { sent: c.number };
}

// Warning after INVOICE_TRIES failed tries of one step, with the PDF if it already exists (as for invoices).
async function warnCorrectionMissing(env, job, step, base64) {
  const c = job.corr;
  const what = {
    build: `konnte nach ${INVOICE_TRIES} Versuchen keine Rechnungskorrektur erzeugt werden. Bitte von Hand ausstellen (Bestellnummer und Betrag stehen bei der Zahlung im Stripe-Dashboard).`,
    customer: `ist die Rechnungskorrektur ${c?.number} erzeugt, konnte aber nach ${INVOICE_TRIES} Versuchen nicht an die Kundin (${c?.email}) verschickt werden.`,
    owner: `ist die Rechnungskorrektur ${c?.number} an die Kundin verschickt, aber die Kopie für die Buchhaltung kam nach ${INVOICE_TRIES} Versuchen nicht zustande.`,
  }[step];
  const text = `Zur Erstattung ${job.refund} ${what}`;
  const mail = { to: env.OWNER_EMAIL, subject: `RECHNUNGSKORREKTUR FEHLT: Erstattung ${job.refund}` };
  if (base64 && c) {
    try {
      await sendMail(env, { ...mail, text: `${text}\n\nDie Korrektur hängt an: bitte ${step === 'customer' ? 'an die Kundin weiterleiten und ' : ''}8 Jahre aufbewahren (§ 147 AO, § 14b UStG).`, attachments: [{ filename: c.filename, base64 }] });
      return;
    } catch (err) { console.error('correction warning with attachment', err); }
  }
  await sendMail(env, { ...mail, text: step === 'build' ? text : `${text}\n\nDie Korrektur ließ sich nicht anhängen. Bitte von Hand ausstellen.` });
}

// ---------- handlers ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function handleSlots(env) {
  return json(await freeSlots(env));
}

async function handleCheckout(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const { errors, order } = validateOrder(body);
  if (errors.length) return json({ error: errors.join(' ') }, 400);
  // German site /de/ (Sandra, 18.10.2026): messages, Stripe page and return pages in German
  const ui = body.site === 'de' ? 'de' : 'en';
  const T = (en, de) => (ui === 'de' ? de : en);
  if (await rateLimited(env, request, 'checkout', 5)) return json({ error: T('Too many attempts. Please wait an hour or email hello@astrostrip.com.', 'Zu viele Versuche. Bitte warte eine Stunde oder schreib an hello@astrostrip.com.') }, 429);
  const state = await usedSlots(env);
  const slots = freeSlotsFrom(state);
  const slot = slots[order.strip];
  if (!slot.next) return json({ error: T(`This strip is fully booked until ${longDate(slot.until)}. New weeks open every Monday.`, `Dieser Strip ist bis ${longDate(slot.until, 'de')} ausgebucht. Jeden Montag kommen neue Wochen dazu.`), soldOut: true, slots }, 409);
  if (order.week && order.week !== slot.next) {
    return json({ error: T(`Someone was quicker: the next free week for this strip is now the week of ${longDate(slot.next)}. Please check and continue again.`, `Jemand war schneller: Die nächste freie Woche für diesen Strip ist jetzt die Woche ab ${longDate(slot.next, 'de')}. Bitte prüfe das und mach dann weiter.`), weekChanged: true, slots }, 409);
  }
  order.week = slot.next;
  order.thisWeek = slot.thisWeek;
  const now = Date.now();
  // Transit Weekly with the strip (Sandra, 11.10.2026): part 1 is read in the week of the strip's delivery deadline
  // (or the next week with room), the first email goes out the Monday after.
  if (order.transit) {
    const deadline = servicePeriod(order, STRIPS[order.strip], berlinYmd(now)).end;
    const plan = planTransit(state, weekStart(Date.parse(deadline + 'T12:00:00Z')), order.transit.areas.length, now);
    if (!plan) return json({ error: T('Transit Weekly is fully booked for the weeks after your strip. You can order the strip alone and add Transit Weekly later with your order number.', 'Transit Weekly ist für die Wochen nach deinem Strip ausgebucht. Du kannst den Strip allein bestellen und Transit Weekly später mit deiner Bestellnummer dazubuchen.'), transitSoldOut: true, slots }, 409);
    Object.assign(order.transit, plan);
  }
  return createCheckout(request, env, order, { week: String(slot.nextStart), now, cancelUrl: `order.html?strip=${order.strip}&cancelled=1`, ui });
}

// Stripe Checkout for a strip and/or Transit Weekly. Birth data stays in KV until payment, never goes to Stripe.
async function createCheckout(request, env, order, { week, now, cancelUrl, ui = 'en' }) {
  const id = orderId(now);
  order.createdAt = now;
  const s = STRIPS[order.strip];
  const t = order.transit;
  if (t) { const p = await twPrice(env); t.unitCents = p.cents; t.founding = p.founding; }
  const site = env.SITE_URL || new URL(request.url).origin;
  const items = [];
  // Ordered on the German site: the Stripe page in German, and back to /de/ (Sandra, 18.10.2026)
  const de = ui === 'de';
  const back = de ? 'de/' : '';
  if (s) items.push({ quantity: 1, price_data: { currency: 'eur', unit_amount: s.cents, product_data: { name: s.name, description: de
    ? `${STRIP_TAG_DE[order.strip]}. Persönliche Deutung, eigens für dein Horoskop, als PDF per E-Mail. ${deliveryText(order, 'de')}. Preis inklusive 19 % MwSt.`
    : `${s.tag}. Personal reading prepared for your chart, PDF by email ${deliveryText(order)}. Price includes 19 % VAT.` } } });
  // Extra layers as their own lines (Sandra, 19.10.2026)
  const nAst = s ? order.asteroids?.length || 0 : 0;
  if (nAst) items.push({ quantity: 1, price_data: { currency: 'eur', unit_amount: asteroidCents(nAst), product_data: de
    ? { name: `Asteroiden (${nAst}): ${asteroidList(order)}`, description: `Zusatz-Ebene zum ${s.name}: drei Asteroiden 15 €, jeder weitere 3 €. Preis inklusive 19 % MwSt.` }
    : { name: `Asteroids (${nAst}): ${asteroidList(order)}`, description: `Extra layer for your ${s.name}: three asteroids 15 €, each further one 3 €. Price includes 19 % VAT.` } } });
  if (s && order.ancestry) items.push({ quantity: 1, price_data: { currency: 'eur', unit_amount: EXTRAS.ancestryCents, product_data: de
    ? { name: 'Ahnenschicht', description: `Zusatz-Ebene zum ${s.name}: Muster, die in deiner Familie weiterlaufen können. Preis inklusive 19 % MwSt.` }
    : { name: 'Ancestral layer', description: `Extra layer for your ${s.name}: patterns that may run in your family. Price includes 19 % VAT.` } } });
  if (t) items.push({ quantity: t.areas.length, price_data: { currency: 'eur', unit_amount: t.unitCents, product_data: de
    ? { name: `Transit Weekly · 13 Wochen je Lebensbereich${t.founding ? ' · Gründungspreis' : ''}`, description: `Wöchentliche Transit-Mails für ${t.areas.map(a => AREA_DE[a] || a).join(', ')}, jeden Montag ab ${longDate(t.start, 'de')}, 13 Wochen lang (${euro(t.unitCents / 3)} im Monat je Bereich). Endet von selbst. Preis inklusive 19 % MwSt.` }
    : { name: `Transit Weekly · 13 weeks per life area${t.founding ? ' · founding price' : ''}`, description: `Weekly transit emails for ${t.areas.join(', ')}, every Monday from ${longDate(t.start)} for 13 weeks (${euro(t.unitCents / 3)} a month per area). Ends by itself. Price includes 19 % VAT.` } } });
  const meta = { order_id: id, strip: order.strip, week: s ? week : undefined, tw_week: t ? String(mondayOnOrAfter(t.readWeek)) : undefined, tw_week2: t && t.readWeek2 ? String(mondayOnOrAfter(t.readWeek2)) : undefined, tw_n: t ? String(t.areas.length) : undefined, tw_unit: t ? String(t.unitCents) : undefined, tw_start: t ? t.start : undefined, base: order.base || undefined, ast: nAst ? order.asteroids.join(',') : undefined, anc: s && order.ancestry ? '1' : undefined };
  const session = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    locale: order.language === 'de' || de ? 'de' : 'en',
    customer_email: order.email,
    billing_address_collection: 'required', // for the invoice (Sandra, 02.10.2026)
    submit_type: 'pay',
    client_reference_id: id,
    expires_at: Math.floor(now / 1000) + SESSION_MINUTES * 60,
    success_url: `${site}/${back}thanks.html?order=${id}`,
    cancel_url: `${site}/${back}${cancelUrl}`,
    line_items: Object.fromEntries(items.map((x, i) => [i, x])),
    metadata: meta,
    payment_intent_data: { metadata: { ...meta, week: s ? order.week : undefined } },
    custom_text: { submit: { message: de
      ? `Mit der Zahlung bestellst du verbindlich ${s ? 'den ' : ''}${productLabel(order, 'de')} (${euro(orderCents(order))} inkl. 19 % MwSt.).`
      : `By paying you place a binding order for ${s ? 'the ' : ''}${productLabel(order)} (${euro(orderCents(order))} incl. 19 % VAT).` } },
  });
  // Order details wait here until payment; kept at most 2 days.
  await env.ORDERS.put(`order:${session.id}`, JSON.stringify({ id, ...order }), { expirationTtl: 172800 });
  return json({ url: session.url, orderId: id, transit: t ? { start: t.start, end: t.end } : undefined });
}

// The paid Maxi/Ultra Strip behind a later Transit Weekly booking: same order number, same email, not fully
// refunded, ordered at most TW_BOOKABLE_YEARS calendar years ago. One generic answer for every failure, so the
// form cannot be used to find out order numbers or addresses.
export async function findStripPayment(env, base, email, nowMs = Date.now()) {
  const found = await stripe(env, 'GET', 'payment_intents/search', { query: `metadata['order_id']:'${base}'`, 'expand[]': 'data.latest_charge' });
  const pi = (found.data || []).find(p => p.status === 'succeeded' && (p.metadata?.strip === 'maxi' || p.metadata?.strip === 'ultra'));
  if (!pi || pi.latest_charge?.refunded === true) return null;
  if (Number(berlinYmd(pi.created * 1000).slice(0, 4)) + TW_BOOKABLE_YEARS < Number(berlinYmd(nowMs).slice(0, 4))) return { tooOld: true };
  const session = (await stripe(env, 'GET', 'checkout/sessions', { payment_intent: pi.id, limit: 1 })).data[0] || {};
  const paidBy = String(session.customer_details?.email || session.customer_email || pi.receipt_email || '').toLowerCase();
  if (!paidBy || paidBy !== email.toLowerCase()) return null;
  return { pi };
}

// Running Transit Weekly bookings of a strip order (tw:<strip order>:<order>).
async function transitBookings(env, base) {
  const out = [];
  const page = await env.ORDERS.list({ prefix: `tw:${base}:`, limit: 100 });
  for (const { name } of page.keys) { const raw = await env.ORDERS.get(name); if (raw) out.push({ key: name, ...JSON.parse(raw) }); }
  return out;
}

async function handleRebook(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const { errors, order } = validateRebook(body);
  if (errors.length) return json({ error: errors.join(' ') }, 400);
  const ui = body.site === 'de' ? 'de' : 'en'; // German site /de/ (Sandra, 18.10.2026)
  const T = (en, de) => (ui === 'de' ? de : en);
  if (await rateLimited(env, request, 'rebook', 5)) return json({ error: T('Too many attempts. Please wait an hour or email hello@astrostrip.com.', 'Zu viele Versuche. Bitte warte eine Stunde oder schreib an hello@astrostrip.com.') }, 429);
  const now = Date.now();
  const paid = await findStripPayment(env, order.base, order.email, now);
  if (paid?.tooOld) return json({ error: T('This order is too old to add Transit Weekly: we no longer keep its reading. Please order a new Maxi or Ultra Strip first.', 'Diese Bestellung ist zu alt, um Transit Weekly dazuzubuchen: Ihre Deutung bewahren wir nicht mehr auf. Bitte bestell zuerst einen neuen Maxi oder Ultra Strip.') }, 400);
  if (!paid) return json({ error: T('We could not find a paid Maxi or Ultra Strip with this order number and email address. Please check both (the email you used for the strip), or write to hello@astrostrip.com.', 'Wir haben zu dieser Bestellnummer und E-Mail-Adresse keinen bezahlten Maxi oder Ultra Strip gefunden. Bitte prüfe beides (die E-Mail-Adresse, mit der du den Strip bestellt hast) oder schreib an hello@astrostrip.com.') }, 400);
  // Renewal: an area that still runs continues seamlessly, the Monday after its last week.
  const today = berlinYmd(now);
  const running = (await transitBookings(env, order.base)).filter(b => b.end >= today && b.areas.some(a => order.transit.areas.includes(a)));
  const seamless = running.length ? addWeeks(mondayOnOrAfter(running.map(b => b.end).sort().pop()), 0) : 0;
  const state = await usedSlots(env, now);
  // Booked later: part 1 this week if at least three days are left (Mon–Thu), else next week.
  const from = Math.max(weekStart(now + 3 * 86400000), seamless ? addWeeks(seamless, -1) : 0);
  if (seamless && !state.twWeeks.includes(from)) {
    return json({ error: T(`Your Transit Weekly runs until ${longDate(running.map(b => b.end).sort().pop())}. You can renew it from ${longDate(weekDate(addWeeks(from, -(TW_WEEKS_AHEAD - 1))))}.`,
      `Dein Transit Weekly läuft bis ${longDate(running.map(b => b.end).sort().pop(), 'de')}. Verlängern kannst du ab ${longDate(weekDate(addWeeks(from, -(TW_WEEKS_AHEAD - 1))), 'de')}.`) }, 409);
  }
  const plan = planTransit(state, from, order.transit.areas.length, now, seamless);
  if (!plan) return json({ error: T(`Transit Weekly is fully booked until ${longDate(freeSlotsFrom(state).transit.until)}. New weeks open every Monday.`, `Transit Weekly ist bis ${longDate(freeSlotsFrom(state).transit.until, 'de')} ausgebucht. Jeden Montag kommen neue Wochen dazu.`), transitSoldOut: true }, 409);
  Object.assign(order.transit, plan);
  if (seamless) order.renews = running.map(b => b.order).join(', ');
  return createCheckout(request, env, order, { now, cancelUrl: 'transit-weekly.html?cancelled=1', ui });
}

// After payment: the booking the weekly emails will run on (Stufe 6), kept until 14 days after the term ends.
// Only what the emails need: no name, no birth data, no city (Sandra, 11.10.2026).
async function storeTransitBooking(env, order, nowMs) {
  const t = order.transit;
  const base = order.base || order.id;
  const expiration = Math.floor(Date.parse(t.end + 'T12:00:00Z') / 1000) + 15 * 86400;
  const booking = { order: order.id, base, email: order.email, language: order.language, areas: t.areas, tz: t.tz, tzLabel: t.tzLabel, exactTime: !t.timeConsent, readWeek: t.readWeek, readWeek2: t.readWeek2 || null, part1Weeks: t.part1Weeks || TRANSIT.weeks, start: t.start, end: t.end, bookedAt: isoUtc(nowMs), expiration };
  await putBooking(env, `tw:${base}:${order.id}`, booking);
}

// Every write of a booking goes through here: the KV metadata carries a short summary without the email,
// so the Monday list, the Friday check and the send run read all bookings with one list call instead of
// one get per booking (free plan: 50 subrequests per invocation, KV calls included; Cloudflare limits page,
// read 11.10.2026).
const AREA_SLUGS = ['love', 'work', 'money', 'home', 'creativity', 'friends', 'growth'];
export const areaSlug = area => AREA_SLUGS[LIFE_AREAS.indexOf(area)] || '';
export const slugArea = slug => LIFE_AREAS[AREA_SLUGS.indexOf(slug)] || '';
export const twMeta = b => ({ o: b.order, b: b.base, s: b.start, e: b.end, a: b.areas.map(areaSlug), r1: b.readWeek, r2: b.readWeek2 || null, p1: b.part1Weeks || TRANSIT.weeks, n: b.notice ? { kind: b.notice.kind, at: b.notice.at } : null, x: b.stopped ? b.stopped.reason : null });
export const fromMeta = m => ({ order: m.o, base: m.b, start: m.s, end: m.e, areas: m.a.map(slugArea), readWeek: m.r1, readWeek2: m.r2, part1Weeks: m.p1, notice: m.n, stopped: m.x ? { reason: m.x } : null });
async function putBooking(env, key, booking) {
  await env.ORDERS.put(key, JSON.stringify(booking), { ...(booking.expiration ? { expiration: booking.expiration } : {}), metadata: twMeta(booking) });
}
// All bookings as summaries (fromMeta), from the list metadata; a key without metadata is read once.
async function bookingSummaries(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'tw:', limit: 1000, cursor });
    for (const { name, metadata } of page.keys) {
      if (metadata) out.push({ key: name, ...fromMeta(metadata) });
      else { const raw = await env.ORDERS.get(name); if (raw) out.push({ key: name, ...JSON.parse(raw) }); }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

async function handleWebhook(request, env) {
  const body = await request.text();
  const ok = await verifyStripeSignature(body, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Invalid signature', { status: 400 });
  const event = JSON.parse(body);
  if (event.type === 'refund.created') {
    const refund = event.data.object;
    await env.ORDERS.put(`correction:${refund.id}`, JSON.stringify({ refund: refund.id, attempts: 0 }), { expirationTtl: INVOICE_TTL });
    return new Response('queued');
  }
  if (event.type === 'refund.failed') {
    const refund = event.data.object;
    await sendMail(env, { to: env.OWNER_EMAIL, subject: `ERSTATTUNG FEHLGESCHLAGEN: ${refund.id}`, text: `Stripe meldet, dass die Erstattung ${refund.id} (${(refund.amount / 100).toFixed(2).replace('.', ',')} €, Zahlung ${refund.payment_intent}) fehlgeschlagen ist. Falls schon eine Rechnungskorrektur verschickt wurde, stimmt sie jetzt nicht mehr: Kundin anschreiben, Geld auf anderem Weg erstatten oder die Korrektur von Hand aufheben.` });
    return new Response('ok');
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return new Response('ignored');
  const session = event.data.object;
  if (session.payment_status !== 'paid') return new Response('not paid yet');
  const key = `order:${session.id}`;
  const raw = await env.ORDERS.get(key);
  if (!raw) {
    // Already handled, or the stored order expired: tell Sandra so nothing gets lost.
    await sendMail(env, { to: env.OWNER_EMAIL, subject: `Zahlung ohne gespeicherte Bestelldaten: ${session.metadata?.order_id || session.id}`, text: `Stripe meldet eine bezahlte Session (${session.id}, ${session.customer_details?.email || session.customer_email}), zu der keine Bestelldaten mehr gespeichert sind. Falls das keine doppelte Meldung ist: Kundin anschreiben und Geburtsdaten erfragen.` });
    return new Response('no order data');
  }
  const order = JSON.parse(raw);
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `Bestellung ${order.id}: ${productLabel(order, 'de')}`, text: ownerOrderMail(order, order.id, session), replyTo: order.email });
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `Deutungsdaten ${order.id}`, text: ownerReadingMail(order, order.id) });
  await sendMail(env, { to: order.email, subject: `Your ${productLabel(order)} order ${order.id}`, text: customerMail(order, order.id, env), html: customerMailHtml(order, order.id, env), replyTo: env.MAIL_FROM_ADDRESS || 'hello@astrostrip.com' });
  if (order.transit) await storeTransitBooking(env, order, Date.now());
  if (order.transit?.founding) await countFounding(env, order.id);
  if (STRIPS[order.strip]) await queueInvoice(env, order, session);
  if (order.transit) await queueTransitInvoice(env, order, session);
  await env.ORDERS.delete(key);
  await afterOrderMarketing(env, order);
  return new Response('ok');
}

async function handleWithdraw(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const name = clean(b.name, 120);
  const contract = clean(b.contract, 120);
  if (name.length < 2 || contract.length < 2 || !isEmail(b.email)) return json({ error: 'Please fill in your name, your order number or order details, and your email address.' }, 400);
  if (await rateLimited(env, request, 'withdraw', 3)) return json({ error: 'Too many attempts. Please email your withdrawal to hello@astrostrip.com instead.' }, 429);
  const now = Date.now();
  const received = berlinStamp(now);
  const receivedEn = berlinStamp(now, 'en');
  // A withdrawal ends the contract at once: running Transit Weekly bookings behind the number pause until
  // Sandra decides (Sandra, 11.10.2026); she resumes them with tools/transit-weekly-hochladen.py --weiter.
  const paused = [];
  for (const { key: k, ...bk } of await findBookings(env, contract, b.email)) {
    if (bk.stopped) continue;
    bk.stopped = { reason: 'withdrawal', at: isoUtc(now) };
    await putBooking(env, k, bk);
    paused.push(bk.order);
  }
  const langs = await receiptLangs(env, contract, b.email);
  const text = withdrawalReceipt({ name, contract, email: b.email, received, receivedEn, langs });
  await sendMail(env, { to: b.email, subject: `${receiptSubject(langs, 'Eingangsbestätigung Widerruf', 'Receipt of your withdrawal')} (${contract})`, text, html: brandFromText(text, { kicker: receiptSubject(langs, 'Widerruf eingegangen', 'Withdrawal received').replace(' / ', ' · '), lang: langs[0] }) });
  const twNote = paused.length ? `\n\nTransit Weekly: Versand für ${paused.join(', ')} automatisch pausiert. Betrifft der Widerruf nur den Strip, fortsetzen mit: python3 tools/transit-weekly-hochladen.py --weiter ${paused[0]}` : '';
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `WIDERRUF eingegangen: ${contract}`, text: `Widerruf über die Website, eingegangen ${received}.\n\nName: ${name}\nVertrag: ${contract}\nE-Mail: ${b.email}\n\nEingangsbestätigung ist automatisch rausgegangen. Erstattung spätestens 14 Tage nach Eingang, anteilig, falls schon mit dem Schreiben begonnen wurde. Erstatten im Stripe-Dashboard; die Rechnungskorrektur geht dann automatisch an die Kundin. ${langNote(langs)}${twNote}` , replyTo: b.email });
  return json({ ok: true, received, receivedEn, langs });
}

// Cancellation button (§ 312k BGB, wording of the law read on gesetze-im-internet.de, 11.10.2026): the page asks for
// the kind of notice (and the reason for notice for good cause), name, email and contract; "jetzt kündigen" sends it.
// Transit Weekly ends by itself after 13 weeks; ordinary notice takes effect at the end of the term (Sandra,
// 11.10.2026). The Worker confirms at once with content, date and time of receipt and the end of the contract.
export function cancellationReceipt({ name, contract, email, kind, reason, received, receivedEn, endDe, endEn, langs = ['de', 'en'] }) {
  const extra = kind === 'extraordinary';
  const de = [
    `Hallo ${name},`,
    '',
    'wir haben Ihre Kündigung erhalten. Diese E-Mail bestätigt den Eingang.',
    '',
    `Eingegangen: ${received}`,
    `Name: ${name}`,
    `Vertrag: ${contract}`,
    `Bestätigung an: ${email}`,
    `Art der Kündigung: ${extra ? 'außerordentliche Kündigung aus wichtigem Grund' : 'ordentliche Kündigung'}`,
    extra ? `Kündigungsgrund: ${reason}` : null,
    `Ihre Erklärung: Hiermit kündige ich den oben genannten Vertrag.`,
    `Der Vertrag endet: ${endDe}`,
  ];
  const en = [
    `Hi ${name},`,
    '',
    'we have received your notice of termination. This email confirms its receipt.',
    '',
    `Received: ${receivedEn}`,
    `Name: ${name}`,
    `Contract: ${contract}`,
    `Confirmation sent to: ${email}`,
    `Kind of notice: ${extra ? 'termination for good cause' : 'ordinary notice'}`,
    extra ? `Reason: ${reason}` : null,
    'Your declaration: I hereby terminate the contract named above.',
    `The contract ends: ${endEn}`,
  ];
  return receiptJoin(langs, de, en);
}

// The bookings behind an order number in a form field, if the email matches: a Transit Weekly order (also
// with "-T", its invoice number), or all Transit Weekly bookings of a strip order.
async function findBookings(env, contract, email) {
  const id = (String(contract).toUpperCase().match(/AS-\d{8}-[A-Z0-9]{5}(-T)?/) || [''])[0];
  const found = [];
  if (!id) return found;
  const page = await env.ORDERS.list({ prefix: 'tw:', limit: 1000 });
  for (const { name: k } of page.keys) {
    const [, base, oid] = k.split(':');
    if (base !== id && oid !== id && `${oid}-T` !== id) continue;
    const bk = JSON.parse((await env.ORDERS.get(k)) || 'null');
    if (bk && bk.email.toLowerCase() === String(email).trim().toLowerCase()) found.push({ key: k, ...bk });
  }
  return found;
}

async function handleCancel(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const name = clean(b.name, 120);
  const contract = clean(b.contract, 120);
  const kind = b.kind === 'extraordinary' ? 'extraordinary' : 'ordinary';
  const reason = clean(b.reason, 500);
  if (name.length < 2 || contract.length < 2 || !isEmail(b.email)) return json({ error: 'Please fill in your name, your order number and your email address.' }, 400);
  if (kind === 'extraordinary' && reason.length < 3) return json({ error: 'For termination for good cause, please state the reason.' }, 400);
  if (await rateLimited(env, request, 'cancel', 3)) return json({ error: 'Too many attempts. Please email your notice to hello@astrostrip.com instead.' }, 429);
  const now = Date.now();
  const received = berlinStamp(now);
  const receivedEn = berlinStamp(now, 'en');
  // The bookings behind the order number, if the email matches: a Transit Weekly order, or all Transit Weekly
  // bookings of a strip order. The confirmation names the latest end.
  const found = await findBookings(env, contract, b.email);
  const booking = found.length ? { ...found.sort((x, y) => (x.end < y.end ? 1 : -1))[0], key: found.map(x => x.key).join(', '), areas: [...new Set(found.flatMap(x => x.areas))] } : null;
  const endDe = kind === 'extraordinary' ? `mit sofortiger Wirkung, sofern ein wichtiger Grund vorliegt (eingegangen ${received})`
    : booking ? `zum Ende der Laufzeit am ${longDate(booking.end, 'de')}` : 'zum frühestmöglichen Zeitpunkt, dem Ende der gebuchten Laufzeit';
  const endEn = kind === 'extraordinary' ? `with immediate effect, provided there is good cause (received ${receivedEn})`
    : booking ? `at the end of the term on ${longDate(booking.end)}` : 'at the earliest possible time, the end of the booked term';
  for (const { key: k, ...bk } of found) {
    bk.notice = { kind, reason, at: isoUtc(now) };
    await putBooking(env, k, bk);
  }
  const langs = await receiptLangs(env, contract, b.email);
  const text = cancellationReceipt({ name, contract, email: b.email, kind, reason, received, receivedEn, endDe, endEn, langs });
  await sendMail(env, { to: b.email, subject: `${receiptSubject(langs, 'Eingangsbestätigung Kündigung', 'Receipt of your notice')} (${contract})`, text, html: brandFromText(text, { kicker: receiptSubject(langs, 'Kündigung eingegangen', 'Notice received').replace(' / ', ' · '), lang: langs[0] }) });
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `KÜNDIGUNG eingegangen: ${contract}`, replyTo: b.email, text: [
    `Kündigung über die Website, eingegangen ${received}.`, '',
    `Name: ${name}`, `Vertrag: ${contract}`, `E-Mail: ${b.email}`, `Art: ${kind === 'extraordinary' ? 'außerordentlich' : 'ordentlich'}`, kind === 'extraordinary' ? `Grund: ${reason}` : null, '',
    booking ? `Buchung gefunden (${booking.key}), Bereiche ${booking.areas.join(', ')}, Laufzeit bis ${booking.end}; Kündigung dort vermerkt.` : 'Keine laufende Transit-Weekly-Buchung mit dieser Nummer und E-Mail gefunden: bitte prüfen (Tippfehler, andere E-Mail, Strip statt Transit Weekly?).',
    kind === 'extraordinary' ? 'Außerordentliche Kündigung: wichtigen Grund prüfen. Liegt er vor, endet der Vertrag sofort; dann Versand stoppen und über eine Erstattung der offenen Wochen entscheiden. Sonst der Kundin antworten, dass der Vertrag bis zum Laufzeitende weiterläuft.' : 'Ordentliche Kündigung: Transit Weekly läuft bis zum Ende der 13 Wochen weiter, keine Erstattung (AGB).',
    `Die Eingangsbestätigung ist automatisch an die Kundin gegangen. ${langNote(langs)}`,
  ].filter(l => l !== null).join('\n') });
  return json({ ok: true, received, receivedEn, endDe, endEn, langs });
}

async function handleSubscribe(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (b.website) return json({ ok: true }); // honeypot: bots fill the hidden field
  if (!isEmail(b.email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (b.consent !== true) return json({ error: 'Please tick the box to agree to the newsletter.' }, 400);
  if (await rateLimited(env, request, 'subscribe', 5)) return json({ error: 'Too many attempts. Please try again later.' }, 429);
  const source = ['calculator', 'newsletter-page', 'footer', 'guide'].includes(b.source) ? b.source : 'website';
  await startDoubleOptIn(env, String(b.email).trim(), source, request.headers.get('CF-Connecting-IP') || '', b.lang);
  return json({ ok: true }); // same answer whether or not the address is already subscribed
}

async function handleConfirm(request, env) {
  const site = env.SITE_URL || new URL(request.url).origin;
  const params = new URL(request.url).searchParams;
  const token = params.get('t') || '';
  const raw = /^[0-9a-f]{64}$/.test(token) ? await env.ORDERS.get(`doi:${token}`) : null;
  // also for the guide: sign up again on the newsletter page, in the language of the link
  if (!raw) return Response.redirect(`${site}/${params.get('l') === 'de' ? 'de/' : ''}newsletter.html?status=expired`, 303);
  const d = JSON.parse(raw);
  const de = d.lang === 'de';
  await mailjetList(env, env.MAILJET_NEWSLETTER_LIST_ID, d.email, 'addforce');
  await logConsent(env, d.email, {
    type: 'newsletter-optin', version: d.version, source: d.source, lang: de ? 'de' : 'en',
    requestedAt: isoUtc(d.requestedAt), confirmedAt: isoUtc(Date.now()),
    ipRequest: d.ip || '', ipConfirm: request.headers.get('CF-Connecting-IP') || '',
  });
  await env.ORDERS.delete(`doi:${token}`);
  if (d.source === 'guide') {
    // The guide the person asked for: a service mail with the link, so it is not lost with the browser tab.
    // The button leads to the guide page, not straight to the PDF: a direct file link is a spam signal (Sandra, 21.10.2026).
    const page = `${site}/${de ? 'de/' : ''}guide.html?status=confirmed`;
    const link = (href, label) => `<a href="${href}" style="color:${TWM.accent};text-decoration:underline;">${label}</a>`;
    try {
      await sendMail(env, de ? {
        to: d.email,
        subject: 'Dein Leitfaden von astro.strip',
        text: ['Danke für deine Bestätigung. Hier ist dein Leitfaden:', page, '', ADDRESS_LINE].join('\n'),
        html: brandMail({ lang: 'de', kicker: 'Dein Leitfaden', pre: 'Danke für deine Bestätigung.', body: [
          bH1('Dein Geburtshoroskop,<br>bis auf den Grad genau.', 28),
          bP('Danke für deine Bestätigung. Hier ist dein Leitfaden, der erste Schritt zu deinem eigenen Horoskop: wie ein Horoskop aufgebaut ist, wofür Planeten, Zeichen, Häuser und Aspekte stehen und warum es auf den genauen Grad ankommt.'),
          bButton('Zum Leitfaden', page),
          bRule,
          bP(`Nächster Schritt: Finde kostenlos deinen genauen Sonnengrad auf ${link(`${site}/de/`, 'astrostrip.com')} oder stöbere in ${link(`${site}/de/degrees`, 'allen 360 Graden')}.`, 15, TWM.muted),
        ].join('\n') }),
      } : {
        to: d.email,
        subject: 'Your guide from astro.strip',
        text: ['Thank you for confirming. Here is your guide:', page, '', ADDRESS_LINE].join('\n'),
        html: brandMail({ kicker: 'Your guide', pre: 'Thank you for confirming.', body: [
          bH1('The birth chart,<br>stripped to the degree.', 28),
          bP('Thank you for confirming. Here is your guide, a first step to understanding your own chart: how a chart is built, what planets, signs, houses and aspects stand for, and why the degree changes everything.'),
          bButton('Go to the guide', page),
          bRule,
          bP(`Next step: find your exact Sun degree for free on ${link(`${site}/`, 'astrostrip.com')}, or browse ${link(`${site}/degrees`, 'all 360 degrees')}.`, 15, TWM.muted),
        ].join('\n') }),
      });
    } catch (err) {
      console.error('guide mail failed', err); // the page still shows the download
    }
    return Response.redirect(`${site}/${de ? 'de/' : ''}guide.html?status=confirmed`, 303);
  }
  return Response.redirect(`${site}/${de ? 'de/' : ''}newsletter.html?status=confirmed`, 303);
}

// ---------- statistics (Sandra, 07.10.2026: own, cookieless counting, sums only) ----------
const STATS_DATASET = 'astrostrip_stats'; // must match wrangler.jsonc analytics_engine_datasets
const STAT_SRC = new Set(['ig', 'tt', 'direct']);
const STAT_CARD = new Set(['mini', 'maxi', 'ultra']);
// Countries with fewer visits per week are only stored as one sum (Sandra, 09.10.2026: "unter 5 zusammenfassen"),
// so a single visit from a rare country cannot be picked out of the permanent weekly entry.
export const STAT_MIN_COUNTRY = 5;
// ISO 3166-1 alpha-2 from request.cf.country; anything else (missing, "XX" unknown, "T1" Tor) counts as "XX".
const statCountry = request => { const c = request.cf && request.cf.country; return typeof c === 'string' && /^[A-Z]{2}$/.test(c) ? c : 'XX'; };
// Monday 01:10 UTC, always after Monday 00:00 Berlin. Weekday as "MON", never as a number: Cloudflare counts 1 = Sunday
// (developers.cloudflare.com/workers/configuration/cron-triggers/); "10 1 * * 1" ran on Sundays until 19.10.2026, so the
// Monday report found no sum. Must match wrangler.jsonc exactly (event.cron is the configured string).
export const STATS_ROLLUP_CRON = '10 1 * * MON';
// First counted week (counting live since 09.10.2026); the rollup never looks further back.
const STATS_FIRST_WEEK = '2026-10-05';
// Weeks the rollup looks back for a missing sum (Analytics Engine keeps raw points about 3 months).
const STATS_CATCHUP_WEEKS = 8;

// A visit (by source, estimated country and page language en/de, Sandra 19.10.2026) or a click on one of the three preview tabs. No IP, no cookie,
// no per-visitor id — only the categories are written to Workers Analytics Engine. Always 204, even on a bad body: this must
// never surface an error to a visitor or cost more than a trivial amount of CPU.
async function handleStat(request, env) {
  let b;
  try { b = await request.json(); } catch { return new Response(null, { status: 204 }); }
  if (!env.STATS || !b || typeof b !== 'object') return new Response(null, { status: 204 });
  if (b.event === 'visit') env.STATS.writeDataPoint({ blobs: ['visit', STAT_SRC.has(b.src) ? b.src : 'direct', statCountry(request), b.lang === 'de' ? 'de' : 'en'], indexes: ['visit'] });
  else if (b.event === 'click' && STAT_CARD.has(b.card)) env.STATS.writeDataPoint({ blobs: ['click', b.card], indexes: ['click'] });
  return new Response(null, { status: 204 });
}

// Sums last week's events via the Analytics Engine SQL API into one small, permanent KV entry (Analytics
// Engine itself keeps raw data only 3 months). Runs Mondays; skips if that week's key already exists.
// Afterwards it fills older weeks without a sum (back to STATS_FIRST_WEEK, at most STATS_CATCHUP_WEEKS), e.g. a week
// missed by the Sunday cron until 19.10.2026 or by a failed run; only finished weeks, never the current one.
export async function runStatsRollup(env, nowMs = Date.now()) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_READ_TOKEN) return { skipped: 'CF_ACCOUNT_ID or CF_ANALYTICS_READ_TOKEN not set' };
  const current = weekStart(nowMs);
  const result = await rollupWeek(env, addWeeks(current, -1));
  if (result.error) return result;
  const caughtUp = [];
  for (let i = 2; i <= STATS_CATCHUP_WEEKS; i++) {
    const w = addWeeks(current, -i);
    if (weekDate(w) < STATS_FIRST_WEEK) break;
    const r = await rollupWeek(env, w);
    if (r.error) break;
    if (r.week) caughtUp.push(r.week);
  }
  return caughtUp.length ? { ...result, caughtUp } : result;
}

async function rollupWeek(env, lastWeek) {
  const key = `stats:week:${weekDate(lastWeek)}`;
  if (await env.ORDERS.get(key)) return { skipped: key };
  // SUM(_sample_interval), not COUNT(): Analytics Engine may sample (developers.cloudflare.com/analytics/analytics-engine/sql-api/)
  const sql = `SELECT blob1, blob2, blob3, blob4, SUM(_sample_interval) AS n FROM ${STATS_DATASET} WHERE timestamp >= toDateTime(${lastWeek}) AND timestamp < toDateTime(${lastWeek + 7 * 86400}) GROUP BY blob1, blob2, blob3, blob4`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CF_ANALYTICS_READ_TOKEN}` }, body: sql,
  });
  if (!res.ok) return { error: await res.text() };
  const summary = { visit: { ig: 0, tt: 0, direct: 0 }, click: { mini: 0, maxi: 0, ultra: 0 }, lang: { en: 0, de: 0 } };
  const byCountry = {}; // source and country are summed separately, never crossed (Sandra, 09.10.2026)
  for (const row of (await res.json()).data || []) {
    const n = Number(row.n) || 0;
    if (summary[row.blob1] && row.blob2 in summary[row.blob1]) summary[row.blob1][row.blob2] += n;
    if (row.blob1 === 'visit') { const c = /^[A-Z]{2}$/.test(row.blob3 || '') ? row.blob3 : 'XX'; byCountry[c] = (byCountry[c] || 0) + n; }
    if (row.blob1 === 'visit') summary.lang[row.blob4 === 'de' ? 'de' : 'en'] += n; // points before 19.10.2026 have no language: English page
  }
  summary.country = {};
  summary.countryOther = { visits: 0, countries: 0 };
  for (const [c, n] of Object.entries(byCountry)) {
    if (n >= STAT_MIN_COUNTRY) summary.country[c] = n;
    else { summary.countryOther.visits += n; summary.countryOther.countries += 1; }
  }
  await env.ORDERS.put(key, JSON.stringify(summary)); // no expirationTtl: aggregate counts, no personal data
  return { week: weekDate(lastWeek), summary };
}

// Reading list for Sandra (Sandra, 11.10.2026: "eine Vorlage der fälligen Texte zum richtigen Zeitpunkt"): every
// Monday, if anything is due, one mail with the Transit Weekly parts to read this week and the first emails going
// out. Pseudonymous: order number, life areas, weeks, deadlines; no email address, no name.
export function readingList(bookings, weekYmd) {
  const next = addDays(weekYmd, 7);
  const rows = [];
  for (const b of bookings) {
    const p1 = b.part1Weeks || TRANSIT.weeks;
    if (b.readWeek === weekYmd) rows.push(`${b.order} · ${b.areas.join(', ')} · Teil 1, Wochen 1–${p1} · fertig vor der ersten Mail am ${b.start}${b.base !== b.order ? ` (nachgebucht zu ${b.base})` : ''} · in der Session mit der Deutungsdaten-Mail schreiben`);
    if (b.readWeek2 === weekYmd) rows.push(`${b.order} · ${b.areas.join(', ')} · Teil 2, Wochen ${p1 + 1}–13 · fertig vor der Mail am ${addDays(b.start, 7 * p1)} · Vorlage von der Montags-Routine`);
    if (b.start >= weekYmd && b.start < next) rows.push(`${b.order} · ${b.areas.join(', ')} · erste Wochenmail am ${b.start}: Teil 1 freigegeben?`);
    if (b.notice && b.notice.at.slice(0, 10) >= addDays(weekYmd, -7) && b.notice.at.slice(0, 10) < weekYmd) rows.push(`${b.order} · Kündigung vermerkt (${b.notice.kind === 'extraordinary' ? 'außerordentlich, Grund prüfen' : 'ordentlich, läuft bis ' + b.end})`);
  }
  return rows;
}
export async function runReadingList(env, nowMs = Date.now()) {
  if (!env.MAILJET_API_KEY || !env.OWNER_EMAIL) return { skipped: true };
  const week = weekDate(weekStart(nowMs));
  const last = weekDate(addWeeks(weekStart(nowMs), -1));
  const bookings = await bookingSummaries(env);
  const texts = await twTextSet(env);
  const rows = readingList(bookings, week);
  // Weekly emails: missing this week (still sendable until Sunday), and last week's balance from the send log.
  const missingNow = twMissing(bookings, texts, week);
  const missedLast = twMissing(bookings, texts, last);
  for (const r of missedLast) for (const a of r.areas) await twLog(env, last, r.order, areaSlug(a), r.week, 'missing', nowMs, '', bookings.find(x => x.order === r.order)?.end);
  const counts = {};
  const logs = await env.ORDERS.list({ prefix: `twlog:${last}:`, limit: 1000 });
  for (const { metadata } of logs.keys) if (metadata?.r) counts[metadata.r] = (counts[metadata.r] || 0) + 1;
  const sentLine = Object.keys(counts).length ? `Wochenmails letzte Woche: ${counts.sent || 0} verschickt${counts.stopped ? `, ${counts.stopped} gestoppt` : ''}${counts.expired ? `, ${counts.expired} verfallen (Text zu spät)` : ''}${counts.failed ? `, ${counts.failed} gescheitert` : ''}${counts.missing ? `, ${counts.missing} nicht verschickt (Text fehlte)` : ''}.` : null;
  if (!rows.length && !missingNow.length && !missedLast.length && !sentLine) return { week, rows: 0 };
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `Lesezettel Transit Weekly · Woche ab ${longDate(week, 'de')}`, text: [
    `Transit Weekly, fällig in der Woche ab ${longDate(week, 'de')}:`, '', ...(rows.length ? rows.map(r => `- ${r}`) : ['- nichts zu lesen']),
    ...(missingNow.length ? ['', 'Wochenmails dieser Woche ohne Text (keine Mail, bis Sonntag hochladen, dann geht sie noch raus):', ...missingNow.map(r => `- ${missingLine(r)}`)] : []),
    ...(missedLast.length ? ['', 'Letzte Woche nicht verschickt, Text fehlte (Erstattung entscheidest du):', ...missedLast.map(r => `- ${missingLine(r)}`)] : []),
    ...(sentLine ? ['', sentLine] : []), '',
    'Teil 2 nie vor Ablauf der Widerrufsfrist rechnen. Die Deutungsdaten stehen in der Mail „Deutungsdaten <Bestellnummer>“.',
  ].join('\n') });
  return { week, rows: rows.length, missing: missingNow.length, missed: missedLast.length };
}

// ---------- Transit Weekly: weekly emails (Stufe 6, Sandra 11.10.2026) ----------
// Sandra approves the week texts of each area; tools/transit-weekly-hochladen.py on the Mac sends them here
// (POST /api/tw-texts, header "Authorization: Bearer TW_UPLOAD_KEY"): order number, area, week, send time and
// text only, no name, no address. The script computes the send time, Monday 07:00 in the customer's time zone
// (the Worker has no Intl, see time.js). A text waits under twtext:<strip order>:<order>:<area>:<week> with its
// send time in the KV metadata. The idle invoice and correction runs (every 5 minutes) send what is due in
// portions and log each mail under twlog:<Monday>:<order>:<area> (result, time, Mailjet id; no text, no address;
// 3 years). A text goes 14 days after sending. Missing text: never an empty mail; warning Friday 12:00 and in the
// Monday list; a text uploaded late is still sent up to a week after its send time.
export const TW_SEND_BATCH = 8; // 1 list + 5 KV/Mailjet calls per mail: 41 of the 50 subrequests
export const TW_UPLOAD_MAX = 20; // texts per upload request (2 KV calls each)
export const TW_SEND_TRIES = 3;
// Send log: three years from the end of the year in which the term ends (Datenschutzerklärung § 12).
export const twLogExpiry = endYmd => Math.floor(Date.UTC(Number(String(endYmd).slice(0, 4)) + 4, 0, 1) / 1000);
const TW_TEXT_KEEP = 14 * 86400; // after sending
const TW_LATE_MS = 7 * 86400000;
const twTextKey = (base, order, slug, week) => `twtext:${base}:${order}:${slug}:${String(week).padStart(2, '0')}`;
// Earliest send time of a waiting text (ms), so the 5-minute runs list twtext: only when a mail can be due:
// KV Free allows 1,000 list operations a day, and two idle runs every 5 minutes listing each time used ~1,150
// (Cloudflare 90 % alert, 16.10.2026). Missing = list once; an upload deletes it; "none waiting" = far future.
const TW_NEXT_KEY = 'twnext';
const TW_NEXT_NONE = 8640000000000000;
export const twWeekMonday = (b, week) => addDays(b.start, 7 * (week - 1));

async function twLog(env, monday, order, slug, week, result, nowMs, id = '', end = monday) {
  await env.ORDERS.put(`twlog:${monday}:${order}:${slug}`, JSON.stringify({ week, result, at: isoUtc(nowMs), id }), { expiration: twLogExpiry(end), metadata: { r: result } });
}

const AREA_DE = { 'Love and relationships': 'Liebe und Beziehungen', 'Work and calling': 'Beruf und Berufung', 'Money and self-worth': 'Geld und Selbstwert', 'Home and family': 'Zuhause und Familie', 'Creativity and self-expression': 'Kreativität und Ausdruck', 'Friends and belonging': 'Freundschaft und Zugehörigkeit', 'Personal growth': 'Persönliches Wachstum' };
const MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'] };
// "Oct 19–25" / "Oct 26 – Nov 1"; "19.–25. Oktober" / "26. Oktober – 1. November"
export function weekRange(monday, lang = 'en') {
  const [, m1, d1] = monday.split('-').map(Number);
  const [, m2, d2] = addDays(monday, 6).split('-').map(Number);
  const M = MON[lang === 'de' ? 'de' : 'en'];
  if (lang === 'de') return m1 === m2 ? `${d1}.–${d2}. ${M[m1 - 1]}` : `${d1}. ${M[m1 - 1]} – ${d2}. ${M[m2 - 1]}`;
  return m1 === m2 ? `${M[m1 - 1]} ${d1}–${d2}` : `${M[m1 - 1]} ${d1} – ${M[m2 - 1]} ${d2}`;
}

// Subject words (Sandra, 11.10.2026: "Your week in (Bereich) stripped down", short word, German with "stripped down")
const AREA_SUBJECT = {
  'Love and relationships': ['in love', 'in der Liebe'], 'Work and calling': ['at work', 'im Beruf'],
  'Money and self-worth': ['in money', 'in Geldfragen'], 'Home and family': ['at home', 'zu Hause'],
  'Creativity and self-expression': ['in creativity', 'in der Kreativität'], 'Friends and belonging': ['in friendship', 'in Freundschaften'],
  'Personal growth': ['in growth', 'im Wachstum'],
};
export const weeklySubject = (area, monday, de) => {
  const w = AREA_SUBJECT[area] || [`in ${area.toLowerCase()}`, `in ${AREA_DE[area] || area}`];
  return de ? `Deine Woche ${w[1]}, stripped down · ${weekRange(monday, 'de')}` : `Your week ${w[0]}, stripped down · ${weekRange(monday)}`;
};

// Full window width on desktop too (Sandra, 11.10.2026: „volle Breite testen wir“; before: at most 600 px).
// Mail design B "Papier", light only (Sandra, 11.10.2026): cream card, black head band with the wordmark,
// "TRANSIT WEEKLY" / area in two lines, Georgia (no web fonts), tables + inline styles, no images, no tracking.
const TWM = { outer: '#F4EBDD', card: '#FBF7F0', head: '#0A0A0A', text: '#2A2520', h: '#0B0B0B', accent: '#7A5C25', muted: '#6B6157', line: '#D9C9A8', boxline: '#C9B48A' };
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdInline = s => escH(s)
  .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${TWM.h};font-weight:bold;">$1</strong>`)
  .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
const mdPlain = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2');
const pStyle = (size, extra = '') => `font-family:${SERIF};font-size:${size}px;${extra}`;
const label = (t, m = '0 0 12px 0') => `<p style="margin:${m};${pStyle(12, `letter-spacing:2px;text-transform:uppercase;color:${TWM.accent};`)}">${escH(t)}</p>`;
const rule = c => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid ${c};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;

// Markdown of a weekly text -> blocks. Only what the texts use: # / ## / ###, paragraphs, a line in *…* alone,
// "- " lists, **bold**, *italic*. The section "Das Wichtigste für diese Woche" / "What matters most this week" is a box.
function twBlocks(md) {
  const blocks = []; let para = [], list = null;
  const flush = () => { if (para.length) blocks.push({ t: 'p', s: para.join(' ') }); para = []; if (list) blocks.push({ t: 'ul', items: list }); list = null; };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const l = raw.trim(); let m;
    if (!l || /^(-{3,}|\*{3,})$/.test(l)) { flush(); continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flush(); blocks.push({ t: m[1].length === 1 ? 'h1' : 'h2', s: m[2] }); continue; }
    if ((m = l.match(/^[-*]\s+(.*)$/))) { if (para.length) { blocks.push({ t: 'p', s: para.join(' ') }); para = []; } (list = list || []).push(m[1]); continue; }
    if (list) { list[list.length - 1] += ' ' + l; continue; }
    para.push(l);
  }
  flush();
  return blocks;
}

export function weeklyMail(b, area, week, md, site = 'https://astrostrip.com') {
  const de = b.language === 'de';
  const monday = twWeekMonday(b, week);
  const subject = weeklySubject(area, monday, de);
  const weekLine = de ? `Woche ${week} von ${TRANSIT.weeks}.` : `Week ${week} of ${TRANSIT.weeks}.`;
  const tzLine = de ? `Die Zeiten in dieser Mail gelten für ${b.tzLabel}.` : `Times in this email are ${b.tzLabel} time.`;
  const why = de ? 'Du bekommst diese Mail, weil du Transit Weekly gebucht hast.' : 'You are getting this email because you booked Transit Weekly.';
  const cancel = de ? 'Verträge hier kündigen' : 'Cancel contracts here';
  const areaName = de ? (AREA_DE[area] || area) : area;
  const blocks = twBlocks(md);
  // Head of the text: heading, date line (italic line right after it), then week and time zone
  let i = 0; const h1 = blocks[0]?.t === 'h1' ? blocks[i++].s : '';
  const date = blocks[i]?.t === 'p' && /^\*[^*].*\*$/.test(blocks[i].s) ? blocks[i++].s.slice(1, -1) : '';
  const rest = blocks.slice(i);

  // Text part
  const text = [
    ...(h1 ? [mdPlain(h1).toUpperCase()] : []), ...(date ? [mdPlain(date)] : []), weekLine, tzLine, '',
    rest.map(x => x.t === 'ul' ? x.items.map(s => `– ${mdPlain(s)}`).join('\n') : x.t === 'p' ? mdPlain(x.s) : mdPlain(x.s).toUpperCase()).join('\n\n'),
    '', '—', 'astro.strip · hello@astrostrip.com', why, `${cancel}: ${site}/cancel`,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // HTML part
  const pad = 'padding-left:36px;padding-right:36px;';
  const body = []; let inBox = false;
  for (const x of rest) {
    if (x.t === 'h2' && /^(Das Wichtigste|What matters most)/i.test(mdPlain(x.s))) {
      inBox = true;
      body.push(`</td></tr><tr><td class="x-pad" style="padding-top:8px;padding-bottom:8px;${pad}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${TWM.outer};border:1px solid ${TWM.boxline};"><tr><td style="padding:24px 24px 10px 24px;">${label(mdPlain(x.s), '0 0 18px 0')}`);
    } else if (x.t === 'h1' || x.t === 'h2') {
      body.push(`<h2 style="margin:34px 0 12px 0;${pStyle(22, `line-height:1.3;font-weight:normal;color:${TWM.h};`)}">${mdInline(x.s)}</h2>`);
    } else if (x.t === 'ul') {
      body.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${x.items.map(s => `<tr><td valign="top" style="width:22px;padding:0 0 14px 0;${pStyle(15, `line-height:1.65;color:${TWM.accent};`)}">&#10022;</td><td style="padding:0 0 14px 0;${pStyle(17, `line-height:1.6;color:${TWM.text};`)}">${mdInline(s)}</td></tr>`).join('')}</table>`);
    } else if (/^\*[^*].*\*$/.test(x.s)) {
      body.push(`<p style="margin:-4px 0 26px 0;${pStyle(16, `line-height:1.5;font-style:italic;color:${TWM.accent};`)}">${escH(mdPlain(x.s.slice(1, -1)))}</p>`);
    } else {
      body.push(`<p style="margin:0 0 18px 0;${pStyle(17, `line-height:1.65;color:${TWM.text};`)}">${mdInline(x.s)}</p>`);
    }
  }
  if (inBox) body.push('</td></tr></table>');
  const pre = mdPlain(rest.find(x => x.t === 'p')?.s || '').split(/(?<=[.!?])\s/)[0];
  const html = `<!DOCTYPE html>
<html lang="${de ? 'de' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escH(subject)}</title>
<style>:root{color-scheme:light;supported-color-schemes:light;}body{margin:0;padding:0;-webkit-text-size-adjust:100%;}
@media (max-width:620px){.x-pad{padding-left:22px !important;padding-right:22px !important;}.x-h1{font-size:28px !important;}}</style></head>
<body style="margin:0;padding:0;background:${TWM.outer};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escH(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TWM.outer};"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${TWM.card};border:1px solid ${TWM.line};">
<tr><td align="center" style="background:${TWM.head};padding:30px 24px 24px 24px;">
<p style="margin:0;${pStyle(30, 'line-height:1;color:#F4EBDD;letter-spacing:1px;')}">astro.strip</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 12px auto;"><tr><td style="width:120px;border-top:1px solid #C9A45C;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:0 0 6px 0;${pStyle(12, 'letter-spacing:3px;text-transform:uppercase;color:#C9A170;')}">Transit Weekly</p>
<p style="margin:0;${pStyle(12, 'letter-spacing:3px;text-transform:uppercase;color:#C9A170;')}">${escH(areaName)}</p></td></tr>
<tr><td class="x-pad" style="padding-top:34px;${pad}">
${label(weekLine.replace(/\.$/, ''))}${h1 ? `<h1 class="x-h1" style="margin:0 0 8px 0;${pStyle(32, `line-height:1.2;font-weight:normal;color:${TWM.h};`)}">${mdInline(h1)}</h1>` : ''}${date ? `<p style="margin:0 0 4px 0;${pStyle(17, `font-style:italic;color:${TWM.accent};`)}">${escH(mdPlain(date))}</p>` : ''}
<p style="margin:0 0 28px 0;${pStyle(14, `color:${TWM.muted};`)}">${escH(tzLine)}</p>
${body.join('\n')}
</td></tr>
<tr><td class="x-pad" style="padding-top:30px;padding-bottom:34px;${pad}">${rule(TWM.line)}
<p style="margin:20px 0 6px 0;${pStyle(14, `line-height:1.6;color:${TWM.muted};`)}">astro.strip · <a href="mailto:hello@astrostrip.com" style="color:${TWM.accent};text-decoration:underline;">hello@astrostrip.com</a></p>
<p style="margin:0 0 6px 0;${pStyle(14, `line-height:1.6;color:${TWM.muted};`)}">${escH(why)} <a href="${escH(site)}/cancel" style="color:${TWM.accent};text-decoration:underline;">${escH(cancel)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

// ---------- customer emails in the weekly-mail design (Sandra, 11.10.2026: „Die Richtung ist super“) ----------
// Same frame as the weekly email: cream card, black head band with the wordmark and one kicker line, Georgia,
// tables + inline styles, no images, no tracking, light only. The text part stays as before; mails to Sandra stay text.
const linkify = s => s.replace(/https?:\/\/[^\s<]*[^\s<.,;:)]/g, u => `<a href="${u}" style="color:${TWM.accent};text-decoration:underline;">${u.replace(/^https?:\/\//, '')}</a>`);
const bP = (t, size = 17, color = TWM.text, extra = '') => `<p style="margin:0 0 16px 0;${pStyle(size, `line-height:1.6;color:${color};${extra}`)}">${t}</p>`;
const bH1 = (t, size = 30) => `<h1 class="x-h1" style="margin:0 0 14px 0;${pStyle(size, `line-height:1.2;font-weight:normal;color:${TWM.h};`)}">${t}</h1>`;
const bH2 = t => `<h2 style="margin:30px 0 12px 0;${pStyle(21, `line-height:1.3;font-weight:normal;color:${TWM.h};`)}">${t}</h2>`;
const bSmall = t => bP(t, 13, TWM.muted, 'margin:0 0 10px 0;line-height:1.55;');
const bStrong = t => `<strong style="color:${TWM.h};">${t}</strong>`;
const bRule = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:10px 0 22px 0;"><tr><td style="border-top:1px solid ${TWM.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
const bRows = rows => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 22px 0;border-bottom:1px solid ${TWM.line};">${rows.map(([k, v]) => `<tr><td valign="top" style="padding:9px 14px 9px 0;border-top:1px solid ${TWM.line};width:96px;${pStyle(12, `letter-spacing:1.5px;text-transform:uppercase;color:${TWM.accent};`)}">${escH(k)}</td><td style="padding:8px 0;border-top:1px solid ${TWM.line};${pStyle(16, `line-height:1.5;color:${TWM.text};`)}">${v}</td></tr>`).join('')}</table>`;
const bBox = inner => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 22px 0;background:${TWM.outer};border:1px solid ${TWM.boxline};"><tr><td style="padding:22px 22px 6px 22px;">${inner}</td></tr></table>`;
const bButton = (t, href) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;"><tr><td style="background:${TWM.head};"><a href="${escH(href)}" style="display:inline-block;padding:14px 22px;${pStyle(13, 'letter-spacing:2px;text-transform:uppercase;color:#F4EBDD;text-decoration:none;')}">${escH(t)}</a></td></tr></table>`;

export function brandMail({ lang = 'en', kicker, body, pre = '', title = 'astro.strip' }) {
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escH(title)}</title>
<style>:root{color-scheme:light;supported-color-schemes:light;}body{margin:0;padding:0;-webkit-text-size-adjust:100%;}
@media (max-width:620px){.x-pad{padding-left:22px !important;padding-right:22px !important;}.x-h1{font-size:26px !important;}}</style></head>
<body style="margin:0;padding:0;background:${TWM.outer};">
${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escH(pre)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TWM.outer};"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${TWM.card};border:1px solid ${TWM.line};">
<tr><td align="center" style="background:${TWM.head};padding:30px 24px 24px 24px;">
<p style="margin:0;${pStyle(30, 'line-height:1;color:#F4EBDD;letter-spacing:1px;')}">astro.strip</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 12px auto;"><tr><td style="width:120px;border-top:1px solid #C9A45C;font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p style="margin:0;${pStyle(12, 'letter-spacing:3px;text-transform:uppercase;color:#C9A170;')}">${escH(kicker)}</p></td></tr>
<tr><td class="x-pad" style="padding:32px 36px 4px 36px;">
${body}
</td></tr>
<tr><td class="x-pad" style="padding:22px 36px 30px 36px;">${rule(TWM.line)}
<p style="margin:18px 0 6px 0;${pStyle(13, `line-height:1.6;color:${TWM.muted};`)}">astro.strip · Sandra Willuweit · Renzelstraße 10c · 20146 Hamburg · Germany · <a href="mailto:hello@astrostrip.com" style="color:${TWM.accent};text-decoration:underline;">hello@astrostrip.com</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

// A plain-text customer email in the frame: greeting lines as headings, "Label: value" blocks as a table,
// "---" or a double blank line as a divider, links clickable. The wording stays exactly the text part.
export function brandFromText(text, { kicker, lang = 'en', italic = null, attach = '' }) {
  const paras = []; let cur = [], blanks = 0;
  const push = () => { if (cur.length) paras.push(cur); cur = []; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (/^astro\.strip · Sandra Willuweit/.test(l)) continue; // the frame's footer carries the address
    if (!l) { push(); blanks++; continue; }
    if (l === '---' || (blanks >= 2 && paras.length)) { push(); if (paras.at(-1) !== 'rule') paras.push('rule'); if (l === '---') { blanks = 0; continue; } }
    blanks = 0; cur.push(l);
  }
  push();
  while (paras.at(-1) === 'rule') paras.pop();
  const body = paras.map(p => {
    if (p === 'rule') return bRule;
    if (p.length === 1 && /^(Hi|Hallo)\b.{0,80},$/.test(p[0])) return bH1(escH(p[0]), 28);
    if (p.length > 1 && p.every(l => /^[^:]{1,32}: \S/.test(l) && !/^https?/.test(l))) return bRows(p.map(l => { const i = l.indexOf(': '); return [l.slice(0, i), linkify(escH(l.slice(i + 2)))]; }));
    const html = p.map(l => linkify(escH(l))).join('<br>');
    if (italic && italic.test(p[0])) return bP(`<em>${html}</em>`, 17, TWM.accent);
    if (/^(Terms:|Astrology is a tool)/.test(p[0])) return bSmall(html);
    return bP(html);
  }).join('\n');
  const first = paras.find(p => p !== 'rule' && p.length > 1) || paras.find(p => p !== 'rule');
  return brandMail({ lang, kicker, body: body + (attach ? bBox(label('Attached · Anhang') + bP(escH(attach), 15)) : ''), pre: first ? first.join(' ').slice(0, 120) : '' });
}

// Contract confirmation in the frame. Same content as customerMail (text part), legal texts complete but small.
export function customerMailHtml(order, id, env) {
  const s = STRIPS[order.strip];
  const t = order.transit;
  const site = env.SITE_URL || 'https://astrostrip.com';
  const rows = [
    ['Order', escH(id)],
    s ? ['Strip', `${escH(s.name)} · ${escH(s.tag)}. A personal astrology reading for your birth chart, PDF by email.`] : ['Product', `${escH(productLabel(order))}, weekly transit emails for your birth chart.`],
    s ? ['Delivery', escH(deliveryText(order))] : null,
    s && extrasCents(order) ? ['Extra layers', escH(extrasBreakdown(order))] : null,
    s && t ? ['Added', escH(productLabel({ transit: t }))] : null,
    order.base ? ['For', `the reading of your order ${escH(order.base)}`] : null,
    ['Price', `${bStrong(escH(euro(orderCents(order))))} including 19 % VAT, paid`],
    ['Invoice', s && t ? 'two PDF e-invoices, for the strip and for Transit Weekly, follow in separate emails within a few minutes' : 'a PDF e-invoice follows in a separate email within a few minutes'],
    ['Language', order.language === 'de' ? 'German' : 'English'],
  ].filter(Boolean);
  const rebook = order.base || id;
  const tw = t ? bBox([
    label('Transit Weekly'),
    bP(`${escH(t.areas.join(' · '))}<br>${escH(euro(transitUnit(order)))} per area for 13 weeks, ${escH(euro(transitUnit(order) / 3))} a month${t.founding ? ', founding price' : ''}.`, 16),
    bP(`Every Monday at 7 am ${escH(t.tzLabel)} time, from ${bStrong(escH(longDate(t.start)))}, one email per life area with your transits for that week, written for your chart. The last one comes in the week ending ${escH(longDate(t.end))}. It ends by itself; nothing renews automatically.`, 16),
    bP(`${bStrong('Want another life area or 13 more weeks?')} Book on the Transit Weekly page with your order number ${bStrong(escH(rebook))} and this email address.`, 16),
    bButton('Add or renew Transit Weekly', `${site}/transit-weekly.html`),
    bSmall(`You can give notice at any time on the <a href="${escH(site)}/cancel.html" style="color:${TWM.accent};text-decoration:underline;">cancellation page</a>; notice takes effect at the end of the 13 weeks, weeks already paid are not refunded. Your right to terminate for good cause is not affected.`),
  ].join('')) : '';
  const consent = [
    s ? `You expressly requested that we start writing your strip before the withdrawal period ends, and you confirmed that you know your right of withdrawal ends once the strip has been fully delivered. (Given on ${berlinStamp(order.createdAt)}.)` : null,
    t ? `You expressly requested that we start preparing Transit Weekly before the withdrawal period ends. If you withdraw, you pay a proportionate amount for the part already provided. (Given on ${berlinStamp(order.createdAt)}.)` : null,
    t && t.timeConsent ? `You confirmed: “${TIME_CONSENT.en}” (Given on ${berlinStamp(order.createdAt)}.)` : null,
  ].filter(Boolean).map(x => bSmall(escH(x))).join('');
  const legal = (title, lines) => `<p style="margin:22px 0 8px 0;${pStyle(12, `letter-spacing:2px;text-transform:uppercase;color:${TWM.accent};`)}">${escH(title)}</p>` + lines.map(l => bSmall(linkify(escH(l)))).join('');
  const body = [
    bH1(`Thank you, ${escH(order.name)}.`),
    bP('Your order is in. This email confirms your contract.'),
    bRows(rows),
    tw,
    bH2('Your birth data'),
    bP(`${escH(order.birthDate)}, ${escH(order.birthTime)} local time, ${escH(order.place.label)}.<br>If anything here is wrong, reply to this email before we start writing.`, 16),
    bH2('Your consent'),
    consent,
    bH2('Cancellation policy'),
    legal('Widerrufsbelehrung (Deutsch)', CANCELLATION_POLICY.de),
    legal('Muster-Widerrufsformular', WITHDRAWAL_FORM.de),
    legal('Cancellation policy (English)', CANCELLATION_POLICY.en),
    legal('Model withdrawal form', WITHDRAWAL_FORM.en),
    bSmall(linkify(escH(`You can also withdraw online at any time during the withdrawal period: ${site}/withdraw.html`))),
    bSmall(linkify(escH(`Terms: ${site}/terms.html`))),
    bSmall('Astrology is a tool for self-reflection. It does not replace medical, legal, financial or psychological advice.'),
  ].join('\n');
  return brandMail({ lang: 'en', kicker: 'Order confirmation', body, pre: `Your order ${id} is in. This email confirms your contract.`, title: `Your order ${id}` });
}

async function handleTwTexts(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.TW_UPLOAD_KEY || !timingSafeEqual(auth, `Bearer ${env.TW_UPLOAD_KEY}`)) return json({ error: 'Not found' }, 404);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const order = String(body.order || '').toUpperCase();
  if (!ORDER_ID_RE.test(order)) return json({ error: 'Bestellnummer fehlt oder hat die falsche Form.' }, 400);
  const page = await env.ORDERS.list({ prefix: 'tw:', limit: 1000 });
  const key = page.keys.map(k => k.name).find(n => n.endsWith(`:${order}`));
  const b = key ? JSON.parse((await env.ORDERS.get(key)) || 'null') : null;
  if (!b) return json({ error: `Keine Transit-Weekly-Buchung ${order} (gelöscht, voll erstattet oder Tippfehler?).` }, 404);
  const now = Date.now();
  const action = body.action || 'upload';
  if (action === 'stop' || action === 'resume') {
    if (action === 'stop') b.stopped = { reason: 'manual', at: isoUtc(now) }; else delete b.stopped;
    await putBooking(env, key, b);
    return json({ ok: true, order, stopped: b.stopped?.reason || null });
  }
  const slugs = b.areas.map(areaSlug);
  const stored = [];
  const skipped = [];
  if (action === 'upload') {
    const texts = Array.isArray(body.texts) ? body.texts : [];
    if (!texts.length || texts.length > TW_UPLOAD_MAX) return json({ error: `1 bis ${TW_UPLOAD_MAX} Texte je Aufruf.` }, 400);
    for (const t of texts) {
      const slug = String(t.area || '');
      const week = Number(t.week);
      const at = Number(t.sendAt);
      const md = typeof t.text === 'string' ? t.text.replace(/\r/g, '').trim() : '';
      const label = `${slug} Woche ${t.week}`;
      if (!slugs.includes(slug)) { skipped.push(`${label}: Bereich nicht gebucht`); continue; }
      if (!Number.isInteger(week) || week < 1 || week > TRANSIT.weeks) { skipped.push(`${label}: nur Wochen 1–${TRANSIT.weeks}`); continue; }
      const monday = twWeekMonday(b, week);
      const mondayMs = Date.parse(monday + 'T00:00:00Z');
      if (!(at >= mondayMs - 15 * 3600000 && at <= mondayMs + 24 * 3600000)) { skipped.push(`${label}: Versandzeit passt nicht zum Montag ${monday}`); continue; }
      if (md.length < 200 || md.length > 60000) { skipped.push(`${label}: Text zu kurz oder zu lang`); continue; }
      if (/@|AS-\d{8}/.test(md)) { skipped.push(`${label}: E-Mail-Adresse oder Bestellnummer im Text`); continue; }
      const tk = twTextKey(b.base, b.order, slug, week);
      const prev = await env.ORDERS.getWithMetadata(tk);
      if (prev.metadata?.sent) { skipped.push(`${label}: schon verschickt`); continue; }
      await env.ORDERS.put(tk, md, { expiration: Math.floor((at + TW_LATE_MS) / 1000) + TW_TEXT_KEEP, metadata: { at, sent: 0 } });
      stored.push(label);
    }
    if (stored.length) await env.ORDERS.delete(TW_NEXT_KEY); // the next run lists again and finds the new send times
  }
  // Status, also after an upload: waiting and sent texts, and what is still missing for weeks not yet over.
  const have = await env.ORDERS.list({ prefix: `twtext:${b.base}:${b.order}:`, limit: 1000 });
  const status = {};
  for (const { name, metadata } of have.keys) { const [, , , slug, wk] = name.split(':'); status[`${slug} ${Number(wk)}`] = metadata?.sent ? (metadata.r || 'sent') : 'wartet'; }
  const today = berlinYmd(now);
  const missing = [];
  for (const slug of slugs) for (let w = 1; w <= TRANSIT.weeks; w++) if (!status[`${slug} ${w}`] && addDays(twWeekMonday(b, w), 7) > today) missing.push(`${slug} ${w}`);
  return json({ ok: true, order, start: b.start, end: b.end, tzLabel: b.tzLabel, stopped: b.stopped?.reason || null, notice: b.notice?.kind || null, stored, skipped, missing, status });
}

// One portion of due weekly emails, oldest send time first. Runs only when the invoice or correction queue is idle.
export async function runTwMails(env, nowMs = Date.now()) {
  if (!env.MAILJET_API_KEY) return { skipped: true };
  const next = Number(await env.ORDERS.get(TW_NEXT_KEY));
  if (next && nowMs < next) return { due: 0 };
  const due = [];
  let later = TW_NEXT_NONE; // earliest waiting text not yet due
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'twtext:', limit: 1000, cursor });
    for (const { name, metadata } of page.keys) {
      if (!metadata || metadata.sent) continue;
      if (metadata.at <= nowMs) due.push({ name, meta: metadata }); else later = Math.min(later, metadata.at);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (!due.length) { await env.ORDERS.put(TW_NEXT_KEY, String(later)); return { due: 0 }; }
  due.sort((x, y) => x.meta.at - y.meta.at);
  const result = { sent: 0, stopped: 0, expired: 0, failed: 0, retry: 0, left: Math.max(0, due.length - TW_SEND_BATCH) };
  for (const { name, meta } of due.slice(0, TW_SEND_BATCH)) {
    const [, base, order, slug, wk] = name.split(':');
    const week = Number(wk);
    const md = await env.ORDERS.get(name);
    const b = JSON.parse((await env.ORDERS.get(`tw:${base}:${order}`)) || 'null');
    const monday = b ? twWeekMonday(b, week) : berlinYmd(meta.at);
    const done = async (res, id = '') => {
      await twLog(env, monday, order, slug, week, res, nowMs, id, b?.end || addDays(monday, 7 * TRANSIT.weeks));
      if (md !== null) await env.ORDERS.put(name, md, { expiration: Math.floor(nowMs / 1000) + TW_TEXT_KEEP, metadata: { at: meta.at, sent: nowMs, r: res } });
      result[res]++;
    };
    if (md === null) continue; // expired between list and get
    // Stopped (withdrawal, full refund, Sandra's stop) or booking gone: no mail. An ordinary notice runs on to the end.
    if (!b || b.stopped) { await done('stopped'); continue; }
    if (nowMs > meta.at + TW_LATE_MS) { await done('expired'); continue; }
    try {
      const m = weeklyMail(b, slugArea(slug), week, md, env.SITE_URL || 'https://astrostrip.com');
      await done('sent', await sendMail(env, { to: b.email, subject: m.subject, text: m.text, html: m.html }));
    } catch (err) {
      console.error('tw mail', name, err);
      const tries = (meta.tries || 0) + 1;
      if (tries < TW_SEND_TRIES) { await env.ORDERS.put(name, md, { expiration: Math.floor((meta.at + TW_LATE_MS) / 1000) + TW_TEXT_KEEP, metadata: { ...meta, tries } }); result.retry++; continue; }
      await done('failed');
      await sendMail(env, { to: env.OWNER_EMAIL, subject: `Transit Weekly: Mail nicht zugestellt (${order})`, text: `Die Wochenmail ${order} · ${slugArea(slug)} · Woche ${week} ist ${TW_SEND_TRIES}-mal bei Mailjet gescheitert und wird nicht mehr versucht.\nFehler: ${String(err).slice(0, 300)}\n\nBitte im Mailjet-Dashboard nachsehen (Adresse gesperrt oder falsch?) und der Kundin den Text auf anderem Weg schicken.` }).catch(e => console.error('tw warn', e));
    }
  }
  // portion left or a retry: list again in the next run; otherwise wait until the next send time
  await env.ORDERS.put(TW_NEXT_KEY, String(result.left || result.retry ? nowMs : later));
  return result;
}

// Order:area:week of every uploaded text (waiting or sent).
async function twTextSet(env) {
  const set = new Set();
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'twtext:', limit: 1000, cursor });
    for (const { name } of page.keys) { const [, , order, slug, wk] = name.split(':'); set.add(`${order}:${slug}:${Number(wk)}`); }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return set;
}
// Running bookings whose week starting `monday` still lacks a text: [{ order, week, areas }].
export function twMissing(bookings, texts, monday) {
  const rows = [];
  for (const b of bookings) {
    if (b.stopped || !b.start || monday < b.start || monday > b.end) continue;
    const week = Math.round((Date.parse(monday) - Date.parse(b.start)) / (7 * 86400000)) + 1;
    if (week < 1 || week > TRANSIT.weeks) continue;
    const areas = b.areas.filter(a => !texts.has(`${b.order}:${areaSlug(a)}:${week}`));
    if (areas.length) rows.push({ order: b.order, week, areas });
  }
  return rows;
}
const missingLine = r => `${r.order} · ${r.areas.join(', ')} · Woche ${r.week}`;

// Friday 12:00 Berlin (hourly cron): texts still missing for next Monday.
export const twFridayNoon = nowMs => { const w = new Date(nowMs + berlinOffsetMinutes(nowMs) * 60000); return w.getUTCDay() === 5 && w.getUTCHours() === 12; };
export async function runTwFriday(env, nowMs = Date.now()) {
  if (!env.MAILJET_API_KEY || !env.OWNER_EMAIL) return { skipped: true };
  const next = weekDate(addWeeks(weekStart(nowMs), 1));
  const rows = twMissing(await bookingSummaries(env), await twTextSet(env), next);
  if (!rows.length) return { missing: 0 };
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `Transit Weekly: Texte fehlen für Montag, ${longDate(next, 'de')}`, text: [
    `Für die Woche ab ${longDate(next, 'de')} ist noch nicht alles hochgeladen:`, '', ...rows.map(r => `- ${missingLine(r)}`), '',
    'Hochladen nach der Freigabe: python3 tools/transit-weekly-hochladen.py <Bestellnummer>',
    'Ohne Text geht keine Mail raus. Kommt der Text bis Sonntag derselben Woche, geht die Mail beim nächsten Lauf noch automatisch raus.',
  ].join('\n') });
  return { missing: rows.length };
}

// For the Monday Telegram report, not for visitors: wrong/missing key = 404, same as an unknown route.
async function handleStatsRead(request, env) {
  const url = new URL(request.url);
  if (!env.STATS_READ_KEY || url.searchParams.get('key') !== env.STATS_READ_KEY) return json({ error: 'Not found' }, 404);
  const n = Math.min(12, Math.max(1, Number(url.searchParams.get('weeks')) || 1));
  const current = weekStart(Date.now());
  const weeks = [];
  for (let i = 1; i <= n; i++) {
    const w = addWeeks(current, -i);
    const raw = await env.ORDERS.get(`stats:week:${weekDate(w)}`);
    weeks.push({ week: weekDate(w), ...(raw ? JSON.parse(raw) : { visit: {}, click: {} }) });
  }
  return json({ weeks });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/slots' && request.method === 'GET') return await handleSlots(env);
      if (url.pathname === '/api/transit-price' && request.method === 'GET') return json(await twPrice(env));
      if (url.pathname === '/api/checkout' && request.method === 'POST') return await handleCheckout(request, env);
      if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') return await handleWebhook(request, env);
      if (url.pathname === '/api/withdraw' && request.method === 'POST') return await handleWithdraw(request, env);
      if (url.pathname === '/api/transit-weekly' && request.method === 'POST') return await handleRebook(request, env);
      if (url.pathname === '/api/cancel' && request.method === 'POST') return await handleCancel(request, env);
      if (url.pathname === '/api/subscribe' && request.method === 'POST') return await handleSubscribe(request, env);
      if (url.pathname === '/api/confirm' && request.method === 'GET') return await handleConfirm(request, env);
      if (url.pathname === '/api/stat' && request.method === 'POST') return await handleStat(request, env);
      if (url.pathname === '/api/stats' && request.method === 'GET') return await handleStatsRead(request, env);
      if (url.pathname === '/api/tw-texts' && request.method === 'POST') return await handleTwTexts(request, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      if (url.pathname === '/api/stripe-webhook') return new Response('error', { status: 500 }); // Stripe retries
      return json({ error: 'Something went wrong on our side. Nothing was charged. Please try again, or email hello@astrostrip.com.' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    // Monday 01:10 UTC: stats rollup and the Transit Weekly reading list (Monday early morning in Berlin)
    // Invoice and correction runs: when their queue is idle, the same invocation sends a portion of weekly emails
    // (no fifth cron; the free plan has five per account). Hourly run: Friday 12:00 Berlin, missing weekly texts.
    const thenMails = r => (r && r.sent === 0 ? runTwMails(env).then(tw => ({ ...r, tw }), err => ({ ...r, tw: String(err) })) : r);
    const job = event.cron === INVOICE_CRON ? runInvoices(env).then(thenMails) : event.cron === CORRECTION_CRON ? runCorrections(env).then(thenMails)
      : event.cron === STATS_ROLLUP_CRON ? Promise.all([runStatsRollup(env), runReadingList(env).catch(err => ({ readingList: String(err) }))])
      : Promise.all([runRetention(env), twFridayNoon(Date.now()) ? runTwFriday(env).catch(err => ({ twFriday: String(err) })) : null]);
    ctx.waitUntil(job.then(r => console.log(event.cron, JSON.stringify(r))));
  },
};
