import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { CANCELLATION_POLICY, WITHDRAWAL_FORM, weekStart, addWeeks, weekDate, longDate, WEEKS_AHEAD, verifyStripeSignature, validateOrder, STRIPS, customerMail, ownerOrderMail } from '../src/worker.js';

const iso = s => new Date(s * 1000).toISOString();
// week start (Berlin)
assert.equal(iso(weekStart(Date.parse('2026-10-07T12:00:00Z'))), '2026-10-04T22:00:00.000Z');
assert.equal(iso(weekStart(Date.parse('2026-10-26T08:00:00Z'))), '2026-10-25T23:00:00.000Z'); // after DST end
assert.equal(iso(weekStart(Date.parse('2026-10-25T22:30:00Z'))), '2026-10-18T22:00:00.000Z'); // Sunday 23:30 CET
assert.equal(iso(weekStart(Date.parse('2026-10-18T22:00:00Z'))), '2026-10-18T22:00:00.000Z'); // exactly Monday 00:00
assert.equal(iso(weekStart(Date.parse('2027-03-29T10:00:00Z'))), '2027-03-28T22:00:00.000Z'); // Monday after DST start (CEST)
console.log('weekStart ok');

// signature
const secret = 'whsec_test';
const body = '{"a":1}';
const t = Math.floor(Date.now() / 1000);
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
assert.equal(await verifyStripeSignature(body, `t=${t},v1=${hex}`, secret), true);
assert.equal(await verifyStripeSignature(body + ' ', `t=${t},v1=${hex}`, secret), false);
assert.equal(await verifyStripeSignature(body, `t=${t - 1000},v1=${hex}`, secret), false);
console.log('signature ok');

// validation
const good = { strip: 'ultra', name: 'Test Person', email: 't@example.com', birthDate: '1990-05-01', birthTime: '08:15', timeSource: 'certificate', place: { label: 'Hamburg, Germany', lat: 53.55, lon: 9.99, tz: 'Europe/Berlin' }, lifeArea: 'Work and calling', language: 'en', nodes: true, ancestry: true, acceptTerms: true, earlyStart: true, questionnaire: { residence: { label: 'Berlin, Germany', lat: 52.52, lon: 13.4, tz: 'Europe/Berlin' }, occupation: 'Designer', passions: 'Dance', relationship: 'Married', focus: 'Career' } };
assert.equal(validateOrder(good).errors.length, 0);
assert.ok(validateOrder({ ...good, earlyStart: false }).errors.length);
assert.ok(validateOrder({ ...good, lifeArea: 'Health' }).errors.length);
assert.equal(validateOrder({ ...good, strip: 'mini', lifeArea: '' }).order.ancestry, false);
assert.ok(validateOrder({ ...good, questionnaire: { ...good.questionnaire, residence: null } }).errors.length, 'ultra needs residence');
assert.equal(validateOrder({ ...good, strip: 'maxi', lifeArea: '', questionnaire: { relationship: 'Complicated' } }).errors.length, 0, 'maxi residence optional');
assert.equal(validateOrder({ ...good, strip: 'maxi', lifeArea: '', questionnaire: { relationship: 'Complicated' } }).order.questionnaire.relationship, '', 'unknown status dropped');
assert.equal(validateOrder({ ...good, strip: 'mini', lifeArea: '' }).order.questionnaire, null, 'mini has no questionnaire');
console.log('validation ok');

