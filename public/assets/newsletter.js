// Newsletter signup forms (index page, newsletter page). Double opt-in runs on the server (/api/subscribe).
for (const form of document.querySelectorAll('form.newsletter-form')) {
  const status = form.querySelector('.form-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = form.querySelector('input[type=email]').value.trim();
    const consent = form.querySelector('input[name=consent]').checked;
    status.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = 'Please enter a valid email address.'; return; }
    if (!consent) { status.textContent = 'Please tick the box to agree to the newsletter.'; return; }
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
      status.textContent = 'Almost done: please check your inbox and confirm your signup.';
    } catch (err) {
      status.textContent = err instanceof TypeError || !err.message ? 'Signup is not available right now. Please try again later.' : err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
