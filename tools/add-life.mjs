// Inserts IN REAL LIFE lines (field life) into website/degrees-full/<sign>.js after each moon line.
// Usage from the brain folder: node website/tools/add-life.mjs website/degrees-full/<sign>.js lines.json   (lines.json: {"1": "...", ..., "30": "..."})
// Aborts if a life line already exists or not exactly 30 were added. Then run: node website/tools/build-public-degrees.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const [file, json] = process.argv.slice(2);
const life = JSON.parse(readFileSync(json, 'utf8'));
const lines = readFileSync(file, 'utf8').split('\n');
let deg = null, added = 0;
const out = [];
for (const l of lines) {
  const m = l.match(/^  (\d+): \{$/); if (m) deg = m[1];
  if (/^\s+life:/.test(l)) throw new Error('life already present at ' + deg);
  out.push(l);
  if (deg && /^    moon: /.test(l)) { if (!life[deg]) throw new Error('no line for ' + deg); out.push(`    life: ${JSON.stringify(life[deg])},`); added++; deg = null; }
}
if (added !== 30) throw new Error('added ' + added);
writeFileSync(file, out.join('\n'));
console.log('added', added);
