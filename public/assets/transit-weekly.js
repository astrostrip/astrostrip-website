// Transit Weekly booked later or renewed (Sandra, 11.10.2026): order number + email of the Maxi/Ultra Strip,
// birth data and residence again, life areas; hands over to Stripe Checkout via /api/transit-weekly.

import { attachPlaceSearch } from './places.js';

const $ = s => document.querySelector(s);
// Transit Weekly per life area for 13 weeks: founding price 87 € (29 € a month) while places are left, then 117 €;
// tw-price.js asks the worker (Sandra, 11.10.2026). The checkout always shows the binding price.
let TW_PRICE = window.twPriceData ? window.twPriceData.cents / 100 : 87;
addEventListener('twprice', e => { TW_PRICE = e.detail.cents / 100; update(); });
const UNSURE_TIME = ['family', 'approximate'];
const form = $('#tw-form');
const status = $('#tw-status');
const placeError = () => { status.textContent = 'The place list could not be loaded. Please reload the page.'; };
const getPlace = attachPlaceSearch($('#place'), $('#place-list'), placeError);
const getResidence = attachPlaceSearch($('#residence'), $('#residence-list'), placeError);
const areas = () => [...form.querySelectorAll('input[name=tw-area]:checked')].map(i => i.value);
const eur = n => `${n.toLocaleString('en-GB')} €`;
const shortDay = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }); };
let slots = null;

function update() {
  const a = areas();
  $('#tw-time-row').hidden = !(a.length && UNSURE_TIME.includes($('#time-source').value));
  $('#summary-text').textContent = a.length
    ? `Transit Weekly for ${a.length} life area${a.length === 1 ? '' : 's'} (${a.join(', ')}): ${eur(a.length * TW_PRICE)} including 19 % VAT for 13 weeks.`
    : 'Choose at least one life area above.';
  const tw = slots?.transit;
  $('#transit-slot').textContent = tw && !tw.next ? `Transit Weekly is fully booked until ${shortDay(tw.until)}. New weeks open every Monday.` : '';
  $('#tw-submit').disabled = !!(tw && !tw.next);
}

fetch('/api/slots', { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).then(d => { slots = d; update(); }).catch(() => { /* the server checks on submit */ });
const params = new URLSearchParams(location.search);
if (params.get('cancelled')) $('#cancelled').hidden = false;
if (/^AS-\d{8}-[A-Z0-9]{5}$/.test(params.get('order') || '')) $('#base-order').value = params.get('order');
form.addEventListener('change', update);
update();

form.addEventListener('submit', async e => {
  e.preventDefault();
  status.textContent = '';
  const place = await getPlace();
  const residence = $('#residence').value.trim() ? await getResidence() : null;
  const label = p => [p.name, p.region, p.country].filter(Boolean).join(', ');
  const a = areas();
  const data = {
    baseOrder: $('#base-order').value.trim().toUpperCase(),
    email: $('#email').value.trim(),
    name: $('#name').value.trim(),
    birthDate: $('#birth-date').value,
    birthTime: $('#birth-time').value.slice(0, 5),
    timeSource: $('#time-source').value,
    place: place ? { label: label(place), lat: place.lat, lon: place.lon, tz: place.tz } : null,
    residence: residence ? { label: label(residence), lat: residence.lat, lon: residence.lon, tz: residence.tz } : null,
    language: $('#language').value,
    transit: { areas: a, timeConsent: $('#tw-time-consent').checked, earlyStart: $('#tw-early-start').checked },
    acceptTerms: $('#accept-terms').checked,
  };
  // Same checks as the server, so mistakes show up before the round trip.
  const missing = [];
  if (!/^AS-\d{8}-[A-Z0-9]{5}$/.test(data.baseOrder)) missing.push('the order number of your strip (AS-…)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) missing.push('the email you used for your strip');
  if (data.name.length < 2) missing.push('your name');
  if (!data.birthDate) missing.push('your date of birth');
  if (!data.birthTime) missing.push('your birth time');
  if (!data.timeSource) missing.push('where your birth time comes from');
  if (!data.place) missing.push('your birth place (choose it from the list)');
  if (!data.residence) missing.push('where you live now (choose it from the list)');
  if (!a.length) missing.push('at least one life area');
  if (a.length && UNSURE_TIME.includes(data.timeSource) && !data.transit.timeConsent) missing.push('the box about your birth time');
  if (missing.length) { status.textContent = `Please add ${missing.join(', ')}.`; return; }
  if (!data.acceptTerms || !data.transit.earlyStart) { status.textContent = 'Please tick both boxes above the button.'; return; }

  const btn = $('#tw-submit');
  btn.disabled = true;
  btn.textContent = 'ONE MOMENT…';
  try {
    const res = await fetch('/api/transit-weekly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) throw new Error(out.error || '');
    location.href = out.url;
  } catch (err) {
    status.textContent = err.message && !err.message.includes('fetch') ? err.message : 'Booking is not available right now. Nothing was charged. Please try again later or email hello@astrostrip.com.';
    btn.disabled = false;
    btn.textContent = 'CONTINUE TO PAYMENT';
  }
});
