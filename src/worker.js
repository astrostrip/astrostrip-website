// astro.strip order backend (Cloudflare Worker).
//
// Routes
//   GET  /api/slots            free slots per strip: this week and the next free week (up to WEEKS_AHEAD)
//   POST /api/checkout         validates an order, checks slots, creates a Stripe Checkout Session
//   POST /api/stripe-webhook   Stripe calls this after payment: mails the order to Sandra and the confirmation to the customer
//   POST /api/withdraw         electronic withdrawal function (§ 356a BGB): mails an immediate receipt
// Everything else is served from ./public (static assets).
//
// Birth data never goes to Stripe. It waits in KV (ORDERS) until payment, is mailed to Sandra, then deleted.
//
//   POST /api/subscribe        newsletter signup: stores the consent and sends the double opt-in mail
//   GET  /api/confirm          double opt-in link: logs the confirmation, adds the address to the Mailjet list
//
// Secrets (Cloudflare → Worker → Settings → Variables and Secrets, type "Secret"):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, MAILJET_API_KEY, MAILJET_SECRET_KEY, OWNER_EMAIL
// Plain variables (wrangler.jsonc "vars"): SITE_URL, MAIL_FROM_NAME, MAIL_FROM_ADDRESS,
//   MAILJET_NEWSLETTER_LIST_ID (double opt-in list), MAILJET_CUSTOMER_LIST_ID (buyers, § 7 Abs. 3 UWG; empty = off)

export const STRIPS = {
  mini: { name: 'Mini Strip', tag: 'The essentials', cents: 3900, days: 5, weekly: 20 },
  maxi: { name: 'Maxi Strip', tag: 'Full chart reading', cents: 7900, days: 7, weekly: 5 },
  ultra: { name: 'Ultra Strip', tag: 'Complete dossier', cents: 12900, days: 10, weekly: 3 },
};

export const LIFE_AREAS = ['Love and relationships', 'Work and calling', 'Money and self-worth', 'Home and family', 'Creativity and self-expression', 'Friends and belonging', 'Personal growth'];
export const RELATIONSHIP = ['Single', 'Dating', 'In a relationship', 'Married', 'Separated or divorced', 'Widowed'];
export const TIME_SOURCES = { certificate: 'Birth certificate or hospital record', family: 'From family memory', approximate: 'Approximate' };

const TZ = 'Europe/Berlin';
const SESSION_MINUTES = 31; // Stripe minimum is 30; open sessions hold a slot this long

// ---------- time ----------
function tzOffsetMinutes(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs) / 60000);
}

// Unix seconds of this week's Monday 00:00 in Berlin.
export function weekStart(nowMs = Date.now()) {
  const local = new Date(nowMs + tzOffsetMinutes(nowMs, TZ) * 60000); // Berlin wall clock, read with UTC getters
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  const mondayWall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
  let utc = mondayWall - tzOffsetMinutes(mondayWall, TZ) * 60000;
  utc = mondayWall - tzOffsetMinutes(utc, TZ) * 60000; // second pass for DST edges
  return Math.floor(utc / 1000);
}

export function berlinStamp(ms = Date.now(), lang = 'de') {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { timeZone: TZ, dateStyle: 'long', timeStyle: 'medium' }).format(new Date(ms)) + ' (Europe/Berlin)';
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

// Monday 00:00 (Berlin) n weeks after the week starting at weekSec. Noon offset keeps DST shifts harmless.
export const addWeeks = (weekSec, n) => weekStart((weekSec + n * 7 * 86400 + 12 * 3600) * 1000);

// Berlin calendar date of a week start, YYYY-MM-DD.
export const weekDate = weekSec => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(weekSec * 1000));

// Counts paid and still-open sessions per week and strip, for the current week and the weeks ahead.
export async function usedSlots(env, nowMs = Date.now()) {
  const current = weekStart(nowMs);
  const weeks = Array.from({ length: WEEKS_AHEAD }, (_, i) => addWeeks(current, i));
  const used = Object.fromEntries(weeks.map(w => [w, { mini: 0, maxi: 0, ultra: 0 }]));
  const since = addWeeks(current, -WEEKS_AHEAD); // a session for this week may have been created up to 7 weeks ago
  let starting_after;
  for (let page = 0; page < 20; page++) {
    const list = await stripe(env, 'GET', 'checkout/sessions', { limit: 100, 'created[gte]': since, starting_after });
    for (const s of list.data) {
      const strip = s.metadata?.strip;
      const week = Number(s.metadata?.week) || weekStart(s.created * 1000);
      if (!used[week] || !(strip in used[week])) continue;
      if (s.status === 'complete' || (s.status === 'open' && s.expires_at * 1000 > nowMs)) used[week][strip]++;
    }
    if (!list.has_more) break;
    starting_after = list.data[list.data.length - 1].id;
  }
  return { weeks, used };
}

