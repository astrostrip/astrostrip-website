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
        body: JSON.stringify({ email, consent, source: form.dataset.source, website: form.querySelector('input[name=website]').value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || '');
      form.reset();
      status.textContent = L('Almost done: please check your inbox and confirm your signup. Nothing there? Have a look in your spam folder.', 'Fast geschafft: Schau in dein Postfach und bestätige deine Anmeldung. Nichts da? Dann sieh bitte im Spam-Ordner nach.');
    } catch (err) {
      status.textContent = err instanceof TypeError || !err.message ? L('Signup is not available right now. Please try again later.', 'Die Anmeldung ist gerade nicht möglich. Bitte versuche es später noch einmal.') : err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