// full flow with mocks
const kv = new Map();
const env = {
  STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: secret, MAILJET_API_KEY: 'k', MAILJET_SECRET_KEY: 's', MAILJET_NEWSLETTER_LIST_ID: '111', MAILJET_CUSTOMER_LIST_ID: '222', OWNER_EMAIL: 'owner@example.com', SITE_URL: 'https://astrostrip.com',
  ORDERS: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  ASSETS: { fetch: async () => new Response('asset') },
};
const sessions = []; const mails = []; const lists = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions') && (init.method || 'GET') === 'GET') {
    const gte = Number(new URL(url).searchParams.get('created[gte]'));
    return new Response(JSON.stringify({ data: sessions.filter(s => s.created >= gte), has_more: false }));
  }
  if (url === 'https://api.stripe.com/v1/checkout/sessions' && init.method === 'POST') {
    const p = new URLSearchParams(init.body);
    const s = { id: 'cs_' + sessions.length, created: Math.floor(Date.now() / 1000), expires_at: Number(p.get('expires_at')), status: 'open', payment_status: 'unpaid', metadata: { strip: p.get('metadata[strip]'), order_id: p.get('metadata[order_id]'), week: p.get('metadata[week]') }, description: p.get('line_items[0][price_data][product_data][description]'), url: 'https://checkout.stripe.com/x' };
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), String(STRIPS[s.metadata.strip].cents));
    assert.ok(!init.body.includes('1990-05-01'), 'birth data must not go to Stripe');
    sessions.push(s);
    return new Response(JSON.stringify(s));
  }
  if (url === 'https://api.mailjet.com/v3.1/send') {
    assert.match(init.headers.Authorization, /^Basic /);
    const m = JSON.parse(init.body).Messages[0];
    assert.equal(m.TrackOpens, 'disabled'); assert.equal(m.TrackClicks, 'disabled');
    assert.equal(m.From.Name, 'astro.strip');
    mails.push({ to: m.To.map(t => t.Email), subject: m.Subject, text: m.TextPart });
    return new Response(JSON.stringify({ Messages: [{ Status: 'success' }] }));
  }
  if (/^https:\/\/api\.mailjet\.com\/v3\/REST\/contactslist\/\w+\/managecontact$/.test(url)) {
    lists.push({ list: url.split('/')[6], ...JSON.parse(init.body) });
    return new Response('{"Count":1}', { status: 201 });
  }
  throw new Error('unexpected fetch ' + url);
};
const req = (path, method = 'GET', b, headers = {}) => new Request('https://astrostrip.com' + path, { method, body: b === undefined ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)), headers: { 'CF-Connecting-IP': headers.ip || '1.1.1.1', ...headers } });

let r = await worker.fetch(req('/api/slots'), env);
const thisWeek = weekDate(weekStart());
let sl = await r.json();
assert.deepEqual(Object.keys(sl), ['mini', 'maxi', 'ultra']);
for (const [k, n] of [['mini', 20], ['maxi', 5], ['ultra', 3]]) { assert.equal(sl[k].limit, n); assert.equal(sl[k].left, n); assert.equal(sl[k].next, thisWeek); assert.equal(sl[k].thisWeek, true); }
assert.equal(sl.ultra.until, weekDate(addWeeks(weekStart(), WEEKS_AHEAD) - 86400 + 43200), 'booking window ends on a Sunday');
assert.equal(new Date(sl.ultra.until + 'T12:00:00Z').getUTCDay(), 0);
// week helpers across the DST change on 25 Oct 2026
assert.equal(weekDate(addWeeks(weekStart(Date.parse('2026-10-20T10:00:00Z')), 1)), '2026-10-26');
assert.equal(weekDate(addWeeks(weekStart(Date.parse('2026-10-27T10:00:00Z')), -1)), '2026-10-19');
assert.equal(longDate('2026-10-19'), '19 October 2026'); assert.equal(longDate('2026-10-19', 'de'), '19. Oktober 2026');

r = await worker.fetch(req('/api/checkout', 'POST', { ...good, newsletter: true }), env);
const co = await r.json();
assert.equal(r.status, 200, JSON.stringify(co));
assert.match(co.orderId, /^AS-\d{8}-[A-Z0-9]{5}$/);
assert.ok(kv.has('order:cs_0'));
r = await worker.fetch(req('/api/slots'), env);
assert.equal((await r.json()).ultra.left, 2, 'open session holds a slot');

// payment completes -> webhook
sessions[0].status = 'complete'; sessions[0].payment_status = 'paid';
const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: sessions[0] } });
const t2 = Math.floor(Date.now() / 1000);
const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t2}.${evt}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
r = await worker.fetch(req('/api/stripe-webhook', 'POST', evt, { 'Stripe-Signature': `t=${t2},v1=${sig}` }), env);
assert.equal(await r.text(), 'ok');
assert.equal(mails.length, 4, 'owner x2, customer, double opt-in');
assert.match(mails[3].subject, /confirm your newsletter/); assert.match(mails[3].text, /\/api\/confirm\?t=[0-9a-f]{64}/); assert.ok(!/reading|strip [0-9]|€/i.test(mails[3].text.split('astro.strip ·')[0].replace('astro.strip newsletter','')), 'no advertising in DOI mail');
assert.deepEqual(lists.map(l => [l.list, l.Action]), [['222', 'addnoforce']], 'buyer list, respects earlier unsubscribe');
assert.equal(mails[0].to[0], 'owner@example.com'); assert.match(mails[0].text, /Buchhaltung/); assert.match(mails[0].text, /Test Person/); assert.ok(!mails[0].text.includes('1990-05-01'), 'no birth data in accounting mail');
assert.equal(mails[1].to[0], 'owner@example.com'); assert.match(mails[1].text, /1990-05-01/); assert.match(mails[1].text, /Lebensbereich: Work and calling/); assert.match(mails[1].text, /Wohnort heute: Berlin/); assert.match(mails[1].text, /Beziehungsstatus: Married/); assert.match(mails[1].text, /Art. 9 DSGVO\): NEIN/);
assert.ok(!mails[1].text.includes('Test Person') && !mails[1].text.includes('t@example.com'), 'reading mail is pseudonymous');
assert.equal(mails[2].to[0], 't@example.com'); assert.match(mails[2].text, /Cancellation policy \(English\)/); assert.match(mails[2].text, /Widerrufsbelehrung \(Deutsch\)/); assert.ok(!mails[2].text.includes('Designer'), 'questionnaire not echoed to customer');
assert.ok(!kv.has('order:cs_0'), 'birth data deleted after mailing');
// bad signature
r = await worker.fetch(req('/api/stripe-webhook', 'POST', evt, { 'Stripe-Signature': `t=${t2},v1=00` }), env);
assert.equal(r.status, 400);

