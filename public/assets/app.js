// astro.strip birth chart calculator.
// Everything runs in the visitor's browser. No birth data is sent anywhere.
// Engine: Swiss Ephemeris (Astrodienst AG) compiled to WebAssembly, AGPL-3.0.
// Conventions follow astro.strip's psychological school: tropical zodiac,
// Placidus houses, true node, orbs from the school's table (L8 p. 15).

import SwissEph from '../vendor/swisseph/src/swisseph.js';
import { TEXTS, ROLES } from './texts.js';
import { ZODIAC_PATHS, signIcon } from './zodiac.js';
import { attachPlaceSearch } from './places.js';

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const VS = '︎'; // text presentation, keeps glyphs from turning into emoji

// id = Swiss Ephemeris body number; orb = school orb; body = sends aspects
const POINTS = [
  { key: 'Sun', id: 0, glyph: '☉', orb: 13, body: true },
  { key: 'Moon', id: 1, glyph: '☽', orb: 11, body: true },
  { key: 'Mercury', id: 2, glyph: '☿', orb: 9, body: true },
  { key: 'Venus', id: 3, glyph: '♀', orb: 9, body: true },
  { key: 'Mars', id: 4, glyph: '♂', orb: 8, body: true },
  { key: 'Jupiter', id: 5, glyph: '♃', orb: 7, body: true },
  { key: 'Saturn', id: 6, glyph: '♄', orb: 6, body: true },
  { key: 'Uranus', id: 7, glyph: '♅', orb: 4, body: true },
  { key: 'Neptune', id: 8, glyph: '♆', orb: 4, body: true },
  { key: 'Pluto', id: 9, glyph: '♇', orb: 3, body: true },
  { key: 'Chiron', id: 15, glyph: '⚷', orb: 4, body: true },
  { key: 'North Node', id: 11, glyph: '☊', orb: null, body: false },
];

const ASPECTS = [
  { name: 'conjunction', angle: 0, glyph: '☌', kind: 'major', hard: true },
  { name: 'sextile', angle: 60, glyph: '⚹', kind: 'minor', hard: false },
  { name: 'square', angle: 90, glyph: '□', kind: 'major', hard: true },
  { name: 'trine', angle: 120, glyph: '△', kind: 'major', hard: false },
  { name: 'opposition', angle: 180, glyph: '☍', kind: 'major', hard: true },
];

