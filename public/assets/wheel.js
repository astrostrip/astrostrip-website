// Decorative zodiac wheel, after the Starter Kit cover (Canva) but astrologically correct
// (Sandra, 02.10.2026): 0 deg Aries on the left (Ascendant), signs counterclockwise,
// spokes exactly on the sign boundaries. Same geometry as the reading PDF (tools/reading-pdf/build.py).
// Rings from outside: sign names on the arc, sign glyphs, rulers, star ornament.
// Colours come from CSS classes (.zw-*), so the wheel works on black and on the cream "paper" sections.
import { ZODIAC_PATHS } from './zodiac.js';

// Planets in the same line style as the sign glyphs, each in a 20 x 20 box around 0,0
export const PLANET_PATHS = {
  sun: 'M0,0 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0 M0,0 m-1,0 a1,1 0 1,0 2,0 a1,1 0 1,0 -2,0',
  moon: 'M2.5,-7.6 A8,8 0 1,0 2.5,7.6 A6.4,6.4 0 1,1 2.5,-7.6',
  mercury: 'M-4,-9.5 A4,4 0 0,0 4,-9.5 M0,-2.5 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M0,1.5 L0,9.5 M-3,6 L3,6',
  venus: 'M0,-3.5 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0 M0,1.5 L0,9.5 M-3.5,5.8 L3.5,5.8',
  mars: 'M-2.5,2.5 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0 M1,-1 L7.5,-7.5 M2.5,-7.5 L7.5,-7.5 L7.5,-2.5',
  jupiter: 'M-6,-5 C-4,-9 2,-7 -1,-2 C-2.5,0.5 -4.5,2 -6,3 L7,3 M3.5,-8 L3.5,9',
  saturn: 'M-3,-9 L-3,7 M-6,-6 L0,-6 M-3,-0.5 C0,-4 5.5,-3 4,1.5 C3,4 1,5.5 2.5,8.5',
  uranus: 'M-5,-9 L-5,-1 M5,-9 L5,-1 M-5,-5 L5,-5 M0,-9 L0,3 M0,6 m-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0',
  neptune: 'M-6.5,-8 C-6.5,-0.5 6.5,-0.5 6.5,-8 M0,-9.5 L0,9.5 M-3.5,5.5 L3.5,5.5',
  pluto: 'M-6,-8 A6,6 0 0,0 6,-8 M0,-8 m-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0 M0,-2 L0,9.5 M-3.5,5.5 L3.5,5.5',
};

// Rulers per sign; Scorpio, Aquarius, Pisces show both, traditional first (branddesign.md)
export const RULERS = [['mars'], ['venus'], ['mercury'], ['moon'], ['sun'], ['mercury'], ['venus'],
  ['mars', 'pluto'], ['jupiter'], ['saturn'], ['saturn', 'uranus'], ['jupiter', 'neptune']];

const NAMES = ['ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO', 'LIBRA', 'SCORPIO',
  'SAGITTARIUS', 'CAPRICORN', 'AQUARIUS', 'PISCES'];

const f = n => Math.round(n * 100) / 100;
const rad = d => d * Math.PI / 180;
// ecliptic longitude -> point; 0 deg Aries left, zodiac counterclockwise
const pt = (c, r, lon) => [f(c - r * Math.cos(rad(lon))), f(c + r * Math.sin(rad(lon)))];

// Average advance per capital letter in Playfair Display, in em (for spacing the letters on the arc)
const ADV = { I: .3, J: .38, L: .58, M: .86, W: .92, N: .74, O: .74, Q: .74, C: .66, G: .72, D: .74 };
const adv = ch => ADV[ch] ?? .64;

/**
 * SVG markup of the wheel (without the outer <svg> tag), centred in a box of `size`.
 * opts: r (outer radius), names, rulers, ornament (booleans), radii as fractions of r.
 */