// fill ultra: 2 more -> sold out
assert.equal(sessions[0].metadata.week, String(weekStart()), 'first order books this week');
assert.match(sessions[0].description, /within 10 working days\./);
for (const ip of ['2.2.2.2', '3.3.3.3']) { r = await worker.fetch(req('/api/checkout', 'POST', { ...good, week: thisWeek }, { ip }), env); assert.equal(r.status, 200); }
// this week is full: the customer who still saw this week is told, not silently moved
r = await worker.fetch(req('/api/checkout', 'POST', { ...good, week: thisWeek }, { ip: '4.4.4.4' }), env);
let out = await r.json();
assert.equal(r.status, 409); assert.equal(out.weekChanged, true); assert.equal(out.slots.ultra.next, weekDate(addWeeks(weekStart(), 1)));
// next free week is offered and booked
r = await worker.fetch(req('/api/slots'), env);
sl = await r.json();
assert.equal(sl.ultra.left, 0); assert.equal(sl.ultra.thisWeek, false); assert.equal(sl.ultra.next, weekDate(addWeeks(weekStart(), 1)));
assert.equal(sl.maxi.thisWeek, true, 'other strips unaffected');
const nextWeek = sl.ultra.next;
r = await worker.fetch(req('/api/checkout', 'POST', { ...good, week: nextWeek }, { ip: '4.4.4.4' }), env);
assert.equal(r.status, 200);
const booked = sessions[sessions.length - 1];
assert.equal(booked.metadata.week, String(addWeeks(weekStart(), 1)));
assert.match(booked.description, new RegExp('booked for the week of ' + longDate(nextWeek)));
{ const stored = JSON.parse(kv.get('order:' + booked.id)); assert.equal(stored.week, nextWeek); assert.equal(stored.thisWeek, false);
  assert.match(customerMail(stored, stored.id, env), new RegExp('Delivery: booked for the week of ' + longDate(nextWeek) + ', delivered within 10 working days from that Monday'));
  assert.match(ownerOrderMail(stored, stored.id, { id: 'cs', payment_status: 'paid' }), new RegExp('Gebuchte Woche ab Montag, ' + longDate(nextWeek, 'de'))); }
// fill every week of the window -> fully booked until the last Sunday
for (let i = 0; i < WEEKS_AHEAD * 3; i++) {
  r = await worker.fetch(req('/api/slots'), env); const x = (await r.json()).ultra;
  if (!x.next) break;
  r = await worker.fetch(req('/api/checkout', 'POST', { ...good, week: x.next }, { ip: '6.6.' + i + '.1' }), env); assert.equal(r.status, 200);
}
r = await worker.fetch(req('/api/checkout', 'POST', good, { ip: '7.7.7.7' }), env);
out = await r.json();
assert.equal(r.status, 409); assert.equal(out.soldOut, true); assert.match(out.error, new RegExp('fully booked until ' + longDate(sl.ultra.until)));
assert.equal(sessions.filter(s => s.metadata.strip === 'ultra').length, WEEKS_AHEAD * 3, 'exactly 3 per week in the window');
// expired open session frees the slot in its week
sessions[1].expires_at = Math.floor(Date.now() / 1000) - 10;
r = await worker.fetch(req('/api/slots'), env);
sl = await r.json();
assert.equal(sl.ultra.left, 1); assert.equal(sl.ultra.next, thisWeek); assert.equal(sl.ultra.thisWeek, true);
// a booking from 7 weeks ago for this week still counts; one from 9 weeks ago does not
{ const w0 = weekStart(); sessions.push({ id: 'cs_old', created: addWeeks(w0, -7) + 100, expires_at: 0, status: 'complete', metadata: { strip: 'maxi', week: String(w0) } });
  sessions.push({ id: 'cs_older', created: addWeeks(w0, -9), expires_at: 0, status: 'complete', metadata: { strip: 'maxi', week: String(w0) } });
  r = await worker.fetch(req('/api/slots'), env); assert.equal((await r.json()).maxi.left, 4); }