const $ = (sel, root = document) => root.querySelector(sel);
const norm360 = x => ((x % 360) + 360) % 360;
const signOf = lon => Math.floor(norm360(lon) / 30);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDeg(lon) {
  const l = norm360(lon);
  let d = Math.floor(l % 30);
  let m = Math.round((l % 1) * 60);
  if (m === 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}′`;
}
function fmtOrb(x) {
  const d = Math.floor(x);
  const m = Math.round((x - d) * 60);
  return m === 60 ? `${d + 1}°00′` : `${d}°${String(m).padStart(2, '0')}′`;
}

// ---------- Swiss Ephemeris (loaded once, on demand) ----------
let swePromise = null;
function getSwe() {
  if (!swePromise) {
    swePromise = (async () => {
      const swe = new SwissEph();
      await swe.initSwissEph();
      return swe;
    })();
  }
  return swePromise;
}

// ---------- Time zones (IANA history via the browser's Intl data) ----------
function tzOffsetMinutes(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

// Local wall-clock time in a zone -> UTC. Returns offset used and a flag for DST gaps/overlaps.
function localToUtc(y, mo, d, h, mi, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let off = tzOffsetMinutes(wall, tz);
  let utc = wall - off * 60000;
  const off2 = tzOffsetMinutes(utc, tz);
  let note = '';
  if (off2 !== off) {
    utc = wall - off2 * 60000;
    if (tzOffsetMinutes(utc, tz) !== off2) note = 'gap';
    off = off2;
  } else {
    // overlap check: same wall time one hour later in UTC with a different offset
    const alt = tzOffsetMinutes(utc + 3600000, tz);
    if (alt !== off && wall - alt * 60000 === utc + 3600000) note = 'overlap';
  }
  return { utc, offset: off, note };
}

function fmtOffset(min) {
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

// ---------- Chart calculation ----------
async function calculateChart({ y, mo, d, h, mi, place, timeKnown, offsetOverride }) {
  const swe = await getSwe();
  let offset, utc, note = '';
  if (offsetOverride !== null) {
    offset = offsetOverride;
    utc = Date.UTC(y, mo - 1, d, h, mi) - offset * 60000;
  } else {
    ({ utc, offset, note } = localToUtc(y, mo, d, h, mi, place.tz));
  }
  const u = new Date(utc);
  const hourUT = u.getUTCHours() + u.getUTCMinutes() / 60 + u.getUTCSeconds() / 3600;
  const jd = swe.julday(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), hourUT);
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;

  const planets = POINTS.map(p => {
    const r = swe.calc_ut(jd, p.id, flags);
    return { ...p, lon: norm360(r[0]), speed: r[3] };
  });

  let houses = null;
  let angles = null;
  let houseSystem = 'Placidus';
  if (timeKnown) {
    let hs = swe.houses(jd, place.lat, place.lon, 'P');
    const bad = !hs || !isFinite(hs.cusps[1]) || Math.abs(place.lat) > 66;
    if (bad) { hs = swe.houses(jd, place.lat, place.lon, 'O'); houseSystem = 'Porphyry (Placidus is undefined this far north or south)'; }
    houses = Array.from(hs.cusps).slice(1, 13).map(norm360);
    angles = { asc: norm360(hs.ascmc[0]), mc: norm360(hs.ascmc[1]) };
    for (const p of planets) p.house = houseOf(p.lon, houses);
  }

  // Moon range for unknown birth time: first and last minute of the local day
  let moonRange = null;
  let sunRange = null;
  if (!timeKnown) {
    const a = offsetOverride !== null ? Date.UTC(y, mo - 1, d, 0, 0) - offsetOverride * 60000 : localToUtc(y, mo, d, 0, 0, place.tz).utc;
    const b = offsetOverride !== null ? Date.UTC(y, mo - 1, d, 23, 59) - offsetOverride * 60000 : localToUtc(y, mo, d, 23, 59, place.tz).utc;
    const at = (ms, body) => { const t = new Date(ms); return norm360(swe.calc_ut(swe.julday(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours() + t.getUTCMinutes() / 60), body, flags)[0]); };
    moonRange = [at(a, 1), at(b, 1)];
    sunRange = [at(a, 0), at(b, 0)];
  }

  return { planets, houses, angles, houseSystem, offset, note, jd, timeKnown, moonRange, sunRange, aspects: findAspects(planets, angles, timeKnown) };
}

function houseOf(lon, cusps) {
  for (let i = 0; i < 12; i++) {
    const a = cusps[i];
    const b = cusps[(i + 1) % 12];
    const span = norm360(b - a);
    if (norm360(lon - a) < span) return i + 1;
  }
  return 12;
}

// Aspects after the school's rules:
// O1 majors (A+B)/2 · O2 sextile (A+B)/4 · A11 node fixed 8 / 5 · A9 dissociated only up to 3°
// O4 conjunction/opposition to the axes asymmetric · other aspects to AC (10) and MC (9) by formula
// Sensitive points (AC, MC, node) receive only, never aspect each other.
function findAspects(planets, angles, timeKnown) {
  const out = [];
  const pts = planets;
  const add = (a, b, asp, orbUsed, allowed) => out.push({ a, b, asp, orb: orbUsed, allowed });

  const signDist = (l1, l2) => { const s = Math.abs(signOf(l1) - signOf(l2)); return Math.min(s, 12 - s); };
  const expectedSigns = { 0: 0, 60: 2, 90: 3, 120: 4, 180: 6 };

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const A = pts[i];
      const B = pts[j];
      if (!A.body && !B.body) continue;
      const sep = Math.abs(((A.lon - B.lon + 540) % 360) - 180);
      for (const asp of ASPECTS) {
        let allowed;
        if (!A.body || !B.body) allowed = (asp.angle === 60 || asp.angle === 120) ? 5 : 8; // node
        else allowed = asp.kind === 'major' ? (A.orb + B.orb) / 2 : (A.orb + B.orb) / 4;
        const orb = Math.abs(sep - asp.angle);
        if (orb > allowed) continue;
        const dissociated = signDist(A.lon, B.lon) !== expectedSigns[asp.angle];
        if (dissociated && A.body && B.body && orb > 3) continue;
        add(A, B, asp, orb, allowed);
      }
    }
  }

  if (angles) {
    const axes = [
      { key: 'AC', lon: angles.asc, orb: 10, conj: [3, 6], opp: [3, 3] },
      { key: 'MC', lon: angles.mc, orb: 9, conj: [3, 6], opp: [2, 3] },
    ];
    for (const ax of axes) {
      for (const p of pts) {
        if (!p.body) continue;
        const diff = ((p.lon - ax.lon + 540) % 360) - 180; // planet relative to axis, negative = before
        const oppDiff = ((p.lon - (ax.lon + 180) + 540) % 360) - 180;
        if (diff >= -ax.conj[0] && diff <= ax.conj[1]) add(p, { key: ax.key, glyph: ax.key, lon: ax.lon, axis: true }, ASPECTS[0], Math.abs(diff), diff < 0 ? ax.conj[0] : ax.conj[1]);
        else if (oppDiff >= -ax.opp[0] && oppDiff <= ax.opp[1]) add(p, { key: ax.key, glyph: ax.key, lon: ax.lon, axis: true }, ASPECTS[4], Math.abs(oppDiff), oppDiff < 0 ? ax.opp[0] : ax.opp[1]);
        const sep = Math.abs(diff);
        for (const asp of ASPECTS) {
          if (asp.angle === 0 || asp.angle === 180) continue;
          const allowed = asp.kind === 'major' ? (p.orb + ax.orb) / 2 : (p.orb + ax.orb) / 4;
          const orb = Math.abs(sep - asp.angle);
          if (orb > allowed) continue;
          if (signDist(p.lon, ax.lon) !== expectedSigns[asp.angle] && orb > 3) continue;
          add(p, { key: ax.key, glyph: ax.key, lon: ax.lon, axis: true }, asp, orb, allowed);
        }
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

// ---------- Chart wheel (SVG) ----------
function wheelSvg(chart) {
  const size = 600;
  const c = size / 2;
  const R = { outer: 292, zodiacIn: 246, planet: 214, houseNum: 160, houseIn: 146, aspect: 146 };
  const rot = chart.angles ? chart.angles.asc : 0; // AC on the left
  const pos = (lon, r) => {
    const a = (180 + (lon - rot)) * Math.PI / 180;
    return [c + r * Math.cos(a), c - r * Math.sin(a)];
  };
  const parts = [];
  parts.push(`<circle cx="${c}" cy="${c}" r="${R.outer}" class="w-line"/>`);
  parts.push(`<circle cx="${c}" cy="${c}" r="${R.zodiacIn}" class="w-line"/>`);
  parts.push(`<circle cx="${c}" cy="${c}" r="${R.zodiacIn - 5}" class="w-line w-faint"/>`); // double line as on the reading PDF wheel
  parts.push(`<circle cx="${c}" cy="${c}" r="${R.houseIn}" class="w-line w-faint"/>`);

  for (let s = 0; s < 12; s++) {
    const [x1, y1] = pos(s * 30, R.zodiacIn);
    const [x2, y2] = pos(s * 30, R.outer);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="w-line"/>`);
    for (let t = 5; t < 30; t += 5) {
      const [a1, b1] = pos(s * 30 + t, R.zodiacIn);
      const [a2, b2] = pos(s * 30 + t, R.zodiacIn + (t % 10 === 0 ? 8 : 5));
      parts.push(`<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b2}" class="w-line w-faint"/>`);
    }
    const [gx, gy] = pos(s * 30 + 15, (R.outer + R.zodiacIn) / 2);
    parts.push(`<path transform="translate(${gx} ${gy}) scale(1.15)" class="w-sign" d="${ZODIAC_PATHS[s]}"><title>${SIGNS[s]}</title></path>`);
  }

  if (chart.houses) {
    chart.houses.forEach((cusp, i) => {
      const axis = i === 0 || i === 3 || i === 6 || i === 9;
      const [x1, y1] = pos(cusp, R.houseIn);
      const [x2, y2] = pos(cusp, axis ? R.outer : R.zodiacIn);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${axis ? 'w-axis' : 'w-line w-faint'}"/>`);
      const next = chart.houses[(i + 1) % 12];
      const mid = cusp + norm360(next - cusp) / 2;
      const [nx, ny] = pos(mid, R.houseNum);
      parts.push(`<text x="${nx}" y="${ny}" class="w-house" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`);
    });
    const lab = (lon, t) => { const [x, y] = pos(lon, R.outer + 16); return `<text x="${x}" y="${y}" class="w-axislabel" text-anchor="${Math.abs(x - c) < 20 ? 'middle' : x < c ? 'end' : 'start'}" dominant-baseline="central">${t}</text>`; };
    parts.push(lab(chart.angles.asc, 'AC'), lab(chart.angles.mc, 'MC'));
  }

  // aspect lines, also to AC and MC (Sandra, 02.10.2026: what the list shows, the wheel draws); conjunctions have no line
  for (const a of chart.aspects) {
    if (a.asp.angle === 0) continue;
    const [x1, y1] = pos(a.a.lon, R.aspect);
    const [x2, y2] = pos(a.b.lon, R.aspect);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${a.asp.hard ? 'w-hard' : 'w-soft'}"/>`);
  }

  // planets with simple collision spreading
  const sorted = [...chart.planets].sort((p, q) => p.lon - q.lon);
  const disp = sorted.map(p => ({ p, d: p.lon }));
  const minGap = 8.5;
  for (let pass = 0; pass < 30; pass++) {
    for (let i = 0; i < disp.length; i++) {
      const cur = disp[i];
      const nxt = disp[(i + 1) % disp.length];
      const gap = norm360(nxt.d - cur.d);
      if (gap < minGap && disp.length > 1) {
        const push = (minGap - gap) / 2;
        cur.d = norm360(cur.d - push);
        nxt.d = norm360(nxt.d + push);
      }
    }
  }
  for (const { p, d } of disp) {
    const [tx, ty] = pos(p.lon, R.zodiacIn);
    const [tx2, ty2] = pos(p.lon, R.zodiacIn - 7);
    parts.push(`<line x1="${tx}" y1="${ty}" x2="${tx2}" y2="${ty2}" class="w-tick"/>`);
    const [gx, gy] = pos(d, R.planet);
    const retro = p.speed < 0 && p.key !== 'North Node' ? '<tspan class="w-retro" dx="1" dy="-7">r</tspan>' : '';
    parts.push(`<text x="${gx}" y="${gy}" class="w-planet" text-anchor="middle" dominant-baseline="central"><title>${esc(p.key)} ${fmtDeg(p.lon)} ${SIGNS[signOf(p.lon)]}</title>${p.glyph}${VS}${retro}</text>`);
  }

  return `<svg viewBox="-40 -20 ${size + 80} ${size + 40}" role="img" aria-label="Birth chart wheel" class="wheel">${parts.join('')}</svg>`;
}

