// Order form: collects the details for a strip, shows free slots, hands over to Stripe Checkout via /api/checkout.

import { attachPlaceSearch } from './places.js';

const $ = s => document.querySelector(s);
// German site /de/ (Sandra, 18.10.2026): same script, L(english, german); values sent to the server stay English
const DE = document.documentElement.lang === 'de';
const L = (en, de) => (DE ? de : en);
const AREA_DE = { 'Love and relationships': 'Liebe und Beziehungen', 'Work and calling': 'Beruf und Berufung', 'Money and self-worth': 'Geld und Selbstwert', 'Home and family': 'Zuhause und Familie', 'Creativity and self-expression': 'Kreativität und Ausdruck', 'Friends and belonging': 'Freundschaft und Zugehörigkeit', 'Personal growth': 'Persönliches Wachstum' };
const areaName = a => (DE ? AREA_DE[a] || a : a);
const LOCALE = L('en-GB', 'de-DE');
const PRICES = { mini: 39, maxi: 79, ultra: 129 };
const NAMES = { mini: 'Mini Strip', maxi: 'Maxi Strip', ultra: 'Ultra Strip' };
const DAYS = { mini: 5, maxi: 7, ultra: 10 };
// Transit Weekly per life area for 13 weeks: founding price 87 € (29 € a month) while places are left, then 117 €;
// tw-price.js asks the worker (Sandra, 11.10.2026). The checkout always shows the binding price.
let TW_PRICE = window.twPriceData ? window.twPriceData.cents / 100 : 87;
addEventListener('twprice', e => { TW_PRICE = e.detail.cents / 100; update(); });
const UNSURE_TIME = ['family', 'approximate'];
const DRAFT_KEY = 'astrostrip-order-draft'; // kept in this tab only, so a cancelled payment keeps the details

const form = $('#order-form');
const status = $('#order-status');
const placeError = () => { status.textContent = L('The place list could not be loaded. Please reload the page.', 'Die Ortsliste konnte nicht geladen werden. Bitte lade die Seite neu.'); };
const getPlace = attachPlaceSearch($('#place'), $('#place-list'), placeError);
const getResidence = attachPlaceSearch($('#residence'), $('#residence-list'), placeError);
let slots = null;

const selected = () => form.querySelector('input[name=strip]:checked')?.value || '';
const twAreas = () => [...form.querySelectorAll('input[name=tw-area]:checked')].map(i => i.value);
const eur = n => `${n.toLocaleString(LOCALE)} €`;

