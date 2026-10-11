// Transit Weekly price on the page (Sandra, 11.10.2026): founding price 29 € a month per area while places
// are left, then 39 €. The page shows only the places left. Static text = founding price; this script asks
// the worker and corrects the text (and tells order.js / transit-weekly.js via the event "twprice").
(() => {
  const eur = c => `${c / 100} €`;
  let data = null;
  function apply(root = document) {
    if (!data) return;
    for (const el of root.querySelectorAll('[data-tw-month]')) el.textContent = eur(data.monthCents);
    for (const el of root.querySelectorAll('[data-tw-term]')) el.textContent = eur(data.cents);
    for (const el of root.querySelectorAll('.tw-founding')) el.hidden = !data.founding;
    for (const el of root.querySelectorAll('[data-tw-left]')) {
      el.textContent = data.founding ? ` Only ${data.left} place${data.left === 1 ? '' : 's'} left.` : '';
      el.hidden = !data.founding;
    }
  }
  window.twApply = apply;
  fetch('/api/transit-price', { headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !d.cents) return;
      data = window.twPriceData = d;
      apply();
      dispatchEvent(new CustomEvent('twprice', { detail: d }));
    })
    .catch(() => { /* static founding text stays; the checkout shows the binding price */ });
})();
