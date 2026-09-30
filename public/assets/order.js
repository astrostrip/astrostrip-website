// Order form: collects the details for a strip, shows free slots, hands over to Stripe Checkout via /api/checkout.

import { attachPlaceSearch } from './places.js';

const $ = s => document.querySelector(s);
const PRICES = { mini: 39, maxi: 79, ultra: 129 };
const NAMES = { mini: 'Mini Strip', maxi: 'Maxi Strip', ultra: 'Ultra Strip' };
const DAYS = { mini: 5, maxi: 7, ultra: 10 };
const DRAFT_KEY = 'astrostrip-order-draft'; // kept in this tab only, so a cancelled payment keeps the details

const form = $('#order-form');
const status = $('#order-status');
const placeError = () => { status.textContent = 'The place list could not be loaded. Please reload the page.'; };
const getPlace = attachPlaceSearch($('#place'), $('#place-list'), placeError);
const getResidence = attachPlaceSearch($('#residence'), $('#residence-list'), placeError);
let slots = null;

const selected = () => form.querySelector('input[name=strip]:checked')?.value || '';

// Dates from /api/slots are Berlin calendar dates (YYYY-MM-DD).
const fmt = (ymd, opts) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts }); };
const longDay = ymd => fmt(ymd, { day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = ymd => fmt(ymd, { day: 'numeric', month: 'short' });
const slotLine = s => s.left > 0 ? `${s.left} of ${s.limit} slots left this week`
  : s.next ? `This week fully booked · next free week: ${shortDay(s.next)}`
  : `Fully booked until ${shortDay(s.until)}`;

function update() {
  const strip = selected();
  const ultra = strip === 'ultra';
  $('#life-area-field').hidden = !ultra;
  $('#questionnaire').hidden = !(ultra || strip === 'maxi');
  $('#residence-req').hidden = !ultra;
  $('#ancestry-row').hidden = !ultra;
  if (!ultra) $('#ancestry').checked = false;
  const s = strip && slots ? slots[strip] : null;
  const soldOut = !!(s && !s.next);
  const later = !!(s && s.next && !s.thisWeek);
  $('#summary-text').textContent = !strip ? 'Choose a strip above.'
    : later ? `${NAMES[strip]}: ${PRICES[strip]} € including 19 % VAT. This week is fully booked, so your strip is booked for the week of ${longDay(s.next)}. Prepared for your chart alone, personally reviewed and delivered as a PDF by email within ${DAYS[strip]} working days from that Monday.`
    : `${NAMES[strip]}: ${PRICES[strip]} € including 19 % VAT. Prepared for your chart alone, personally reviewed and delivered as a PDF by email within ${DAYS[strip]} working days after payment.`;
  $('#order-submit').disabled = soldOut;
  status.textContent = soldOut ? `This strip is fully booked until ${longDay(s.until)}. New weeks open every Monday.` : '';
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
  $('#language').value = d.language || 'en';
  $('#nodes').checked = !!d.nodes;
  $('#ancestry').checked = !!d.ancestry;
  $('#note').value = d.note || '';
  const q = d.questionnaire || {};
  if (q.residence?.label) $('#residence').value = q.residence.label;
  $('#occupation').value = q.occupation || '';
  $('#passions').value = q.passions || '';
  $('#relationship').value = q.relationship || '';
  $('#focus').value = q.focus || '';
  $('#sensitive-consent').checked = !!q.sensitiveConsent;
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
  if (!strip) { status.textContent = 'Please choose a strip.'; return; }
  const place = await getPlace();
  const withQ = strip === 'maxi' || strip === 'ultra';
  const residence = withQ && $('#residence').value.trim() ? await getResidence() : null;
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
    nodes: $('#nodes').checked,
    ancestry: strip === 'ultra' && $('#ancestry').checked,
    note: $('#note').value.trim(),
    questionnaire: withQ ? {
      residence: residence ? { label: [residence.name, residence.region, residence.country].filter(Boolean).join(', '), lat: residence.lat, lon: residence.lon, tz: residence.tz } : null,
      occupation: $('#occupation').value.trim(),
      passions: $('#passions').value.trim(),
      relationship: $('#relationship').value,
      focus: $('#focus').value.trim(),
      sensitiveConsent: $('#sensitive-consent').checked,
    } : null,
    newsletter: $('#newsletter').checked,
    week: slots?.[strip]?.next || '', // the server checks that this is still the next free week
    acceptTerms: $('#accept-terms').checked,
    earlyStart: $('#early-start').checked,
  };
  // Same checks as the server, so mistakes show up before the round trip.
  const missing = [];
  if (data.name.length < 2) missing.push('your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) missing.push('a valid email');
  if (!data.birthDate) missing.push('your date of birth');
  if (!data.birthTime) missing.push('your birth time');
  if (!data.timeSource) missing.push('where your birth time comes from');
  if (!data.place) missing.push('your birth place (choose it from the list)');
  if (strip === 'ultra' && !data.lifeArea) missing.push('the life area');
  if (strip === 'ultra' && !data.questionnaire.residence) missing.push('where you live now (choose it from the list)');
  if (missing.length) { status.textContent = `Please add ${missing.join(', ')}.`; return; }
  if (!data.acceptTerms || !data.earlyStart) { status.textContent = 'Please tick both boxes above the button.'; return; }

  const { acceptTerms, earlyStart, week, ...draft } = data;
  saveDraft(draft);
  const btn = $('#order-submit');
  btn.disabled = true;
  btn.textContent = 'ONE MOMENT…';
  try {
    const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({}));
    if (out.slots) { slots = out.slots; for (const el of document.querySelectorAll('[data-slot]')) if (slots[el.dataset.slot]) { el.textContent = slotLine(slots[el.dataset.slot]); el.classList.toggle('sold-out', !slots[el.dataset.slot].next); } update(); }
    if (!res.ok || !out.url) throw new Error(out.error || '');
    location.href = out.url;
  } catch (err) {
    status.textContent = err.message && !err.message.includes('fetch') ? err.message : 'Ordering is not available right now. Nothing was charged. Please try again later or email hello@astrostrip.com.';
    btn.disabled = !!(slots?.[strip] && !slots[strip].next); // stays off when fully booked
    btn.textContent = 'CONTINUE TO PAYMENT';
  }
});