// Dates from /api/slots are Berlin calendar dates (YYYY-MM-DD).
const fmt = (ymd, opts) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, { timeZone: 'UTC', ...opts }); };
const longDay = ymd => fmt(ymd, { day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = ymd => fmt(ymd, { day: 'numeric', month: 'short' });
const slotLine = s => s.left > 0 ? L(`${s.left} slots left this week`, `Diese Woche noch ${s.left} ${s.left === 1 ? 'Platz' : 'Plätze'} frei`)
  : s.next ? L(`This week fully booked · next free week: ${shortDay(s.next)}`, `Diese Woche ausgebucht · nächste freie Woche: ${shortDay(s.next)}`)
  : L(`Fully booked until ${shortDay(s.until)}`, `Ausgebucht bis ${shortDay(s.until)}`);

function update() {
  const strip = selected();
  const ultra = strip === 'ultra';
  $('#life-area-field').hidden = !ultra;
  $('#questionnaire').hidden = !(ultra || strip === 'maxi');
  // Transit Weekly only with Maxi or Ultra; then the current city is required and, with an inexact birth time,
  // the confirmation box (Sandra, 11.10.2026).
  const twOk = ultra || strip === 'maxi';
  $('#transit').hidden = !twOk;
  if (!twOk) for (const i of form.querySelectorAll('input[name=tw-area]')) i.checked = false;
  const areas = twAreas();
  $('#tw-time-row').hidden = !(areas.length && UNSURE_TIME.includes($('#time-source').value));
  $('#tw-early-row').hidden = !areas.length;
  $('#residence-req').hidden = !(ultra || areas.length);
  const tw = slots?.transit;
  $('#transit-slot').textContent = tw && !tw.next ? L(`Transit Weekly is fully booked until ${shortDay(tw.until)}. You can add it later with your order number.`, `Transit Weekly ist bis ${shortDay(tw.until)} ausgebucht. Du kannst es später mit deiner Bestellnummer dazubuchen.`) : '';
  $('#ancestry-row').hidden = !ultra;
  if (!ultra) $('#ancestry').checked = false;
  // The Mini Strip reads only the Big Three: no karmic nodes layer (Sandra, 03.10.2026).
  $('#options').hidden = strip === 'mini';
  if (strip === 'mini') $('#nodes').checked = false;
  const s = strip && slots ? slots[strip] : null;
  const soldOut = !!(s && !s.next);
  const later = !!(s && s.next && !s.thisWeek);
  const twText = !areas.length ? '' : L(` Plus Transit Weekly for ${areas.length} life area${areas.length === 1 ? '' : 's'} (${areas.join(', ')}): ${eur(areas.length * TW_PRICE)} for 13 weeks. Total ${eur(PRICES[strip] + areas.length * TW_PRICE)} including 19 % VAT.`,
    ` Dazu Transit Weekly für ${areas.length} ${areas.length === 1 ? 'Lebensbereich' : 'Lebensbereiche'} (${areas.map(areaName).join(', ')}): ${eur(areas.length * TW_PRICE)} für 13 Wochen. Zusammen ${eur(PRICES[strip] + areas.length * TW_PRICE)} inklusive 19 % MwSt.`);
  $('#summary-text').textContent = !strip ? L('Choose a strip above.', 'Wähle oben einen Strip.')
    : (later ? L(`${NAMES[strip]}: ${PRICES[strip]} € including 19 % VAT. This week is fully booked, so your strip is booked for the week of ${longDay(s.next)}. Prepared for your chart alone and delivered as a PDF by email within ${DAYS[strip]} working days from that Monday.`,
      `${NAMES[strip]}: ${PRICES[strip]} € inklusive 19 % MwSt. Diese Woche ist ausgebucht, dein Strip ist deshalb für die Woche ab ${longDay(s.next)} gebucht. Eigens für dein Horoskop geschrieben und als PDF per E-Mail geliefert, spätestens ${DAYS[strip]} Werktage nach diesem Montag.`)
    : L(`${NAMES[strip]}: ${PRICES[strip]} € including 19 % VAT. Prepared for your chart alone and delivered as a PDF by email within ${DAYS[strip]} working days after payment.`,
      `${NAMES[strip]}: ${PRICES[strip]} € inklusive 19 % MwSt. Eigens für dein Horoskop geschrieben und als PDF per E-Mail geliefert, spätestens ${DAYS[strip]} Werktage nach der Zahlung.`)) + twText;
  $('#order-submit').disabled = soldOut;
  status.textContent = soldOut ? L(`This strip is fully booked until ${longDay(s.until)}. New weeks open every Monday.`, `Dieser Strip ist bis ${longDay(s.until)} ausgebucht. Jeden Montag kommen neue Wochen dazu.`) : '';
}

async function loadSlots() {
  try {
    const res = await fetch('/api/slots', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    slots = await res.json();
    for (const el of document.querySelectorAll('[data-slot]')) {
      const s = slots[el.dataset.slot];
      if (!s) continue;
      el.textContent = slotLine(s);
      el.classList.toggle('sold-out', !s.next);
    }
    update();
  } catch { /* no slot info (e.g. local preview): the server still checks on submit */ }
}

function saveDraft(data) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}
function restoreDraft() {
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d) return;
  $('#name').value = d.name || '';
  $('#email').value = d.email || '';
  $('#birth-date').value = d.birthDate || '';
  $('#birth-time').value = d.birthTime || '';
  $('#time-source').value = d.timeSource || '';
  if (d.place?.label) $('#place').value = d.place.label;
  $('#life-area').value = d.lifeArea || '';
  $('#language').value = d.language || L('en', 'de');
  $('#nodes').checked = !!d.nodes;
  $('#ancestry').checked = !!d.ancestry;
  $('#note').value = d.note || '';
  const q = d.questionnaire || {};
  if (q.residence?.label) $('#residence').value = q.residence.label;
  $('#occupation').value = q.occupation || '';
  $('#passions').value = q.passions || '';
  $('#relationship').value = q.relationship || '';
  $('#focus').value = q.focus || '';
  $('#sensitive-consent').checked = !!(d.sensitiveConsent || q.sensitiveConsent);
  const tw = d.transit?.areas || [];
  for (const i of form.querySelectorAll('input[name=tw-area]')) i.checked = tw.includes(i.value);
  $('#tw-time-consent').checked = !!d.transit?.timeConsent;
}

const params = new URLSearchParams(location.search);
const pre = params.get('strip');
if (pre && PRICES[pre]) form.querySelector(`input[name=strip][value=${pre}]`).checked = true;
if (params.get('cancelled')) { $('#cancelled').hidden = false; restoreDraft(); }
form.addEventListener('change', update);
update();
loadSlots();

form.addEventListener('submit', async e => {
  e.preventDefault();
  status.textContent = '';
  const strip = selected();
  if (!strip) { status.textContent = L('Please choose a strip.', 'Bitte wähle einen Strip.'); return; }
  const place = await getPlace();
  const withQ = strip === 'maxi' || strip === 'ultra';
  const residence = withQ && $('#residence').value.trim() ? await getResidence() : null;
  const areas = withQ ? twAreas() : [];
  const data = {
    strip,
    name: $('#name').value.trim(),
    email: $('#email').value.trim(),
    birthDate: $('#birth-date').value,
    birthTime: $('#birth-time').value.slice(0, 5),
    timeSource: $('#time-source').value,
    place: place ? { label: [place.name, place.region, place.country].filter(Boolean).join(', '), lat: place.lat, lon: place.lon, tz: place.tz } : null,
    lifeArea: strip === 'ultra' ? $('#life-area').value : '',
    language: $('#language').value,
    nodes: strip !== 'mini' && $('#nodes').checked,
    ancestry: strip === 'ultra' && $('#ancestry').checked,
    note: $('#note').value.trim(),
    sensitiveConsent: $('#sensitive-consent').checked,
    questionnaire: withQ ? {
      residence: residence ? { label: [residence.name, residence.region, residence.country].filter(Boolean).join(', '), lat: residence.lat, lon: residence.lon, tz: residence.tz } : null,
      occupation: $('#occupation').value.trim(),
      passions: $('#passions').value.trim(),
      relationship: $('#relationship').value,
      focus: $('#focus').value.trim(),
    } : null,
    newsletter: $('#newsletter').checked,
    transit: areas.length ? { areas, timeConsent: $('#tw-time-consent').checked, earlyStart: $('#tw-early-start').checked } : null,
    week: slots?.[strip]?.next || '', // the server checks that this is still the next free week
    site: DE ? 'de' : '', // German site: messages and Stripe page in German, back to /de/
    acceptTerms: $('#accept-terms').checked,
    earlyStart: $('#early-start').checked,
  };
  // Same checks as the server, so mistakes show up before the round trip.
  const missing = [];
  if (data.name.length < 2) missing.push(L('your name', 'deinen Namen'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) missing.push(L('a valid email', 'eine gültige E-Mail-Adresse'));
  if (!data.birthDate) missing.push(L('your date of birth', 'dein Geburtsdatum'));
  if (!data.birthTime) missing.push(L('your birth time', 'deine Geburtszeit'));
  if (!data.timeSource) missing.push(L('where your birth time comes from', 'woher deine Geburtszeit stammt'));
  if (!data.place) missing.push(L('your birth place (choose it from the list)', 'deinen Geburtsort (aus der Liste wählen)'));
  if (strip === 'ultra' && !data.lifeArea) missing.push(L('the life area', 'den Lebensbereich'));
  if ((strip === 'ultra' || areas.length) && !data.questionnaire.residence) missing.push(L('where you live now (choose it from the list)', 'deinen jetzigen Wohnort (aus der Liste wählen)'));
  if (areas.length && UNSURE_TIME.includes(data.timeSource) && !data.transit.timeConsent) missing.push(L('the Transit Weekly box about your birth time', 'das Häkchen zu deiner Geburtszeit bei Transit Weekly'));
  if (missing.length) { status.textContent = L(`Please add ${missing.join(', ')}.`, `Bitte ergänze ${missing.join(', ')}.`); return; }
  // Free text may contain sensitive details (Art. 9 GDPR): consent is required whenever any free-text field is filled (Sandra, 05.10.2026).
  const freeText = [data.note, data.questionnaire?.occupation, data.questionnaire?.passions, data.questionnaire?.focus].some(Boolean);
  if (freeText && !data.sensitiveConsent) { status.textContent = L('You wrote something in the free-text fields. Please tick the consent box for sensitive information, or clear those fields.', 'Du hast etwas in die Freitextfelder geschrieben. Bitte setz das Häkchen bei der Einwilligung für sensible Angaben oder leere diese Felder.'); return; }
  if (!data.acceptTerms || !data.earlyStart || (areas.length && !data.transit.earlyStart)) { status.textContent = L(`Please tick ${areas.length ? 'all three' : 'both'} boxes above the button.`, `Bitte setz ${areas.length ? 'alle drei' : 'beide'} Häkchen über dem Button.`); return; }

  const { acceptTerms, earlyStart, week, ...draft } = data;
  saveDraft(draft);
  const btn = $('#order-submit');
  btn.disabled = true;
  btn.textContent = L('ONE MOMENT…', 'EINEN MOMENT …');
  try {
    const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({}));
    if (out.slots) { slots = out.slots; for (const el of document.querySelectorAll('[data-slot]')) if (slots[el.dataset.slot]) { el.textContent = slotLine(slots[el.dataset.slot]); el.classList.toggle('sold-out', !slots[el.dataset.slot].next); } update(); }
    if (!res.ok || !out.url) throw new Error(out.error || '');
    location.href = out.url;
  } catch (err) {
    status.textContent = err.message && !err.message.includes('fetch') ? err.message : L('Ordering is not available right now. Nothing was charged. Please try again later or email hello@astrostrip.com.', 'Bestellen ist gerade nicht möglich. Es wurde nichts abgebucht. Bitte versuche es später noch einmal oder schreib an hello@astrostrip.com.');
    btn.disabled = !!(slots?.[strip] && !slots[strip].next); // stays off when fully booked
    btn.textContent = L('CONTINUE TO PAYMENT', 'WEITER ZUR ZAHLUNG');
  }
});
