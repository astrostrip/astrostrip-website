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

  let lunation = null;
  try { lunation = progressedLunation(swe, jd); } catch (err) { console.error(err); }

  return { planets, houses, angles, houseSystem, offset, note, jd, timeKnown, moonRange, sunRange, lunation, aspects: findAspects(planets, angles, timeKnown) };
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
// Same rules as the weekly transit posts: major aspects, applying orbs inside the sign (Mercury, Venus, Mars 5°,
// Jupiter to Pluto and Chiron 1°, from the week of 12.10.2026), whole-sign houses from 0° of the Sun sign,
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
  const a = dayOf(hit.spans[0].from);
  const b = dayOf(hit.spans[hit.spans.length - 1].to);
  const range = hit.whole ? 'ALL WEEK' : a === b ? WEEKDAYS[a] : `${WEEKDAYS[a]}–${WEEKDAYS[b]}`;
  // the approach runs into the exact day; name it when the approach started earlier
  if (hit.exactFrom && hit.spans[0].from !== hit.exactFrom) return `${range} · EXACT ${WEEKDAYS[dayOf(hit.exactFrom)]}`;
  return range;
}
// Triggers (D24, L15 pp. 14-16; wording Sandra 06.10.2026): a fast planet on the same Sun degree makes a slow
// transit tangible. Mercury and Venus work the day before and the day they are exact, Mars about a week,
// a fast planet stationing in its orb for weeks. The fast planet is not named, like in the texts.
const DAYNAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function triggerLines(hit) {
  const lines = new Set();
  for (const t of hit.triggers || []) {
    if (t.station) lines.add('Lingers for weeks: a fast planet stands still on this degree.');
    else if (t.planet === 'Mars') lines.add(t.exactFrom
      ? `Building all week, likely most tangible around ${DAYNAMES[dayOf(t.exactFrom)]}.`
      : 'Building all week.');
    else if (t.exactFrom) {
      const d = dayOf(t.exactFrom);
      lines.add(`Likely most tangible on ${DAYNAMES[(d + 6) % 7]} and ${DAYNAMES[d]}.`);
    }
  }
  return [...lines].map(l => `<p class="fine tr-trigger">${l}</p>`).join('');
}
// Older week files have no status: every hit there is exact.
const STATUS_LABEL = { applying: ' · APPROACHING', separating: ' · PAST EXACT' };

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
        <p class="tr-head"><span class="tr-label">${h.planet.toUpperCase()} · ${h.aspect.toUpperCase()}${STATUS_LABEL[h.status] || ''} · FROM THE ${ordinal(h.house).toUpperCase()} HOUSE OF YOUR SUN SIGN</span><span class="tr-when">${whenLabel(h)}</span></p>
        ${text ? `<p class="tr-text">${esc(text)}</p>` : ''}
        ${triggerLines(h)}
        ${h.status === 'separating' ? '<p class="tr-text">Past exact, so what this contact stirred may now be in integration.</p>' : ''}
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
    body = `<p class="tr-quiet">A quieter week for your Sun degree. Nothing touches it; the slow planets set the background.</p>
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
  // applying orbs from the week of 12.10.2026 on (Sandra, 05.10.2026); older week files have no orbs
  const orb = [now, next].some(d => d && d.orbs);
  const section = (data, kicker) => `<p class="kicker">${kicker} · ${weekLabel(data)}</p>${weekBody(data, sunLon, cusps)}`;
  return `<div class="transits panel">
    <h3 class="sub-title">Your week, stripped down</h3>
    ${now ? section(now, `YOUR SUN ON ${sign.toUpperCase()} ${deg % 30 + 1}`) : ''}
    ${next ? section(next, 'NEXT WEEK') : ''}
    <p class="tr-more">This is your Sun only. Transits to your Moon, your Rising or the other planets can stir up just as much, sometimes more. The Maxi Strip reads your birth chart as it is; the Ultra Strip adds an overview of your coming transits. Coming soon to add to either one: Transit Weekly, your transits week by week in the life areas you choose.</p>
    <a class="card-lock-link" href="#strips">SEE THE STRIPS</a>
    <p class="fine">Transits to your Sun only. ${orb
      ? 'A transit counts while it approaches your degree, within your Sun sign: Mercury, Venus and Mars from 5° before exact, Jupiter, Saturn, Uranus, Neptune, Pluto and Chiron from 1° before. Once exact has passed, it drops out; a slow planet that is only past exact this week gets one line.'
      : 'Without orbs: just what hits your exact degree.'} Houses here are counted from 0° of your Sun sign, as in a Sun-sign horoscope; ${cusps ? 'your own houses from your birth time are named under each transit and in the table below' : 'your own houses need a birth time'}. Week from Monday to Sunday, German time.</p>
  </div>`;
}

// ---------- Progressed Moon phase (Sandra, 05.10.2026) ----------
// Secondary progressions, one day after birth = one tropical year. The progressed Moon meets the progressed Sun
// about every 29.5 years; the school teaches four phases of about 7.4 years (L17 pp. 23-24). Texts approved by Sandra.
const TROP_YEAR = 365.24219;
const LUNATION = [
  { label: 'NEW MOON PHASE', text: 'Something new is taking shape in you, often below the surface and before you can put it into words. You may not know yet where it\'s heading. You\'re also more open than usual to whatever wants to begin.' },
  { label: 'FIRST QUARTER', text: 'What started some years ago now wants to become real. This is a phase of pushing ahead and of running into resistance, around you or within you. Frustration is part of it when the new demands feel like a lot. What helps is acting on purpose and facing the obstacles instead of waiting them out.' },
  { label: 'FULL MOON PHASE', text: 'This is the high point of your current cycle: what you started years ago is showing its results. It can feel fulfilling, eye-opening, or like a crisis. Goals, relationships and the way you\'ve set up your life get a hard look. Sudden insights are likely, and so is a wobble when your past and your future no longer fit together.' },
  { label: 'LAST QUARTER', text: 'The direction that has carried you for years starts to matter less. This is a phase of looking back, reorganising things inside and letting go of old habits and ideas. The task now is to see clearly what you\'re ready to leave behind, so there\'s room for what comes next.' },
];

// Phase now, with the calendar years it began and ends (never a future year for the start). Same method as
// prog_lunation() in the /psychologisch calculator. start is null when the phase began before birth.
function progressedLunation(swe, jdBirth, nowMs = Date.now()) {
  const flags = swe.SEFLG_SWIEPH;
  const elong = t => norm360(swe.calc_ut(t, 1, flags)[0] - swe.calc_ut(t, 0, flags)[0]);
  const dev = (t, target) => ((elong(t) - target + 540) % 360) - 180; // rises through 0 at the crossing
  const crossing = (t0, target, dir) => {
    let a = t0;
    for (let i = 0; i < 200; i++) { // steps of half a progressed day (~6° of elongation)
      const b = a + 0.5 * dir;
      let [lo, hi] = dir < 0 ? [b, a] : [a, b];
      const dl = dev(lo, target), dh = dev(hi, target);
      if (dl < 0 && dh >= 0 && dh - dl < 90) {
        for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (dev(mid, target) < 0) lo = mid; else hi = mid; }
        return (lo + hi) / 2;
      }
      a = b;
    }
    return null;
  };
  const n = new Date(nowMs);
  const jdNow = swe.julday(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), n.getUTCHours() + n.getUTCMinutes() / 60);
  const pj = jdBirth + (jdNow - jdBirth) / TROP_YEAR;
  const e = elong(pj);
  const phase = Math.floor(e / 90);
  const start = crossing(pj, 90 * phase, -1);
  const end = crossing(pj, (90 * (phase + 1)) % 360, 1);
  // last progressed New Moon: where this cycle began (its house is read in the block, Sandra 06.10.2026)
  const newMoon = phase === 0 ? start : crossing(pj, 0, -1);
  // progressed moment -> calendar date -> its year
  const year = t => new Date((jdBirth + (t - jdBirth) * TROP_YEAR - 2440587.5) * 86400000).getUTCFullYear();
  return {
    phase, elong: e, start: start === null || start < jdBirth ? null : year(start), end: end === null ? null : year(end),
    newMoonYear: newMoon === null || newMoon < jdBirth ? null : year(newMoon),
    newMoonLon: newMoon === null ? null : norm360(swe.calc_ut(newMoon, 0, flags)[0]),
  };
}

// Life areas for the house of the last progressed New Moon (school keywords L1, wording table in
// reference/haeuser-psychologisch.md; approved by Sandra 06.10.2026)
const HOUSE_AREAS = [
  'how you come across and how you start things',
  'money, what you own and what you value',
  'contact, communication and learning',
  'home, family and your roots',
  'creativity, joy, play and romance',
  'everyday life, work routines and your rhythm',
  'partnership and one-to-one relationships',
  'deep bonds, crises and what you share with others',
  'meaning, beliefs, travel and further learning',
  'calling, status and your public role',
  'friends, groups and shared visions',
  'retreat, quiet and your inner world',
];

function newMoonLine(lu, cusps) {
  if (lu.newMoonLon === null) return '';
  const when = lu.newMoonYear === null ? 'before you were born' : `around ${lu.newMoonYear}`;
  if (!cusps) return `<p class="tr-text">This cycle began ${when} with your progressed New Moon.</p>`;
  const h = houseOf(lu.newMoonLon, cusps);
  return `<p class="tr-text">This cycle began ${when} with your progressed New Moon in your ${ordinal(h)} house: ${HOUSE_AREAS[h - 1]}.</p>`;
}

// The cycle as a circle: New Moon at the top, clockwise through the four phases; the arc of the current phase in gold,
// the dot where the progressed Moon stands now (elongation from the progressed Sun).
function lunationSvg(lu) {
  const c = 110, r = 78, m = 17;
  const at = (deg, rad = r) => [c + rad * Math.sin(deg * Math.PI / 180), c - rad * Math.cos(deg * Math.PI / 180)].map(v => +v.toFixed(2));
  const [ax, ay] = at(90 * lu.phase), [bx, by] = at(90 * (lu.phase + 1));
  const moon = (i) => {
    const [x, y] = at(90 * i);
    const lit = i === 1 ? `<path class="lu-lit" d="M${x},${y - m} A${m},${m} 0 0,1 ${x},${y + m} Z"/>`
      : i === 2 ? `<circle class="lu-lit" cx="${x}" cy="${y}" r="${m}"/>`
      : i === 3 ? `<path class="lu-lit" d="M${x},${y - m} A${m},${m} 0 0,0 ${x},${y + m} Z"/>` : '';
    return `<g class="lu-moon${i === lu.phase ? ' lu-moon-now' : ''}"><circle class="lu-disc" cx="${x}" cy="${y}" r="${m}"/>${lit}<circle class="lu-rim" cx="${x}" cy="${y}" r="${m}"/></g>`;
  };
  const [dx, dy] = at(lu.elong);
  return `<svg class="lu-wheel" viewBox="0 0 220 220" role="img" aria-label="The progressed lunation cycle: you are in the ${LUNATION[lu.phase].label.toLowerCase()}">
    <circle class="lu-ring" cx="${c}" cy="${c}" r="${r}"/>
    <path class="lu-arc" d="M${ax},${ay} A${r},${r} 0 0,1 ${bx},${by}"/>
    ${[0, 1, 2, 3].map(moon).join('')}
    <circle class="lu-dot" cx="${dx}" cy="${dy}" r="4.5"/>
    <text class="lu-center" x="${c}" y="${c - 4}" text-anchor="middle">ONE CYCLE</text>
    <text class="lu-center" x="${c}" y="${c + 12}" text-anchor="middle">≈ 29.5 YEARS</text>
  </svg>`;
}

// Explanation behind "What is the progressed Moon?": school L17 pp. 23-24 (lunation cycle ~29.5 years, four phases,
// sign and house of the progressed New Moon); "two or three cycles in a long life" is arithmetic, not a source claim.
// Layout and wording approved by Sandra 06.10.2026.
const LUNATION_SHORT = ['A new beginning, often below the surface.', 'Pushing ahead, meeting resistance.', 'Results, insight, or a crisis.', 'Looking back, letting go.'];

function lunationBlock(lu, timeKnown, cusps = null) {
  if (!lu || lu.end === null) return '';
  const L = LUNATION[lu.phase];
  const since = lu.start === null ? 'SINCE BIRTH' : `SINCE ABOUT ${lu.start}`;
  const frac = Math.min(1, Math.max(0, (lu.elong - 90 * lu.phase) / 90));
  return `<div class="lunation panel">
    <h3 class="sub-title">Your progressed Moon phase</h3>
    <p class="kicker">${L.label} · ${since} · UNTIL ABOUT ${lu.end}</p>
    <div class="lu-grid">
      ${lunationSvg(lu)}
      <div class="lu-body">
        ${lu.phase === 0 ? '<p class="lu-lead">A new chapter of your life has begun, and it often takes a while before its direction is clear.</p>' : ''}
        ${newMoonLine(lu, cusps)}
        <p class="tr-text">${esc(L.text)}</p>
        <div class="lu-time" aria-hidden="true">
          <div class="lu-bar"><span class="lu-fill" style="width:${(frac * 100).toFixed(1)}%"></span><span class="lu-now" style="left:${(frac * 100).toFixed(1)}%"><i>NOW</i></span></div>
          <div class="lu-years"><span>${lu.start === null ? 'BIRTH' : lu.start}</span><span>${lu.end}</span></div>
        </div>
      </div>
    </div>
    ${lu.phase === 3
      ? `<p class="tr-more">Your next progressed New Moon comes around ${lu.end} and opens a new cycle of about 30 years. Want to know what it holds for you? The Ultra Strip reads the sign and the area of your life where it falls, and where your current cycle began.</p>`
      : '<p class="tr-more">What is this chapter about for you, in detail? The Ultra Strip reads it in depth, including the sign, the different stages and the area of your life.</p>'}
    <a class="card-lock-link" href="#strips">SEE THE ULTRA STRIP</a>
    <details class="lu-info">
      <summary>What is the progressed Moon?</summary>
      <div class="lu-info-body">
        <p>Progressions are a slow clock in your birth chart: each day after your birth stands for one year of your life. In this clock the Moon moves fastest. About every 29.5 years it catches up with the Sun, and that meeting, the progressed New Moon, opens a new chapter of your life. From there the cycle runs like the Moon in the sky, through four phases of about seven years each.</p>
        <p>It doesn't name events. It shows the inner rhythm behind them: how what you want (your Sun) and what you need (your Moon) find each other over the years. When something new begins in you, when it pushes to become real, when it bears fruit, and when it's time to let go.</p>
        <ul class="lu-phases">${LUNATION.map((p, i) => `<li${i === lu.phase ? ' class="lu-phase-now"' : ''}><b>${p.label}</b><span>${LUNATION_SHORT[i]}${i === lu.phase ? ' <em>You are here.</em>' : ''}</span></li>`).join('')}</ul>
        <p>In a long life you go through two or three of these cycles. Where yours began, in which sign and in which area of your life, says what the current chapter is about.</p>
      </div>
    </details>
    <p class="fine">Calculated with secondary progressions.${timeKnown ? '' : ' Without a birth time the chart is set for noon, so the start and end of your phase can shift by up to half a year either way.'}</p>
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

  // table: only the eight tightest, in 4 rows x 2 columns; the wheel still draws every aspect (Sandra, 06.10.2026)
  const aspKey = k => k === 'North Node' ? '<span class="asp-long">North </span>Node' : esc(k); // "Node" on phones
  const aspectRows = chart.aspects.slice(0, 8).map(a => `<li>
      <span class="asp-pair">${aspKey(a.a.key)} <span class="glyph">${a.asp.glyph}${VS}</span> ${aspKey(a.b.key)}</span>
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
    ${lunationBlock(chart.lunation, chart.timeKnown, chart.houses)}
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
      <p class="fine">The eight tightest major aspects, with the orbs of our school: the tighter, the louder. The wheel draws all of them.</p>
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
