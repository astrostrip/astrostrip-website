// Replaces existing IN REAL LIFE lines in website/degrees-full/<sign>.js.
// Usage: node website/tools/set-life.mjs website/degrees-full/<sign>.js fixes.json   (fixes.json: {"4": "new line", ...})
// Aborts if a requested degree has no life line. Then run: node website/tools/build-public-degrees.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const [file, json] = process.argv.slice(2);
const upd = JSON.parse(readFileSync(json, 'utf8'));
const lines = readFileSync(file, 'utf8').split('\n');
let deg = null; const done = new Set();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^  (\d+): \{$/); if (m) deg = m[1];
  if (deg && upd[deg] && /^    life: /.test(lines[i])) { lines[i] = `    life: ${JSON.stringify(upd[deg])},`; done.add(deg); }
}
const want = Object.keys(upd);
if (want.some(k => !done.has(k))) throw new Error('missing ' + want.filter(k => !done.has(k)));
writeFileSync(file, lines.join('\n')); console.log(file, 'replaced', done.size);