// ---------- Degree texts (one file per sign, loaded on demand) ----------
// Sabian degree: drop the minutes, add 1 (0°00'–0°59' = degree 1).
const sabianDegree = lon => Math.floor(norm360(lon) % 30) + 1;
const degreeCache = {};
async function degreeText(sign, degree, role) {
  const key = sign.toLowerCase();
  if (!(key in degreeCache)) {
    degreeCache[key] = await import(`./degrees/${key}.js`).then(m => m.default).catch(() => null);
  }
  return degreeCache[key]?.[degree]?.[role] ?? null;
}

// ---------- This week's transits to the Sun (one file per week, built by tools/build-transits.py) ----------
// Same rules as the weekly transit posts: major aspects without orb, whole-sign houses from 0° of the Sun sign,
// weeks run Monday to Sunday in German time. No file for the week, no block.
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ordinal = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

function berlinMonday(nowMs = Date.now()) {
  const local = nowMs + tzOffsetMinutes(nowMs, 'Europe/Berlin') * 60000; // Berlin wall clock as if UTC
  const d = new Date(local);
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

async function loadTransitWeek(monday) {
  try {
    const res = await fetch(new URL(`../data/transits/${monday}.json`, import.meta.url));
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const dayOf = s => (new Date(s.slice(0, 10) + 'T00:00:00Z').getUTCDay() + 6) % 7;
function whenLabel(hit) {
  if (hit.whole) return 'ALL WEEK';
  const a = dayOf(hit.spans[0].from);
  const b = dayOf(hit.spans[hit.spans.length - 1].to);
  return a === b ? WEEKDAYS[a] : `${WEEKDAYS[a]}–${WEEKDAYS[b]}`;
}

function weekLabel(data) {
  const [, m1, d1] = data.week.split('-').map(Number);
  const [, m2, d2] = data.until.split('-').map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1}–${MONTHS[m2 - 1]} ${d2}`;
}

// Houses here are counted from the Sun sign, like the transit posts (no birth time there). With a birth time,
// the chart's own house of the transiting planet is named underneath, so the two never contradict silently
// (Sandra, 04.10.2026: Saturn showed "4th house" here while her chart below has it in the 10th).
function realHouseLine(planet, lon, sunSignHouse, cusps) {
  if (!cusps) return '';
  const real = houseOf(lon, cusps);
  return `<p class="fine tr-real">${real === sunSignHouse
    ? `In your full chart, ${planet} moves through your ${ordinal(real)} house too.`
    : `In your full chart, ${planet} moves through your ${ordinal(real)} house. That's the house the strips read.`}</p>`;
}

function weekBody(data, sunLon, cusps) {
  const deg = Math.floor(norm360(sunLon));
  const hits = data.hits[String(deg)] || [];
  let body;
  if (hits.length) {
    body = `<ul class="transit-list">${hits.map(h => {
      const text = data.texts[h.key];
      return `<li>
        <p class="tr-head"><span class="tr-label">${h.planet.toUpperCase()} · ${h.aspect.toUpperCase()} · FROM THE ${ordinal(h.house).toUpperCase()} HOUSE OF YOUR SUN SIGN</span><span class="tr-when">${whenLabel(h)}</span></p>
        ${text ? `<p class="tr-text">${esc(text)}</p>` : ''}
        ${realHouseLine(h.planet, h.deg + 0.5, h.house, cusps)}
      </li>`;
    }).join('')}</ul>`;
  } else {
    // quiet week: only the houses the slow planets move through, as background
    const sunSign = signOf(sunLon);
    const bg = data.planets.filter(p => !p.fast).map(p => {
      const house = (Math.floor(p.stays[0].deg / 30) - sunSign + 12) % 12 + 1;
      return `<li><p class="tr-head"><span class="tr-label">${p.planet.toUpperCase()} · IN THE ${ordinal(house).toUpperCase()} HOUSE OF YOUR SUN SIGN</span></p>
        ${realHouseLine(p.planet, p.stays[0].deg + 0.5, house, cusps)}</li>`;
    }).join('');
    body = `<p class="tr-quiet">A quieter week for your degree. Nothing hits it exactly; the slow planets set the background.</p>
      <ul class="transit-list">${bg}</ul>`;
  }
  return body;
}

// From Friday on, next week's file is shown too: the weekend transit posts read the coming week
// (Sandra, 04.10.2026), and the calculator should match what the post says.
async function transitBlock(sunLon, cusps = null, nowMs = Date.now()) {
  const monday = berlinMonday(nowMs);
  const local = new Date(nowMs + tzOffsetMinutes(nowMs, 'Europe/Berlin') * 60000);
  const weekend = (local.getUTCDay() + 6) % 7 >= 4; // Friday, Saturday, Sunday
  const nextMonday = new Date(Date.parse(monday + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  const [now, next] = await Promise.all([loadTransitWeek(monday), weekend ? loadTransitWeek(nextMonday) : null]);
  if (!now && !next) return '';
  const deg = Math.floor(norm360(sunLon));
  const sign = SIGNS[signOf(sunLon)];
  const section = (data, kicker) => `<p class="kicker">${kicker} · ${weekLabel(data)}</p>${weekBody(data, sunLon, cusps)}`;
  return `<div class="transits">
    <h3 class="sub-title">What moves your Sun on ${sign} ${deg % 30 + 1}</h3>
    ${now ? section(now, 'YOUR WEEK') : ''}
    ${next ? section(next, 'NEXT WEEK') : ''}
    <p class="tr-more">This is your Sun only. Transits to your Moon, your Rising or the other planets can stir up just as much, sometimes more. The Maxi Strip reads your birth chart as it is; the Ultra Strip adds what moves it now: your coming transits, read against your whole chart.</p>
    <a class="card-lock-link" href="#strips">SEE THE ULTRA STRIP</a>
    <p class="fine">Transits to your Sun only, without orbs: just what hits your exact degree. Houses here are counted from 0° of your Sun sign, as in a Sun-sign horoscope; ${cusps ? 'your own houses from your birth time are named under each transit and in the table below' : 'your own houses need a birth time'}. Week from Monday to Sunday, German time.</p>
  </div>`;
}

// ---------- Rendering ----------
// Free calculator (Sandra, 02.10.2026): every card keeps its sign text; only the Sun gets its degree text.
// Rising and Moon show their degree with a pointer to the strips. Their degree texts are not in the public files.
async function bigThreeCard(role, lon, { degreeKnown = true, extra = '', locked = false } = {}) {
  const sign = SIGNS[signOf(lon)];
  const deg = sabianDegree(lon);
  const [head, body] = TEXTS[sign][role];
  const r = ROLES[role];
  if (locked) {
    return `<article class="card card-locked">
    <p class="card-role">${r.role}</p>
    <h3 class="card-title">${r.label} IN ${sign.toUpperCase()}</h3>
    <p class="card-head">${esc(head)}</p>
    <p class="card-body card-sign">${esc(body)}</p>
    <div class="card-degree">
    ${degreeKnown ? `<p class="card-degree-label">YOUR DEGREE · ${sign.toUpperCase()} ${deg}</p>` : ''}
    <p class="card-body card-lock-text">For a precise reading of ${degreeKnown ? 'this degree' : `your ${r.label.charAt(0) + r.label.slice(1).toLowerCase()}`}, including how it fits into your whole chart, see the strips.</p>
    <a class="card-lock-link" href="#strips">SEE THE STRIPS</a>
    </div>
    ${extra}
  </article>`;
  }
  const dt = degreeKnown ? await degreeText(sign, deg, role) : null;
  // IN REAL LIFE line: Sun only, shown once a sign has it (Sandra, 02.10.2026).
  const life = degreeKnown && dt && role === 'sun' ? await degreeText(sign, deg, 'life') : null;
  let degreeBlock = '';
  if (degreeKnown) {
    degreeBlock = `<div class="card-degree">
      <p class="card-degree-label">YOUR DEGREE · ${sign.toUpperCase()} ${deg}</p>
      <p class="card-body">${dt ? esc(dt) : 'For a precise reading of this degree, including how it fits into your whole chart, see the <a href="#strips">strips</a>.'}</p>
      ${life ? `<p class="card-life-label">IN REAL LIFE</p>
      <p class="card-life">${esc(life)}</p>` : ''}
    </div>`;
  }
  return `<article class="card">
    <p class="card-role">${r.role}</p>
    <h3 class="card-title">${r.label} IN ${sign.toUpperCase()}</h3>
    <p class="card-head">${esc(head)}</p>
    <p class="card-body card-sign">${esc(body)}</p>
    ${degreeBlock}${extra}
  </article>`;
}

async function renderResult(chart, input) {
  const sun = chart.planets.find(p => p.key === 'Sun');
  const moon = chart.planets.find(p => p.key === 'Moon');
  const cards = [];
  if (chart.angles) cards.push(await bigThreeCard('rising', chart.angles.asc, { locked: true }));
  let sunOpts = {};
  if (chart.sunRange) {
    const [s0, s1] = chart.sunRange;
    if (signOf(s0) !== signOf(s1) || sabianDegree(s0) !== sabianDegree(s1)) {
      const from = `${SIGNS[signOf(s0)]} ${sabianDegree(s0)}`;
      const to = `${SIGNS[signOf(s1)]} ${sabianDegree(s1)}`;
      sunOpts = { extra: `<p class="card-note">Without a birth time your Sun could be on ${from} or ${to}. The reading above is for noon; your birth time decides which one is yours.</p>` };
    }
  }
  cards.push(await bigThreeCard('sun', sun.lon, sunOpts));
  let moonOpts = {};
  if (chart.moonRange) {
    const changed = signOf(chart.moonRange[0]) !== signOf(chart.moonRange[1]);
    moonOpts = {
      locked: true,
      degreeKnown: false,
      extra: `<p class="card-note">${changed
        ? `Without a birth time this is uncertain: on that day the Moon moved from ${SIGNS[signOf(chart.moonRange[0])]} into ${SIGNS[signOf(chart.moonRange[1])]}.`
        : 'The Moon moves about 13 degrees a day, so without a birth time its exact degree, and with it the deeper reading, stays open.'}</p>`,
    };
  }
  cards.push(await bigThreeCard('moon', moon.lon, { locked: true, ...moonOpts }));
  const transits = await transitBlock(sun.lon, chart.houses).catch(() => '');

  const rows = chart.planets.map(p => `<tr>
      <td><span class="glyph">${p.glyph}${VS}</span>${esc(p.key)}</td>
      <td>${signIcon(signOf(p.lon))} ${SIGNS[signOf(p.lon)]}</td>
      <td class="num">${fmtDeg(p.lon)}${p.speed < 0 && p.key !== 'North Node' ? ' <span class="retro" title="retrograde">R</span>' : ''}</td>
      ${chart.houses ? `<td class="num">${p.house}</td>` : ''}
    </tr>`).join('');
  const angleRows = chart.angles ? ['asc', 'mc'].map(k => `<tr>
      <td><span class="glyph glyph-txt">${k === 'asc' ? 'AC' : 'MC'}</span>${k === 'asc' ? 'Ascendant' : 'Midheaven'}</td>
      <td>${signIcon(signOf(chart.angles[k]))} ${SIGNS[signOf(chart.angles[k])]}</td>
      <td class="num">${fmtDeg(chart.angles[k])}</td><td class="num">${k === 'asc' ? 1 : 10}</td></tr>`).join('') : '';

  const aspectRows = chart.aspects.map(a => `<li>
      <span class="asp-pair">${esc(a.a.key)} <span class="glyph">${a.asp.glyph}${VS}</span> ${esc(a.b.key)}</span>
      <span class="asp-name">${a.asp.name}</span>
      <span class="asp-orb">${fmtOrb(a.orb)}</span></li>`).join('');

  const placeLine = `${input.place.name}${input.place.region ? ', ' + input.place.region : ''}, ${input.place.country}`;
  const dateLine = new Date(Date.UTC(input.y, input.mo - 1, input.d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const timeLine = chart.timeKnown ? `${String(input.h).padStart(2, '0')}:${String(input.mi).padStart(2, '0')}` : 'time unknown';
  let tzNote = `${fmtOffset(chart.offset)}${input.offsetOverride !== null ? ', set by you' : ''}`;
  if (chart.note === 'gap') tzNote += '. Careful: this clock time did not exist that night (clocks jumped forward). Please check your time.';
  if (chart.note === 'overlap') tzNote += '. Careful: this clock time happened twice that night (clocks went back). If you know it was the second one, set the time zone below manually.';

  $('#result').innerHTML = `
    <div class="result-head">
      <p class="kicker">YOUR CHART</p>
      <h2 class="section-title">Stripped down.</h2>
      <p class="meta">${esc(dateLine)} · ${esc(timeLine)} · ${esc(placeLine)} · <span class="nowrap">${esc(tzNote)}</span></p>
    </div>
    ${chart.timeKnown ? '' : '<p class="notice">No birth time, no Rising and no houses. The chart is set for noon. The planets almost always stay in their signs, but their exact degrees can shift, and the Moon can move by up to seven degrees either way.</p>'}
    <div class="big-three">${cards.join('')}</div>
    ${transits}
    <div class="chart-grid">
      <figure class="wheel-wrap">${wheelSvg(chart)}</figure>
      <div class="tables">
        <table class="positions">
          <thead><tr><th>Point</th><th>Sign</th><th class="num">Degree</th>${chart.houses ? '<th class="num">House</th>' : ''}</tr></thead>
          <tbody>${angleRows}${rows}</tbody>
        </table>
        <p class="fine">Tropical zodiac · ${chart.houses ? esc(chart.houseSystem) + ' houses · ' : ''}true node · R = retrograde</p>
        ${chart.houses ? '<p class="fine">The Rising moves one degree about every four minutes. If your birth time is rounded, your Rising degree may differ by one.</p>' : ''}
      </div>
    </div>
    <div class="aspects">
      <h3 class="sub-title">Aspects</h3>
      <p class="fine">Major aspects with the orbs of our school. Sorted from tightest to widest: the tighter, the louder.</p>
      <ul class="aspect-list">${aspectRows || '<li>No major aspects within orb.</li>'}</ul>
    </div>
    <div class="teaser">
      <p class="teaser-line">This is the outline.</p>
      <p class="teaser-sub">A strip reads how it all works together.</p>
      <a class="btn" href="#strips">SEE THE STRIPS</a>
    </div>`;
  $('#result').hidden = false;
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Form ----------
function initForm() {
  const form = $('#chart-form');
  const placeInput = $('#place');
  const list = $('#place-list');
  const unknown = $('#time-unknown');
  const time = $('#time');
  const tzSelect = $('#tz-override');
  const status = $('#form-status');
  const getPlace = attachPlaceSearch(placeInput, list, () => { status.textContent = 'The place list could not be loaded. Please reload the page.'; });

  for (let m = -12 * 60; m <= 14 * 60; m += 15) {
    if (m % 60 !== 0 && ![-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765, 825].includes(m) && m % 30 !== 0) continue;
    const o = document.createElement('option');
    o.value = m; o.textContent = fmtOffset(m);
    tzSelect.appendChild(o);
  }

  const warm = () => { getSwe().catch(() => {}); };
  placeInput.addEventListener('focus', warm, { once: true });
  $('#date').addEventListener('focus', warm, { once: true });

  unknown.addEventListener('change', () => { time.disabled = unknown.checked; time.required = !unknown.checked; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.textContent = '';
    const dateVal = $('#date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) { status.textContent = 'Please enter your date of birth.'; return; }
    const [y, mo, d] = dateVal.split('-').map(Number);
    if (y < 1900 || y > 2100) { status.textContent = 'Please enter a year between 1900 and 2100.'; return; }
    const timeKnown = !unknown.checked;
    let h = 12, mi = 0;
    if (timeKnown) {
      if (!/^\d{2}:\d{2}/.test(time.value)) { status.textContent = 'Please enter your birth time, or tick “I don’t know”.'; return; }
      [h, mi] = time.value.split(':').map(Number);
    }
    const chosen = await getPlace();
    if (!chosen) { status.textContent = 'Please choose your birth place from the list.'; return; }
    const offsetOverride = tzSelect.value === 'auto' ? null : Number(tzSelect.value);
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'CALCULATING…';
    try {
      const input = { y, mo, d, h, mi, place: chosen, timeKnown, offsetOverride };
      const chart = await calculateChart(input);
      await renderResult(chart, input);
    } catch (err) {
      console.error(err);
      status.textContent = 'Something went wrong with the calculation. Please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'STRIP MY CHART';
    }
  });
}

initForm();
