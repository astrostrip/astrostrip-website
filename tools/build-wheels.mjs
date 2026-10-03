// Writes the decorative zodiac wheels into index.html as static SVG (no JavaScript needed to show them).
// Run from the brain folder:  node website/tools/build-wheels.mjs
// Only the part between <!-- wheel:NAME --> and <!-- /wheel:NAME --> is replaced; the file is re-read
// right before writing and the write is refused if it changed in between (parallel sessions).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { wheelMarkup } from '../public/assets/wheel.js';

const FILE = new URL('../public/index.html', import.meta.url);

// hero: only the outer rings, the centre stays free for the headline (Sandra, 02.10.2026: no type may touch the ring)
// strips: the full wheel with rulers and star, as on the reading PDF cover
const WHEELS = {
  hero: wheelMarkup({ size: 400, r: 196, rulers: false, ornament: false, rNames: 0.93, rGlyph: 0.82, rPlan: 0.805 }),
  strips: wheelMarkup({ size: 400, r: 196 }),
};

const hash = s => createHash('sha256').update(s).digest('hex');
const before = readFileSync(FILE, 'utf8');
let html = before;
for (const [name, markup] of Object.entries(WHEELS)) {
  const re = new RegExp(`(<!-- wheel:${name} -->)[\\s\\S]*?(<!-- /wheel:${name} -->)`);
  if (!re.test(html)) throw new Error(`marker wheel:${name} not found in index.html`);
  html = html.replace(re, `$1${markup}$2`);
}
if (hash(readFileSync(FILE, 'utf8')) !== hash(before)) throw new Error('index.html changed while building, run again');
writeFileSync(FILE, html);
console.log(`wheels written: ${Object.keys(WHEELS).join(', ')} (${html.length - before.length >= 0 ? '+' : ''}${html.length - before.length} bytes)`);
