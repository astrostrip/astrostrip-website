// Newsletter signup forms (index page, newsletter page). Double opt-in runs on the server (/api/subscribe).
const L = (en, de) => (document.documentElement.lang === 'de' ? de : en); // German site /de/ (Sandra, 18.10.2026)
for (const form of document.querySelectorAll('form.newsletter-form')) {
  const status = form.querySelector('.form-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = form.querySelector('input[type=email]').value.trim();
    const consent = form.querySelector('input[name=consent]').checked;
    status.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = L('Please enter a valid email address.', 'Bitte gib eine gültige E-Mail-Adresse ein.'); return; }
    if (!consent) { status.textContent = L('Please tick the box to agree to the newsletter.', 'Bitte setz das Häkchen, um dem Newsletter zuzustimmen.'); return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, consent, source: form.dataset.source, lang: document.documentElement.lang, website: form.querySelector('input[name=website]').value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || '');
      form.reset();
      status.textContent = form.dataset.source === 'guide'
        // guide page: say which email comes and what happens next (Sandra, 21.10.2026)
        ? L('Almost done: we’ve sent you an email with the subject “Please confirm your signup”. Click “Confirm” there and the page with your guide opens. Nothing there? Please check your spam folder.',
            'Fast geschafft: Wir haben dir eine Mail mit dem Betreff „Bitte bestätige deine Anmeldung“ geschickt. Klick dort auf „Bestätigen“, dann öffnet sich die Seite mit deinem Leitfaden. Nichts angekommen? Dann sieh bitte im Spam-Ordner nach.')
        : L('Almost done: please check your inbox and confirm your signup. Nothing there? Have a look in your spam folder.', 'Fast geschafft: Schau in dein Postfach und bestätige deine Anmeldung. Nichts da? Dann sieh bitte im Spam-Ordner nach.');
    } catch (err) {
      status.textContent = err instanceof TypeError || !err.message ? L('Signup is not available right now. Please try again later.', 'Die Anmeldung ist gerade nicht möglich. Bitte versuche es später noch einmal.') : err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
