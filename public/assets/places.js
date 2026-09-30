// Place search over the bundled GeoNames list (data/cities.js), loaded on demand.
// Runs entirely in the browser; nothing typed here is sent anywhere.

let places = null;
let placesPromise = null;

export const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');

export function loadPlaces() {
  if (placesPromise) return placesPromise;
  placesPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../data/cities.js', import.meta.url).href;
    s.onload = () => {
      const d = window.ASTRO_CITIES;
      places = d.rows.split('\n').map(line => {
        const [name, ascii, alts, region, c, lat, lon, tz, pop] = line.split('\t');
        const keys = [name, ascii, ...(alts ? alts.split('|') : [])].filter(Boolean).map(fold);
        return { name, region, country: d.c[+c], lat: +lat, lon: +lon, tz: d.tz[+tz], pop: +pop, keys };
      });
      delete window.ASTRO_CITIES;
      resolve(places);
    };
    s.onerror = () => { placesPromise = null; reject(new Error('Place list could not be loaded.')); };
    document.head.appendChild(s);
  });
  return placesPromise;
}

export function searchPlaces(q, limit = 8) {
  const f = fold(q.trim());
  if (!f || !places) return [];
  const starts = [];
  const contains = [];
  for (const p of places) {
    let hit = 0;
    for (const k of p.keys) {
      if (k.startsWith(f)) { hit = 2; break; }
      if (!hit && f.length >= 3 && k.includes(f)) hit = 1;
    }
    if (hit === 2) { starts.push(p); if (starts.length >= limit) break; }
    else if (hit === 1 && contains.length < limit) contains.push(p);
  }
  return starts.concat(contains).slice(0, limit); // list is sorted by population
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Wires an <input role=combobox> and its <ul role=listbox>. Returns a getter for the chosen place.
export function attachPlaceSearch(input, list, onError) {
  let chosen = null;
  let active = -1;
  let current = [];
  input.addEventListener('focus', () => { loadPlaces().catch(() => onError && onError()); }, { once: true });
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const show = () => {
    list.innerHTML = current.map((p, i) => `<li role="option" id="${list.id}-opt-${i}" class="${i === active ? 'active' : ''}" data-i="${i}">
      <span class="pl-name">${esc(p.name)}</span><span class="pl-sub">${esc([p.region, p.country].filter(Boolean).join(', '))}</span></li>`).join('');
    list.hidden = current.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-opt-${active}`);
  };
  const choose = i => { chosen = current[i]; input.value = `${chosen.name}, ${chosen.country}`; close(); };
  input.addEventListener('input', async () => {
    chosen = null;
    await loadPlaces().catch(() => null);
    current = searchPlaces(input.value);
    active = current.length ? 0 : -1;
    show();
  });
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, current.length - 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); show(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { choose(active); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { choose(+li.dataset.i); e.preventDefault(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  // Returns the chosen place, or the best match for what was typed.
  return async () => {
    if (chosen) return chosen;
    await loadPlaces().catch(() => null);
    const guess = searchPlaces(input.value, 1)[0];
    if (guess) { chosen = guess; input.value = `${guess.name}, ${guess.country}`; }
    return chosen;
  };
}
