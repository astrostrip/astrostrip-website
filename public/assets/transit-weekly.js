// Transit Weekly booked later or renewed (Sandra, 11.10.2026): order number + email of the Maxi/Ultra Strip,
// birth data and residence again, life areas; hands over to Stripe Checkout via /api/transit-weekly.

import { attachPlaceSearch } from './places.js';

const $ = s => document.querySelector(s);
// German site /de/ (Sandra, 18.10.2026): same script, L(english, german); values sent to the server stay English
const DE = document.documentElement.lang === 'de';
const L = (en, de) => (DE ? de : en);
const AREA_DE = { 'Love and relationships': 'Liebe und Beziehungen', 'Work and calling': 'Beruf und Berufung', 'Money and self-worth': 'Geld und Selbstwert', 'Home and family': 'Zuhause und Familie', 'Creativity and self-expression': 'Kreativität und Ausdruck', 'Friends and belonging': 'Freundschaft und Zugehörigkeit', 'Personal growth': 'Persönliches Wachstum' };
const areaName = a => (DE ? AREA_DE[a] || a : a);
const LOCALE = L('en-GB', 'de-DE');
// Transit Weekly per life area for 13 weeks: founding price 87 € (29 € a month) while places are left, then 117 €;
// tw-price.js asks the worker (Sandra, 11.10.2026). The checkout always shows the binding price.
let TW_PRICE = window.twPriceData ? window.twPriceData.cents / 100 : 87;
addEventListener('twprice', e => { TW_PRICE = e.detail.cents / 100; update(); });
const UNSURE_TIME = ['family', 'approximate'];
const form = $('#tw-form');
const status = $('#tw-status');
const placeError = () => { status.textContent = L('The place list could not be loaded. Please reload the page.', 'Die Ortsliste konnte nicht geladen werden. Bitte lade die Seite neu.'); };
const getPlace = attachPlaceSearch($('#place'), $('#place-list'), placeError);
const getResidence = attachPlaceSearch($('#residence'), $('#residence-list'), placeError);
const areas = () => [...form.querySelectorAll('input[name=tw-area]:checked')].map(i => i.value);
const eur = n => `${n.toLocaleString(LOCALE)} €`;
const shortDay = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short' }); };
let slots = null;

function update() {
  const a = areas();
  $('#tw-time-row').hidden = !(a.length && UNSURE_TIME.includes($('#time-source').value));
  $('#summary-text').textContent = a.length
    ? L(`Transit Weekly for ${a.length} life area${a.length === 1 ? '' : 's'} (${a.join(', ')}): ${eur(a.length * TW_PRICE)} including 19 % VAT for 13 weeks.`,
      `Transit Weekly für ${a.length} ${a.length === 1 ? 'Lebensbereich' : 'Lebensbereiche'} (${a.map(areaName).join(', ')}): ${eur(a.length * TW_PRICE)} inklusive 19 % MwSt. für 13 Wochen.`)
    : L('Choose at least one life area above.', 'Wähle oben mindestens einen Lebensbereich.');
  const tw = slots?.transit;
  $('#transit-slot').textContent = tw && !tw.next ? L(`Transit Weekly is fully booked until ${shortDay(tw.until)}. New weeks open every Monday.`, `Transit Weekly ist bis ${shortDay(tw.until)} ausgebucht. Jeden Montag kommen neue Wochen dazu.`) : '';
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
    site: DE ? 'de' : '', // German site: messages and Stripe page in German, back to /de/
  };
  // Same checks as the server, so mistakes show up before the round trip.
  const missing = [];
  if (!/^AS-\d{8}-[A-Z0-9]{5}$/.test(data.baseOrder)) missing.push(L('the order number of your strip (AS-…)', 'die Bestellnummer deines Strips (AS-…)'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) missing.push(L('the email you used for your strip', 'die E-Mail-Adresse, mit der du den Strip bestellt hast'));
  if (data.name.length < 2) missing.push(L('your name', 'deinen Namen'));
  if (!data.birthDate) missing.push(L('your date of birth', 'dein Geburtsdatum'));
  if (!data.birthTime) missing.push(L('your birth time', 'deine Geburtszeit'));
  if (!data.timeSource) missing.push(L('where your birth time comes from', 'woher deine Geburtszeit stammt'));
  if (!data.place) missing.push(L('your birth place (choose it from the list)', 'deinen Geburtsort (aus der Liste wählen)'));
  if (!data.residence) missing.push(L('where you live now (choose it from the list)', 'deinen jetzigen Wohnort (aus der Liste wählen)'));
  if (!a.length) missing.push(L('at least one life area', 'mindestens einen Lebensbereich'));
  if (a.length && UNSURE_TIME.includes(data.timeSource) && !data.transit.timeConsent) missing.push(L('the box about your birth time', 'das Häkchen zu deiner Geburtszeit'));
  if (missing.length) { status.textContent = L(`Please add ${missing.join(', ')}.`, `Bitte ergänze ${missing.join(', ')}.`); return; }
  if (!data.acceptTerms || !data.transit.earlyStart) { status.textContent = L('Please tick both boxes above the button.', 'Bitte setz beide Häkchen über dem Button.'); return; }

  const btn = $('#tw-submit');
  btn.disabled = true;
  btn.textContent = L('ONE MOMENT…', 'EINEN MOMENT …');
  try {
    const res = await fetch('/api/transit-weekly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) throw new Error(out.error || '');
    location.href = out.url;
  } catch (err) {
    status.textContent = err.message && !err.message.includes('fetch') ? err.message : L('Booking is not available right now. Nothing was charged. Please try again later or email hello@astrostrip.com.', 'Buchen ist gerade nicht möglich. Es wurde nichts abgebucht. Bitte versuche es später noch einmal oder schreib an hello@astrostrip.com.');
    btn.disabled = false;
    btn.textContent = L('CONTINUE TO PAYMENT', 'WEITER ZUR ZAHLUNG');
  }
});
