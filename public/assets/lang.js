// Language switch EN/DE (Sandra, 18./19.10.2026). Loaded in the <head> of the pages that have a German version.
// 1. Remembers the visitor's own choice: a click on the EN/DE button stores "en" or "de" in the browser
//    (localStorage key "astrostrip-lang", nothing else; named in the privacy policy § 4).
// 2. Only on the English start, newsletter, guide and degree pages (script tag with data-redirect; guide and degrees since 21.10.2026): someone arriving from
//    outside goes to the German page if they chose German before, or, without a choice, if the browser's first
//    language is German. ?lang=en or a stored "en" keeps the English page. Order, thank-you and Transit Weekly pages
//    never redirect (a Stripe return or a link in an English email must stay English).
// 3. The button keeps the address extras (?strip=…, ?src=…) when switching.
(function () {
  var KEY = 'astrostrip-lang';
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  var me = document.currentScript;
  try {
    var q = new URLSearchParams(location.search), forced = q.get('lang');
    if (forced === 'en' || forced === 'de') {
      set(forced);
      q.delete('lang');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    }
    if (me && me.hasAttribute('data-redirect') && document.documentElement.lang === 'en' && !q.has('status')) { // ?status= comes from a confirmation link: its page already has the right language
      var saved = get();
      var ref = '';
      try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
      var first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
      var german = forced ? forced === 'de' : saved ? saved === 'de' : /^de\b/i.test(first);
      if (german && ref !== location.hostname) {
        window.astrostripLangRedirect = true; // the visit counter on the start page then stays silent
        var page = location.pathname.split('/').pop();
        location.replace('/de/' + (page === 'index.html' ? '' : page) + location.search + location.hash);
      }
    }
  } catch (e) {}
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.lang-switch');
    if (!a) return;
    var lang = a.getAttribute('hreflang');
    set(lang);
    try {
      var to = new URL(a.href, location.href), from = new URLSearchParams(location.search);
      from.forEach(function (v, k) { if (!to.searchParams.has(k)) to.searchParams.set(k, v); });
      to.searchParams.delete('lang'); // the choice is stored now; ?lang stays only as the no-storage fallback
      if (get() !== lang) to.searchParams.set('lang', lang);
      a.href = to.pathname + to.search + location.hash;
    } catch (e) {}
  });
})();