// Per strip: limit, left (current week), next (first week with a free slot: date and unix start, null if all full),
// thisWeek (next is the current week), until (last Sunday of the booking window, for "fully booked until").
export async function freeSlots(env, nowMs = Date.now()) {
  const { weeks, used } = await usedSlots(env, nowMs);
  const lastSunday = weekDate(addWeeks(weeks[weeks.length - 1], 1) - 86400 + 12 * 3600);
  return Object.fromEntries(Object.entries(STRIPS).map(([k, s]) => {
    const free = weeks.find(w => used[w][k] < s.weekly);
    return [k, {
      limit: s.weekly,
      left: Math.max(0, s.weekly - used[weeks[0]][k]),
      next: free ? weekDate(free) : null,
      nextStart: free || null,
      thisWeek: free === weeks[0],
      until: lastSunday,
    }];
  }));
}

// "19 October 2026" / "19. Oktober 2026" for a YYYY-MM-DD date.
export function longDate(ymd, lang = 'en') {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

// Delivery wording for mails and Stripe. Current week: from payment; a later week: from its Monday.
function deliveryText(order, lang = 'en') {
  const s = STRIPS[order.strip];
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

async function sendMail(env, { to, subject, text, replyTo }) {
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
        TrackOpens: 'disabled',
        TrackClicks: 'disabled',
      }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.Messages?.[0]?.Status !== 'success') throw new Error(`Mail ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
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

export function validateOrder(o) {
  const errors = [];
  if (!o || typeof o !== 'object') return { errors: ['Invalid request.'] };
  const strip = String(o.strip || '');
  if (!STRIPS[strip]) errors.push('Please choose a strip.');
  const name = clean(o.name, 120);
  if (name.length < 2) errors.push('Please enter your name.');
  if (!isEmail(o.email)) errors.push('Please enter a valid email address.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.birthDate || '')) errors.push('Please enter your date of birth.');
  if (!/^\d{2}:\d{2}$/.test(o.birthTime || '')) errors.push('Please enter your birth time.');
  if (!TIME_SOURCES[o.timeSource]) errors.push('Please tell us where your birth time comes from.');
  const place = o.place || {};
  if (!clean(place.label) || !isFinite(place.lat) || !isFinite(place.lon) || !clean(place.tz)) errors.push('Please choose your birth place from the list.');
  const lang = o.language === 'de' ? 'de' : 'en';
  let lifeArea = '';
  if (strip === 'ultra') {
    lifeArea = clean(o.lifeArea, 80);
    if (!LIFE_AREAS.includes(lifeArea)) errors.push('Please choose the life area for your Ultra Strip.');
  }
  // Questionnaire for Maxi and Ultra. Only the current city is required (Ultra: solar return and transits).
  let questionnaire = null;
  if (strip === 'maxi' || strip === 'ultra') {
    const q = o.questionnaire || {};
    const r = q.residence;
    const residence = r && clean(r.label) && isFinite(r.lat) && isFinite(r.lon) && clean(r.tz) ? { label: clean(r.label), lat: Number(r.lat), lon: Number(r.lon), tz: clean(r.tz, 60) } : null;
    if (strip === 'ultra' && !residence) errors.push('Please choose where you live now from the list.');
    questionnaire = {
      residence,
      occupation: clean(q.occupation, 120),
      passions: clean(q.passions, 200),
      relationship: RELATIONSHIP.includes(q.relationship) ? q.relationship : '',
      focus: clean(q.focus, 300),
      sensitiveConsent: q.sensitiveConsent === true,
    };
  }
  if (o.acceptTerms !== true) errors.push('Please confirm that you are 18 or older and accept the terms and the cancellation policy.');
  if (o.earlyStart !== true) errors.push('Please confirm that we may start before the withdrawal period ends.');
  const order = {
    strip, name, email: String(o.email || '').trim(), language: lang,
    birthDate: o.birthDate, birthTime: o.birthTime, timeSource: o.timeSource,
    place: { label: clean(place.label), lat: Number(place.lat), lon: Number(place.lon), tz: clean(place.tz, 60) },
    lifeArea, nodes: o.nodes === true, ancestry: strip === 'ultra' && o.ancestry === true,
    note: clean(o.note, 500),
    questionnaire,
    newsletter: o.newsletter === true,
    // week the customer saw before ordering (YYYY-MM-DD); the server assigns the week and compares
    week: /^\d{4}-\d{2}-\d{2}$/.test(o.week || '') ? o.week : '',
  };
  return { errors, order };
}

function orderId(nowMs = Date.now()) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs)).replace(/-/g, '');
  const rnd = [...crypto.getRandomValues(new Uint8Array(3))].map(b => b.toString(36).padStart(2, '0')).join('').toUpperCase().slice(0, 5);
  return `AS-${d}-${rnd}`;
}

// ---------- mail texts ----------
const euro = cents => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

// Two mails to Sandra: accounting data (keep 8 years) and reading data (pseudonymous, delete 3 months after delivery).
export function ownerOrderMail(order, id, session) {
  const s = STRIPS[order.strip];
  return [
    `Bestellung ${id} (Buchhaltung, 8 Jahre aufbewahren)`,
    '',
    `Produkt: ${s.name}`,
    `Preis: ${euro(s.cents)} inkl. 19 % USt (${euro(Math.round(s.cents / 1.19))} netto, ${euro(s.cents - Math.round(s.cents / 1.19))} USt), bezahlt`,
    `Bestellt: ${berlinStamp(order.createdAt)}`,
    deliveryText(order, 'de'),
    '',
    `Name: ${order.name}`,
    `E-Mail: ${order.email}`,
    '',
    `Zustimmung vorzeitiger Beginn und Kenntnis vom Erlöschen des Widerrufsrechts: ja, erteilt am ${berlinStamp(order.createdAt)}`,
    `Stripe-Session: ${session.id} · Zahlungsstatus: ${session.payment_status}`,
    '',
    'Die Bestätigung mit Widerrufsbelehrung ist automatisch an die Kundin gegangen.',
    `Die Deutungsdaten kommen in einer eigenen Mail „Deutungsdaten ${id}“.`,
  ].join('\n');
}

export function ownerReadingMail(order, id) {
  const s = STRIPS[order.strip];
  const q = order.questionnaire;
  return [
    `Deutungsdaten ${id} · ${s.name}`,
    'Ohne Name und E-Mail. Nur diese Mail in Claude verwenden. 3 Monate nach Lieferung löschen.',
    '',
    `Sprache des Readings: ${order.language === 'de' ? 'Deutsch' : 'Englisch'}`,
    `Geburtsdatum: ${order.birthDate}`,
    `Geburtszeit: ${order.birthTime} (Ortszeit) · Quelle: ${TIME_SOURCES[order.timeSource]}`,
    `Geburtsort: ${order.place.label} · ${order.place.lat}, ${order.place.lon} · ${order.place.tz}`,
    order.strip === 'ultra' ? `Lebensbereich: ${order.lifeArea}` : null,
    `Karmische Mondknoten-Deutung: ${order.nodes ? 'ja' : 'nein'}`,
    order.strip === 'ultra' ? `Ahnenschicht: ${order.ancestry ? 'ja' : 'nein'}` : null,
    order.note ? `Anmerkung: ${order.note}` : null,
    ...(q ? [
      '',
      'Fragebogen:',
      `Wohnort heute: ${q.residence ? `${q.residence.label} · ${q.residence.lat}, ${q.residence.lon} · ${q.residence.tz}` : '–'}`,
      `Beruf: ${q.occupation || '–'}`,
      `Leidenschaften: ${q.passions || '–'}`,
      `Beziehungsstatus: ${q.relationship || 'keine Angabe'}`,
      `Was sie gerade verstehen will: ${q.focus || '–'}`,
      q.sensitiveConsent
        ? 'Einwilligung für sensible Angaben (Art. 9 DSGVO): ja'
        : 'Einwilligung für sensible Angaben (Art. 9 DSGVO): NEIN – Gesundheit, Sexualität, Glauben aus den Antworten nicht verwenden.',
    ] : []),
  ].filter(l => l !== null).join('\n');
}

// Contract confirmation (§ 312f BGB). The cancellation policy text is a DRAFT until legally reviewed.
export function customerMail(order, id, env) {
  const s = STRIPS[order.strip];
  const site = env.SITE_URL || 'https://astrostrip.com';
  return [
    `Hi ${order.name},`,
    '',
    `thank you for your order. This email confirms your contract.`,
    '',
    `Order: ${id}`,
    `Product: ${s.name} (${s.tag}), a personal astrology reading prepared for your birth chart and delivered as a PDF by email.`,
    `Price: ${euro(s.cents)} including 19 % VAT, paid.`,
    `Delivery: ${deliveryText(order)}.`,
    `Language: ${order.language === 'de' ? 'German' : 'English'}`,
    '',
    `Your birth data: ${order.birthDate}, ${order.birthTime} local time, ${order.place.label}.`,
    `If anything here is wrong, reply to this email before we start writing.`,
    '',
    'Your consent',
    `You expressly requested that we start writing your strip before the withdrawal period ends, and you confirmed that you know your right of withdrawal ends once the strip has been fully delivered. (Given on ${berlinStamp(order.createdAt)}.)`,
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
    'astro.strip · Sandra Willuweit · Bundesweg 4 · 20149 Hamburg · Germany · hello@astrostrip.com',
  ].join('\n');
}

// DRAFT. Generated from public/cancellation.html (German official model, Anlage 1 zu Art. 246a EGBGB,
// and EU model, Directive 2011/83/EU Annex I A). Page and mail must stay identical: edit the page, then regenerate.
export const CANCELLATION_POLICY = {
  "de": [
    "Widerrufsrecht",
    "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.",
    "Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (astro.strip, Sandra Willuweit, Bundesweg 4, 20149 Hamburg, Deutschland, hello@astrostrip.com) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür auch die Widerrufsfunktion auf unserer Website nutzen. Sie können das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.",
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
    "To exercise the right of withdrawal, you must inform us (astro.strip, Sandra Willuweit, Bundesweg 4, 20149 Hamburg, Germany, hello@astrostrip.com) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or an email). You may also use the withdrawal function on our website. You may use the attached model withdrawal form, but it is not obligatory.",
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
    "An astro.strip, Sandra Willuweit, Bundesweg 4, 20149 Hamburg, Deutschland, hello@astrostrip.com:",
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
    "To astro.strip, Sandra Willuweit, Bundesweg 4, 20149 Hamburg, Germany, hello@astrostrip.com:",
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
export function withdrawalReceipt({ name, contract, email, received, receivedEn }) {
  return [
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
    'Erstattung: Hatten wir mit Ihrem Strip noch nicht begonnen, erstatten wir Ihnen den vollen Betrag. Hatten wir bereits begonnen, auch wenn der Strip schon fertig, aber noch nicht an Sie geliefert war, zahlen Sie einen angemessenen Betrag für den Anteil, den wir bis zum Eingang Ihres Widerrufs bereits erbracht hatten; den Rest erstatten wir. Die Erstattung erfolgt spätestens vierzehn Tage nach Eingang Ihres Widerrufs über dasselbe Zahlungsmittel. War Ihr Strip bei Eingang des Widerrufs bereits vollständig geliefert, war Ihr Widerrufsrecht erloschen; dann melden wir uns bei Ihnen.',
    '',
    '---',
    '',
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
    'Refund: If we had not yet started your strip, we refund the full amount. If we had already started, even if the strip was finished but not yet delivered to you, you pay a proportionate amount for the part we had already done by the time your withdrawal reached us; we refund the rest. The refund is made within fourteen days of receiving your withdrawal, using the same means of payment. If your strip had already been fully delivered when your withdrawal reached us, your right of withdrawal had expired; in that case we will get in touch with you.',
    '',
    'astro.strip · Sandra Willuweit · Bundesweg 4 · 20149 Hamburg · Germany · hello@astrostrip.com',
  ].join('\n');
}

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
  version: 'v2-2026-09-30',
  en: 'Yes, send me the astro.strip newsletter by email: astrology insights and offers for readings and PDFs, about twice a month. astro.strip may see whether I open it and which links I click, to improve it. I can unsubscribe at any time via the link in every email; this also ends that evaluation. Details in the privacy notice.',
  de: 'Ja, schick mir den astro.strip-Newsletter per E-Mail: Astro-Impulse und Angebote zu Readings und PDFs, etwa zweimal im Monat. astro.strip darf auswerten, ob ich ihn öffne und welche Links ich anklicke, um ihn zu verbessern. Abmelden geht jederzeit über den Link in jeder Mail; damit endet auch diese Auswertung. Details in der Datenschutzerklärung.',
};

// Notice shown in the order form before payment (§ 7 Abs. 3 Nr. 4 UWG). Must be repeated in every such email.
export const CUSTOMER_NOTICE = {
  version: 'v1-2026-09-30',
  en: 'We will also use your email address to tell you about similar astro.strip readings and PDFs. You can object to this at any time, for example via the link in every such email or by writing to hello@astrostrip.com, without any costs other than the basic transmission costs.',
};

const DOI_TTL = 604800; // confirmation link valid for 7 days
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

// Proof of consent (DSK OH Direktwerbung 3.3/3.7): kept without expiry, also after an unsubscribe.
async function logConsent(env, email, event) {
  const key = `consent:${email.toLowerCase()}`;
  const log = JSON.parse((await env.ORDERS.get(key)) || '{"events":[]}');
  log.events.push(event);
  await env.ORDERS.put(key, JSON.stringify(log));
}

export async function startDoubleOptIn(env, email, source, ip) {
  const token = randomToken();
  await env.ORDERS.put(`doi:${token}`, JSON.stringify({ email, source, version: NEWSLETTER_CONSENT.version, requestedAt: Date.now(), ip }), { expirationTtl: DOI_TTL });
  const link = `${env.SITE_URL || 'https://astrostrip.com'}/api/confirm?t=${token}`;
  // Confirmation only, no advertising in this mail (BGH VI ZR 134/15).
  await sendMail(env, {
    to: email,
    subject: 'Please confirm your newsletter signup · Bitte bestätige deine Anmeldung',
    text: [
      'Please confirm that you want to receive the astro.strip newsletter:',
      link,
      '',
      'Bitte bestätige, dass du den astro.strip-Newsletter erhalten möchtest:',
      link,
      '',
      'The link is valid for 7 days. If you did not sign up, simply ignore this email; you will not hear from us.',
      'Der Link gilt 7 Tage. Wenn du dich nicht angemeldet hast, ignoriere diese Mail einfach; du bekommst dann nichts von uns.',
      '',
      'astro.strip · Sandra Willuweit · Bundesweg 4 · 20149 Hamburg · Germany · hello@astrostrip.com',
    ].join('\n'),
  });
}

// After a paid order: optional newsletter double opt-in, and the buyer list under § 7 Abs. 3 UWG.
// Failures here never block the order mails.
async function afterOrderMarketing(env, order) {
  try {
    if (order.newsletter) await startDoubleOptIn(env, order.email, 'order', '');
    if (env.MAILJET_CUSTOMER_LIST_ID) {
      await mailjetList(env, env.MAILJET_CUSTOMER_LIST_ID, order.email, 'addnoforce');
      await logConsent(env, order.email, { type: 'customer-7-3-uwg', orderId: order.id, at: new Date().toISOString(), noticeShown: CUSTOMER_NOTICE.version });
    }
  } catch (err) {
    console.error('marketing after order failed', err);
  }
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
  if (await rateLimited(env, request, 'checkout', 5)) return json({ error: 'Too many attempts. Please wait an hour or email hello@astrostrip.com.' }, 429);
  const slots = await freeSlots(env);
  const slot = slots[order.strip];
  if (!slot.next) return json({ error: `This strip is fully booked until ${longDate(slot.until)}. New weeks open every Monday.`, soldOut: true, slots }, 409);
  if (order.week && order.week !== slot.next) {
    return json({ error: `Someone was quicker: the next free week for this strip is now the week of ${longDate(slot.next)}. Please check and continue again.`, weekChanged: true, slots }, 409);
  }
  order.week = slot.next;
  order.thisWeek = slot.thisWeek;

  const now = Date.now();
  const id = orderId(now);
  order.createdAt = now;
  const s = STRIPS[order.strip];
  const site = env.SITE_URL || new URL(request.url).origin;
  const session = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    locale: order.language === 'de' ? 'de' : 'en',
    customer_email: order.email,
    submit_type: 'pay',
    client_reference_id: id,
    expires_at: Math.floor(now / 1000) + SESSION_MINUTES * 60,
    success_url: `${site}/thanks.html?order=${id}`,
    cancel_url: `${site}/order.html?strip=${order.strip}&cancelled=1`,
    line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: s.cents, product_data: { name: s.name, description: `${s.tag}. Personal reading prepared for your chart, PDF by email ${deliveryText(order)}. Price includes 19 % VAT.` } } } },
    metadata: { order_id: id, strip: order.strip, week: String(slot.nextStart) },
    payment_intent_data: { metadata: { order_id: id, strip: order.strip, week: order.week } },
    custom_text: { submit: { message: `By paying you place a binding order for the ${s.name} (${euro(s.cents)} incl. 19 % VAT).` } },
  });
  // Order details wait here until payment; kept at most 2 days.
  await env.ORDERS.put(`order:${session.id}`, JSON.stringify({ id, ...order }), { expirationTtl: 172800 });
  return json({ url: session.url, orderId: id });
}

async function handleWebhook(request, env) {
  const body = await request.text();
  const ok = await verifyStripeSignature(body, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Invalid signature', { status: 400 });
  const event = JSON.parse(body);
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
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `Bestellung ${order.id}: ${STRIPS[order.strip].name}`, text: ownerOrderMail(order, order.id, session), replyTo: order.email });
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `Deutungsdaten ${order.id}`, text: ownerReadingMail(order, order.id) });
  await sendMail(env, { to: order.email, subject: `Your ${STRIPS[order.strip].name} order ${order.id}`, text: customerMail(order, order.id, env), replyTo: env.MAIL_FROM_ADDRESS || 'hello@astrostrip.com' });
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
  const text = withdrawalReceipt({ name, contract, email: b.email, received, receivedEn });
  await sendMail(env, { to: b.email, subject: `Eingangsbestätigung Widerruf / Receipt of your withdrawal (${contract})`, text });
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `WIDERRUF eingegangen: ${contract}`, text: `Widerruf über die Website, eingegangen ${received}.\n\nName: ${name}\nVertrag: ${contract}\nE-Mail: ${b.email}\n\nEingangsbestätigung ist automatisch rausgegangen. Erstattung spätestens 14 Tage nach Eingang, anteilig, falls schon mit dem Schreiben begonnen wurde.` , replyTo: b.email });
  return json({ ok: true, received, receivedEn });
}

async function handleSubscribe(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (b.website) return json({ ok: true }); // honeypot: bots fill the hidden field
  if (!isEmail(b.email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (b.consent !== true) return json({ error: 'Please tick the box to agree to the newsletter.' }, 400);
  if (await rateLimited(env, request, 'subscribe', 5)) return json({ error: 'Too many attempts. Please try again later.' }, 429);
  const source = ['calculator', 'newsletter-page', 'footer'].includes(b.source) ? b.source : 'website';
  await startDoubleOptIn(env, String(b.email).trim(), source, request.headers.get('CF-Connecting-IP') || '');
  return json({ ok: true }); // same answer whether or not the address is already subscribed
}

async function handleConfirm(request, env) {
  const site = env.SITE_URL || new URL(request.url).origin;
  const token = new URL(request.url).searchParams.get('t') || '';
  const raw = /^[0-9a-f]{64}$/.test(token) ? await env.ORDERS.get(`doi:${token}`) : null;
  if (!raw) return Response.redirect(`${site}/newsletter.html?status=expired`, 303);
  const d = JSON.parse(raw);
  await mailjetList(env, env.MAILJET_NEWSLETTER_LIST_ID, d.email, 'addforce');
  await logConsent(env, d.email, {
    type: 'newsletter-optin', version: d.version, source: d.source,
    requestedAt: new Date(d.requestedAt).toISOString(), confirmedAt: new Date().toISOString(),
    ipRequest: d.ip || '', ipConfirm: request.headers.get('CF-Connecting-IP') || '',
  });
  await env.ORDERS.delete(`doi:${token}`);
  return Response.redirect(`${site}/newsletter.html?status=confirmed`, 303);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/slots' && request.method === 'GET') return await handleSlots(env);
      if (url.pathname === '/api/checkout' && request.method === 'POST') return await handleCheckout(request, env);
      if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') return await handleWebhook(request, env);
      if (url.pathname === '/api/withdraw' && request.method === 'POST') return await handleWithdraw(request, env);
      if (url.pathname === '/api/subscribe' && request.method === 'POST') return await handleSubscribe(request, env);
      if (url.pathname === '/api/confirm' && request.method === 'GET') return await handleConfirm(request, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      if (url.pathname === '/api/stripe-webhook') return new Response('error', { status: 500 }); // Stripe retries
      return json({ error: 'Something went wrong on our side. Nothing was charged. Please try again, or email hello@astrostrip.com.' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