export function wheelMarkup({ size = 400, r = 196, names = true, rulers = true, ornament = true,
  rNames = 0.885, rGlyph = 0.565, rPlan = 0.535, rCore = 0.335, glyphScale, nameSize, track = 0.12 } = {}) {
  const c = size / 2;
  const R = { names: r * rNames, glyph: r * rGlyph, plan: r * rPlan, core: r * rCore };
  const inner = rulers ? R.core : R.plan;
  const p = [];
  const circle = (rr, cls) => p.push(`<circle class="${cls}" cx="${c}" cy="${c}" r="${f(rr)}"/>`);
  circle(r, 'zw-line zw-strong');
  if (names) circle(R.names, 'zw-line');
  circle(R.glyph, 'zw-line');
  circle(R.plan, 'zw-line zw-faint');
  if (rulers) circle(R.core, 'zw-line');
  for (let i = 0; i < 12; i++) {
    const [x1, y1] = pt(c, r, i * 30);
    const [x2, y2] = pt(c, inner, i * 30);
    p.push(`<line class="zw-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  const outerGlyph = names ? R.names : r;
  const gs = glyphScale ?? (outerGlyph - R.glyph) / 26;
  for (let i = 0; i < 12; i++) {
    const [x, y] = pt(c, (outerGlyph + R.glyph) / 2, i * 30 + 15);
    p.push(`<path class="zw-sign" transform="translate(${x} ${y}) scale(${f(gs)})" d="${ZODIAC_PATHS[i]}"/>`);
    if (rulers) {
      const ps = (R.plan - R.core) / 38;
      RULERS[i].forEach((name, k, all) => {
        const off = all.length === 1 ? 0 : (k === 0 ? 7 : -7); // reading order clockwise: traditional first
        const [px, py] = pt(c, (R.plan + R.core) / 2, i * 30 + 15 + off);
        p.push(`<path class="zw-planet" transform="translate(${px} ${py}) scale(${f(ps)})" d="${PLANET_PATHS[name]}"/>`);
      });
    }
  }
  if (rulers && ornament) {
    const s = r * 0.1, star = [];
    for (let k = 0; k < 16; k++) {
      const a = rad(k * 22.5 - 90);
      const rr = k % 4 === 0 ? s : (k % 2 === 0 ? s * 0.45 : s * 0.12);
      star.push(`${f(c + rr * Math.cos(a))},${f(c + rr * Math.sin(a))}`);
    }
    p.push(`<polygon class="zw-fill" points="${star.join(' ')}"/>`);
    for (let k = 0; k < 24; k++) {
      const a = rad(k * 15), rr = R.core * (k % 2 === 0 ? 0.62 : 0.78);
      const x = c + rr * Math.cos(a), y = c + rr * Math.sin(a);
      if (k % 2 === 0) p.push(`<circle class="zw-dot" cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.009)}"/>`);
      else {
        const d = r * 0.02, e = r * 0.004;
        p.push(`<polygon class="zw-fill" points="${f(x)},${f(y - d)} ${f(x + e)},${f(y - e)} ${f(x + d * .6)},${f(y)} ${f(x + e)},${f(y + e)} ${f(x)},${f(y + d)} ${f(x - e)},${f(y + e)} ${f(x - d * .6)},${f(y)} ${f(x - e)},${f(y - e)}"/>`);
      }
    }
  }
  if (names) {
    // letters on the arc, tops outward, reading clockwise (like the Starter Kit wheel)
    const fs = nameSize ?? (r - R.names) * 0.42;
    const base = R.names + (r - R.names) * 0.3;
    const deg = len => len / base * 180 / Math.PI;
    p.push(`<g class="zw-name" font-size="${f(fs)}">`);
    NAMES.forEach((name, i) => {
      const widths = [...name].map(ch => adv(ch) * fs);
      const total = widths.reduce((a, b) => a + b, 0) + track * fs * (name.length - 1);
      let lon = i * 30 + 15 + deg(total / 2);
      [...name].forEach((ch, k) => {
        const mid = lon - deg(widths[k] / 2);
        const [x, y] = pt(c, base, mid);
        p.push(`<text x="${x}" y="${y}" text-anchor="middle" transform="rotate(${f(-(mid + 90))} ${x} ${y})">${ch}</text>`);
        lon -= deg(widths[k] + track * fs);
      });
    });
    p.push('</g>');
  }
  return p.join('');
}