// rate limit: 5 per hour per IP
for (let i = 0; i < 5; i++) await worker.fetch(req('/api/checkout', 'POST', { ...good, strip: 'mini', lifeArea: '' }, { ip: '9.9.9.9' }), env);
r = await worker.fetch(req('/api/checkout', 'POST', { ...good, strip: 'mini', lifeArea: '' }, { ip: '9.9.9.9' }), env);
assert.equal(r.status, 429);

// withdrawal
mails.length = 0;
r = await worker.fetch(req('/api/withdraw', 'POST', { name: 'Test Person', contract: co.orderId, email: 't@example.com' }), env);
const w = await r.json();
assert.equal(r.status, 200); assert.match(w.received, /Europe\/Berlin/);
assert.equal(mails.length, 2); assert.match(mails[0].text, /Eingegangen \/ Received:/); assert.match(mails[0].text, new RegExp(co.orderId));
r = await worker.fetch(req('/api/withdraw', 'POST', { name: 'x', contract: '', email: 'bad' }), env);
assert.equal(r.status, 400);

// static assets pass through
r = await worker.fetch(req('/index.html'), env);
assert.equal(await r.text(), 'asset');
console.log('flow ok');
console.log('--- customer mail sample ---\n' + customerMail({ ...validateOrder(good).order, createdAt: Date.now() }, 'AS-20261116-ABCDE', env).split('\n').slice(0, 14).join('\n'));

// page and mail must carry the same cancellation policy
const page = readFileSync(new URL('../public/cancellation.html', import.meta.url), 'utf8').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ');
for (const lang of ['de', 'en']) for (const line of [...CANCELLATION_POLICY[lang], ...WITHDRAWAL_FORM[lang]]) assert.ok(page.includes(line), 'missing on page: ' + line.slice(0, 60));
console.log('policy page = mail ok');

// newsletter signup + double opt-in
mails.length = 0; lists.length = 0;
r = await worker.fetch(req('/api/subscribe', 'POST', { email: 'n@example.com', consent: false }, { ip: '5.5.5.5' }), env);
assert.equal(r.status, 400, 'consent box required');
r = await worker.fetch(req('/api/subscribe', 'POST', { email: 'n@example.com', consent: true, website: 'spam' }, { ip: '5.5.5.6' }), env);
assert.equal(r.status, 200); assert.equal(mails.length, 0, 'honeypot silently dropped');
r = await worker.fetch(req('/api/subscribe', 'POST', { email: 'n@example.com', consent: true, source: 'calculator' }, { ip: '5.5.5.7' }), env);
assert.equal(r.status, 200); assert.equal(mails.length, 1); assert.equal(lists.length, 0, 'not on the list before confirming');
const token = mails[0].text.match(/t=([0-9a-f]{64})/)[1];
r = await worker.fetch(req('/api/confirm?t=' + token, 'GET', undefined, { ip: '5.5.5.8' }), env);
assert.equal(r.status, 303); assert.match(r.headers.get('Location'), /newsletter\.html\?status=confirmed/);
assert.deepEqual(lists.map(l => [l.list, l.Action, l.Email]), [['111', 'addforce', 'n@example.com']]);
const proof = JSON.parse(kv.get('consent:n@example.com'));
assert.equal(proof.events[0].type, 'newsletter-optin'); assert.equal(proof.events[0].source, 'calculator'); assert.ok(proof.events[0].confirmedAt && proof.events[0].requestedAt);
r = await worker.fetch(req('/api/confirm?t=' + token, 'GET'), env);
assert.match(r.headers.get('Location'), /status=expired/, 'link works only once');
r = await worker.fetch(req('/api/confirm?t=nonsense', 'GET'), env);
assert.match(r.headers.get('Location'), /status=expired/);
console.log('newsletter ok');

// consent wording on the pages must match the versioned proof texts
{
  const { NEWSLETTER_CONSENT, CUSTOMER_NOTICE } = await import('../src/worker.js');
  const plain = f => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  for (const f of ['index.html', 'newsletter.html', 'order.html']) assert.ok(plain(f).includes(NEWSLETTER_CONSENT.en), 'newsletter wording differs on ' + f);
  assert.ok(plain('order.html').includes(CUSTOMER_NOTICE.en), 'customer notice differs on order.html');
  console.log('consent wording = proof ok');
}
