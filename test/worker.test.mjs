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

// Berlin time without Intl (src/time.js) gives the same strings as Intl: every 15 minutes around each
// DST change 2026–2032, plus spread-out instants
{
  const { berlinOffsetMinutes, berlinYmd, longDateText, berlinStampText, isoUtc } = await import('../src/time.js');
  const TZ = 'Europe/Berlin';
  const parts = ms => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const offset = ms => { const p = parts(ms); return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / 60000); };
  const pts = [];
  for (let y = 2026; y <= 2032; y++) for (const mo of [2, 9]) for (let h = 0; h < 8 * 24 * 4; h++) pts.push(Date.UTC(y, mo, 24) + h * 900000);
  for (let i = 0; i < 2000; i++) pts.push(Date.UTC(2026, 0, 1) + i * 104729831);
  for (const ms of pts) {
    assert.equal(berlinOffsetMinutes(ms), offset(ms));
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    assert.equal(berlinYmd(ms), ymd);
    for (const [lang, loc] of [['de', 'de-DE'], ['en', 'en-GB']]) {
      assert.equal(berlinStampText(ms, lang), new Intl.DateTimeFormat(loc, { timeZone: TZ, dateStyle: 'long', timeStyle: 'medium' }).format(new Date(ms)));
      assert.equal(longDateText(ymd, lang), new Intl.DateTimeFormat(loc, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${ymd}T00:00:00Z`)));
    }
    assert.equal(isoUtc(ms), new Date(ms).toISOString());
  }
  assert.ok(!/Intl\.|toISOString/.test(readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')), 'no Intl or toISOString in the Worker');
}
console.log('berlin time ok');

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
const good = { strip: 'ultra', name: 'Test Person', email: 't@example.com', birthDate: '1990-05-01', birthTime: '08:15', timeSource: 'certificate', place: { label: 'Hamburg, Germany', lat: 53.55, lon: 9.99, tz: 'Europe/Berlin' }, lifeArea: 'Work and calling', language: 'en', nodes: true, ancestry: true, acceptTerms: true, earlyStart: true, sensitiveConsent: true, questionnaire: { residence: { label: 'Berlin, Germany', lat: 52.52, lon: 13.4, tz: 'Europe/Berlin' }, occupation: 'Designer', passions: 'Dance', relationship: 'Married', focus: 'Career' } };
assert.equal(validateOrder(good).errors.length, 0);
assert.ok(validateOrder({ ...good, earlyStart: false }).errors.length);
assert.ok(validateOrder({ ...good, lifeArea: 'Health' }).errors.length);
assert.equal(validateOrder({ ...good, strip: 'mini', lifeArea: '' }).order.ancestry, false);
assert.equal(validateOrder({ ...good, strip: 'mini', lifeArea: '' }).order.nodes, false, 'no karmic nodes layer in the Mini Strip');
assert.equal(validateOrder({ ...good, strip: 'maxi', lifeArea: '', questionnaire: {} }).order.nodes, true);
assert.ok(validateOrder({ ...good, questionnaire: { ...good.questionnaire, residence: null } }).errors.length, 'ultra needs residence');
assert.equal(validateOrder({ ...good, strip: 'maxi', lifeArea: '', questionnaire: { relationship: 'Complicated' } }).errors.length, 0, 'maxi residence optional');
assert.equal(validateOrder({ ...good, strip: 'maxi', lifeArea: '', questionnaire: { relationship: 'Complicated' } }).order.questionnaire.relationship, '', 'unknown status dropped');
assert.equal(validateOrder({ ...good, strip: 'mini', lifeArea: '' }).order.questionnaire, null, 'mini has no questionnaire');
// Art. 9 consent: required whenever a free-text field is filled, not otherwise (Sandra, 05.10.2026)
assert.ok(validateOrder({ ...good, sensitiveConsent: false }).errors.some(e => /consent box/.test(e)), 'free text needs consent');
assert.equal(validateOrder({ ...good, sensitiveConsent: false, questionnaire: { ...good.questionnaire, occupation: '', passions: '', focus: '' } }).errors.length, 0, 'no free text, no consent needed');
assert.ok(validateOrder({ ...good, strip: 'mini', lifeArea: '', sensitiveConsent: false, note: 'something' }).errors.length, 'mini note needs consent');
assert.equal(validateOrder({ ...good, sensitiveConsent: false, questionnaire: { ...good.questionnaire, sensitiveConsent: true } }).errors.length, 0, 'old flag location still accepted');
assert.equal(validateOrder(good).order.sensitiveConsent, true);
console.log('validation ok');

// full flow with mocks
const kv = new Map();
const kvMeta = new Map(); // KV metadata (Transit Weekly summaries and send times)
const env = {
  STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: secret, MAILJET_API_KEY: 'k', MAILJET_SECRET_KEY: 's', MAILJET_NEWSLETTER_LIST_ID: '111', MAILJET_CUSTOMER_LIST_ID: '222', OWNER_EMAIL: 'owner@example.com', SITE_URL: 'https://astrostrip.com',
  ORDERS: {
    get: async k => kv.get(k) ?? null, put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) kvMeta.set(k, o.metadata); else kvMeta.delete(k); }, delete: async k => { kv.delete(k); kvMeta.delete(k); },
    getWithMetadata: async k => ({ value: kv.get(k) ?? null, metadata: kvMeta.get(k) ?? null }),
    list: async ({ prefix, limit }) => { const keys = [...kv.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit).map(name => ({ name, metadata: kvMeta.get(name) })); return { keys, list_complete: true }; },
  },
  ASSETS: { fetch: async () => new Response('asset') },
};
const sessions = []; const mails = []; const lists = [];
const pis = {}; const refunds = {}; // Stripe payments and refunds for the invoice correction
let failMail = () => false; // a test sets it to let Mailjet refuse certain mails
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions') && (init.method || 'GET') === 'GET') {
    const q = new URL(url).searchParams;
    if (q.get('payment_intent')) return new Response(JSON.stringify({ data: sessions.filter(s => s.payment_intent === q.get('payment_intent')).slice(0, 1), has_more: false }));
    const gte = Number(q.get('created[gte]'));
    return new Response(JSON.stringify({ data: sessions.filter(s => s.created >= gte), has_more: false }));
  }
  let m;
  if (url.startsWith('https://api.stripe.com/v1/payment_intents/search?')) {
    const q = new URL(url).searchParams;
    assert.equal(q.get('expand[]'), 'data.latest_charge');
    const id = q.get('query').match(/^metadata\['order_id'\]:'(AS-[\w-]+)'$/)[1];
    return new Response(JSON.stringify({ data: Object.values(pis).filter(p => p.metadata?.order_id === id), has_more: false }));
  }
  if ((m = url.match(/^https:\/\/api\.stripe\.com\/v1\/payment_intents\/(\w+)$/))) {
    const pi = pis[m[1]];
    if (!pi) return new Response('{"error":{"message":"No such payment_intent"}}', { status: 404 });
    if (init.method === 'POST') { for (const [k, v] of new URLSearchParams(init.body)) pi.metadata[k.slice(9, -1)] = v; }
    return new Response(JSON.stringify(pi));
  }
  if ((m = url.match(/^https:\/\/api\.stripe\.com\/v1\/refunds\/(\w+)$/))) {
    return refunds[m[1]] ? new Response(JSON.stringify(refunds[m[1]])) : new Response('{"error":{"message":"No such refund"}}', { status: 404 });
  }
  if (url.startsWith('https://api.stripe.com/v1/refunds?')) {
    const pi = new URL(url).searchParams.get('payment_intent');
    return new Response(JSON.stringify({ data: Object.values(refunds).filter(r => r.payment_intent === pi).reverse(), has_more: false })); // Stripe lists newest first
  }
  if (url === 'https://api.stripe.com/v1/checkout/sessions' && init.method === 'POST') {
    const p = new URLSearchParams(init.body);
    const md = Object.fromEntries([...p].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
    const s = { id: 'cs_' + sessions.length, created: Math.floor(Date.now() / 1000), expires_at: Number(p.get('expires_at')), status: 'open', payment_status: 'unpaid', metadata: md, description: p.get('line_items[0][price_data][product_data][description]'), url: 'https://checkout.stripe.com/x', body: init.body };
    if (s.metadata.strip !== 'transit') assert.equal(p.get('line_items[0][price_data][unit_amount]'), String(STRIPS[s.metadata.strip].cents));
    assert.ok(!init.body.includes('1990-05-01'), 'birth data must not go to Stripe');
    assert.equal(p.get('billing_address_collection'), 'required', 'billing address for the invoice');
    sessions.push(s);
    return new Response(JSON.stringify(s));
  }
  if (url === 'https://api.mailjet.com/v3.1/send') {
    assert.match(init.headers.Authorization, /^Basic /);
    const m = JSON.parse(init.body).Messages[0];
    assert.equal(m.TrackOpens, 'disabled'); assert.equal(m.TrackClicks, 'disabled');
    assert.equal(m.From.Name, 'astro.strip');
    if (failMail(m)) return new Response('{"ErrorMessage":"test"}', { status: 500 });
    mails.push({ to: m.To.map(t => t.Email), subject: m.Subject, text: m.TextPart, html: m.HTMLPart, attachments: m.Attachments });
    return new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 1000 + mails.length }] }] }));
  }
  if (/^https:\/\/api\.mailjet\.com\/v3\/REST\/contactslist\/\w+\/managecontact$/.test(url)) {
    lists.push({ list: url.split('/')[6], ...JSON.parse(init.body) });
    return new Response('{"Count":1}', { status: 201 });
  }
  throw new Error('unexpected fetch ' + url);
};
const stripeMailMock = globalThis.fetch; // the retention and stats blocks swap fetch; Transit Weekly needs this one back
const req = (path, method = 'GET', b, headers = {}) => new Request('https://astrostrip.com' + path, { method, body: b === undefined ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)), headers: { 'CF-Connecting-IP': headers.ip || '1.1.1.1', ...headers } });

let r = await worker.fetch(req('/api/slots'), env);
const thisWeek = weekDate(weekStart());
let sl = await r.json();
assert.deepEqual(Object.keys(sl), ['mini', 'maxi', 'ultra', 'transit']);
assert.deepEqual(Object.keys(sl.transit), ['next', 'until'], 'Transit Weekly: no minutes or areas left in the API'); assert.equal(sl.transit.next, thisWeek);
for (const [k, n] of [['mini', 21], ['maxi', 7], ['ultra', 6]]) { assert.equal(sl[k].limit, undefined, 'no total in the API'); assert.equal(sl[k].left, n); assert.equal(sl[k].next, thisWeek); assert.equal(sl[k].thisWeek, true); }
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
assert.equal((await r.json()).ultra.left, STRIPS.ultra.weekly - 1, 'open session holds a slot');

// payment completes -> webhook
sessions[0].status = 'complete'; sessions[0].payment_status = 'paid'; sessions[0].payment_intent = 'pi_0';
pis.pi_0 = { id: 'pi_0', amount: 12900, created: sessions[0].created, metadata: { order_id: sessions[0].metadata.order_id, strip: 'ultra', week: thisWeek } };
sessions[0].customer_details = { name: 'Test Person', email: 't@example.com', address: { line1: 'Teststraße 5', line2: null, postal_code: '20149', city: 'Hamburg', state: null, country: 'DE' } };
const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: sessions[0] } });
const t2 = Math.floor(Date.now() / 1000);
const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t2}.${evt}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
r = await worker.fetch(req('/api/stripe-webhook', 'POST', evt, { 'Stripe-Signature': `t=${t2},v1=${sig}` }), env);
assert.equal(await r.text(), 'ok');
assert.equal(mails.length, 4, 'owner x2, customer, double opt-in');
assert.match(mails[3].subject, /confirm your newsletter/); assert.match(mails[3].text, /\/api\/confirm\?t=[0-9a-f]{64}/); assert.ok(!/reading|strip [0-9]|€/i.test(mails[3].text.split('astro.strip ·')[0].replace('astro.strip newsletter','')), 'no advertising in DOI mail');
assert.deepEqual(lists.map(l => [l.list, l.Action]), [['222', 'addnoforce']], 'buyer list, respects earlier unsubscribe');
assert.equal(mails[0].to[0], 'owner@example.com'); assert.match(mails[0].text, /Buchhaltung/); assert.match(mails[0].text, /Test Person/); assert.ok(!mails[0].text.includes('1990-05-01'), 'no birth data in accounting mail');
assert.equal(mails[1].to[0], 'owner@example.com'); assert.match(mails[1].text, /1990-05-01/); assert.match(mails[1].text, /Lebensbereich: Work and calling/); assert.match(mails[1].text, /Wohnort heute: Berlin/); assert.match(mails[1].text, /Beziehungsstatus: Married/); assert.match(mails[1].text, /Art. 9 DSGVO\): ja/);
assert.ok(!mails[1].text.includes('Test Person') && !mails[1].text.includes('t@example.com'), 'reading mail is pseudonymous');
assert.equal(mails[2].to[0], 't@example.com'); assert.match(mails[2].text, /Cancellation policy \(English\)/); assert.match(mails[2].text, /Widerrufsbelehrung \(Deutsch\)/); assert.ok(!mails[2].text.includes('Designer'), 'questionnaire not echoed to customer');
assert.ok(!kv.has('order:cs_0'), 'birth data deleted after mailing');
assert.match(mails[2].text, /Invoice: follows in a separate email/);
// invoice: queued by the webhook, built and mailed by the 5-minute cron in its own invocation
{
  const { INVOICE_CRON, INVOICE_TRIES } = await import('../src/worker.js');
  const orderId = sessions[0].metadata.order_id;
  const jobKey = `invoice:${orderId}`;
  assert.ok(kv.has(jobKey), 'invoice job queued');
  assert.ok(!kv.get(jobKey).includes('1990-05-01'), 'no birth data in the invoice job');
  const before = mails.length;
  const run = async () => { const p = []; await worker.scheduled({ cron: INVOICE_CRON }, env, { waitUntil: x => p.push(x) }); await Promise.all(p); };
  const pdfKey = `invoicepdf:${orderId}`;
  const stepOf = k => JSON.parse(kv.get(k)).step;
  // run 1: only builds the PDF and keeps it in the KV
  await run();
  assert.equal(mails.length, before, 'building sends nothing');
  assert.ok(kv.has(pdfKey), 'PDF kept for the next steps'); assert.equal(stepOf(jobKey), 'customer'); assert.equal(JSON.parse(kv.get(jobKey)).attempts, 0, 'tries counted per step');
  // run 2: only the mail to the customer
  await run();
  assert.equal(mails.length, before + 1, 'one mail per run'); assert.equal(stepOf(jobKey), 'owner'); assert.equal(JSON.parse(kv.get(jobKey)).customerSent, true);
  // run 3: copy to Sandra, invoice date at Stripe, job and PDF deleted
  await run();
  const [toCustomer, toOwner] = mails.slice(before);
  assert.equal(mails.length, before + 2, 'invoice to customer and copy to owner');
  assert.ok(!kv.has(pdfKey), 'stored PDF deleted after sending');
  assert.equal(toOwner.attachments[0].Base64Content, toCustomer.attachments[0].Base64Content, 'the same PDF to both');
  assert.equal(toCustomer.to[0], 't@example.com'); assert.match(toCustomer.subject, new RegExp(`Your invoice ${orderId}`));
  assert.equal(toOwner.to[0], 'owner@example.com'); assert.match(toOwner.subject, /Buchhaltung, 8 Jahre/);
  for (const m of [toCustomer, toOwner]) {
    assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].ContentType, 'application/pdf');
    assert.equal(m.attachments[0].Filename, `astro.strip-Rechnung-${orderId}.pdf`);
  }
  const pdf = Buffer.from(toCustomer.attachments[0].Base64Content, 'base64').toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.7') && pdf.trimEnd().endsWith('%%EOF'), 'complete PDF');
  assert.ok(pdf.includes('/AFRelationship /Alternative') && pdf.includes('(factur-x.xml)'), 'ZUGFeRD attachment');
  const xml = Buffer.from(toCustomer.attachments[0].Base64Content, 'base64').toString('utf8');
  assert.ok(xml.includes(`<ram:ID>${orderId}</ram:ID>`) && xml.includes('<ram:LineOne>Teststraße 5</ram:LineOne>') && xml.includes('<ram:GrandTotalAmount>129.00</ram:GrandTotalAmount>'), 'XML with order number, address, total');
  assert.ok(!kv.has(jobKey), 'job removed after sending');
  // a job that keeps failing: retried, then Sandra is warned
  kv.set('invoice:AS-BROKEN', JSON.stringify({ order: { id: 'AS-BROKEN', email: 'x@example.com', strip: 'nope' }, customer_details: {}, paidAt: Date.now(), attempts: 0 }));
  for (let i = 0; i < INVOICE_TRIES; i++) await run().catch(() => {});
  assert.equal(JSON.parse(kv.get('invoice:AS-BROKEN')).attempts, INVOICE_TRIES, 'each try is counted before the work');
  const n = mails.length;
  await run();
  assert.match(mails[n].subject, /RECHNUNG FEHLT: AS-BROKEN/); assert.ok(!kv.has('invoice:AS-BROKEN'));
  assert.match(mails[n].text, /nicht erzeugt werden/); assert.ok(!mails[n].attachments, 'no PDF to attach yet');
  // second ID of the PDF trailer: 32 hex digits, different for another document (no crypto call)
  const trailerId = b64 => Buffer.from(b64, 'base64').toString('latin1').match(/\/ID \[<[0-9A-Fa-f]+> <([0-9a-f]{32})>\]/)?.[1];
  assert.ok(trailerId(toCustomer.attachments[0].Base64Content), 'document id in the trailer');
  // a run cut off after the customer mail but before the step was saved: no second mail to the customer
  const twice = { order: { id: 'AS-TWICE', email: 'tw@example.com', strip: 'mini' }, customer_details: {}, paidAt: Date.now(), step: 'customer', attempts: 1, customerSent: true, inv: { number: 'AS-TWICE', filename: 'astro.strip-Rechnung-AS-TWICE.pdf', issueDate: '2026-10-03', period: { start: '2026-10-03', end: '2026-10-08' }, amounts: { gross: 3900 }, buyer: { name: 'Tw' }, missingCountry: false } };
  kv.set('invoice:AS-TWICE', JSON.stringify(twice)); kv.set('invoicepdf:AS-TWICE', toCustomer.attachments[0].Base64Content);
  let m0 = mails.length;
  await run();
  assert.equal(mails.length, m0, 'customer already has it'); assert.equal(stepOf('invoice:AS-TWICE'), 'owner');
  await run();
  assert.equal(mails.length, m0 + 1); assert.equal(mails[m0].to[0], 'owner@example.com'); assert.ok(!kv.has('invoice:AS-TWICE') && !kv.has('invoicepdf:AS-TWICE'));
  // the customer mail keeps failing: retried per step, then Sandra gets the warning with the PDF to forward
  kv.set('invoice:AS-NOMAIL', JSON.stringify({ ...twice, order: { ...twice.order, id: 'AS-NOMAIL', email: 'bounce@example.com' }, customerSent: false, attempts: 0, inv: { ...twice.inv, number: 'AS-NOMAIL', filename: 'astro.strip-Rechnung-AS-NOMAIL.pdf' } }));
  kv.set('invoicepdf:AS-NOMAIL', toCustomer.attachments[0].Base64Content);
  failMail = m => m.To[0].Email === 'bounce@example.com';
  for (let i = 0; i < INVOICE_TRIES; i++) await run().catch(() => {});
  assert.equal(JSON.parse(kv.get('invoice:AS-NOMAIL')).attempts, INVOICE_TRIES); assert.equal(stepOf('invoice:AS-NOMAIL'), 'customer');
  m0 = mails.length;
  await run();
  assert.equal(mails.length, m0 + 1); assert.match(mails[m0].subject, /RECHNUNG FEHLT: AS-NOMAIL/); assert.match(mails[m0].text, /nicht an die Kundin verschickt/); assert.match(mails[m0].text, /an die Kundin weiterleiten/);
  assert.equal(mails[m0].attachments[0].Filename, 'astro.strip-Rechnung-AS-NOMAIL.pdf', 'warning carries the PDF');
  assert.ok(!kv.has('invoice:AS-NOMAIL') && !kv.has('invoicepdf:AS-NOMAIL'), 'nothing left in the KV');
  // the copy to Sandra keeps failing, and the warning with attachment too: warning goes without the PDF
  kv.set('invoice:AS-NOCOPY', JSON.stringify({ ...twice, order: { ...twice.order, id: 'AS-NOCOPY' }, step: 'owner', attempts: INVOICE_TRIES, inv: { ...twice.inv, number: 'AS-NOCOPY' } }));
  kv.set('invoicepdf:AS-NOCOPY', toCustomer.attachments[0].Base64Content);
  failMail = m => !!m.Attachments;
  m0 = mails.length;
  await run();
  failMail = () => false;
  assert.equal(mails.length, m0 + 1); assert.match(mails[m0].text, /Kopie für die Buchhaltung/); assert.match(mails[m0].text, /ließ sich nicht anhängen/); assert.ok(!mails[m0].attachments);
  assert.ok(!kv.has('invoice:AS-NOCOPY') && !kv.has('invoicepdf:AS-NOCOPY'));
  // amounts for every strip satisfy EN 16931 BR-CO-17 (VAT = basis × rate, rounded) and add up
  const { splitGross, servicePeriod } = await import('../src/invoice.js');
  // service period = delivery promise: from payment N working days, or a booked week from its Monday (day 1)
  assert.deepEqual(servicePeriod({ thisWeek: true }, STRIPS.mini, '2026-10-02'), { start: '2026-10-02', end: '2026-10-09' });
  assert.deepEqual(servicePeriod({ thisWeek: false, week: '2026-10-12' }, STRIPS.ultra, '2026-10-02'), { start: '2026-10-12', end: '2026-10-23' });
  assert.deepEqual(servicePeriod({ thisWeek: false, week: '2026-10-12' }, STRIPS.maxi, '2026-10-02'), { start: '2026-10-12', end: '2026-10-20' });
  assert.ok(xml.includes('<ram:BillingSpecifiedPeriod>') && xml.includes('<ram:ShipToTradeParty><ram:Name>Test Person</ram:Name>'), 'service period and delivery party in the XML');
  for (const s of Object.values(STRIPS)) { const a = splitGross(s.cents); assert.equal(a.vat, Math.round(a.net * 0.19)); assert.equal(a.net + a.vat, s.cents); }
  // the invoice date and service period are noted at the payment, for a later correction
  assert.match(pis.pi_0.metadata.invoice_date, /^\d{4}-\d{2}-\d{2}$/); assert.match(pis.pi_0.metadata.invoice_period, /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/);
  console.log('invoice ok');
}
// invoice correction (Rechnungskorrektur) for refunds: refund.created queues, a cron run of its own sends
{
  const { CORRECTION_CRON, INVOICE_TRIES } = await import('../src/worker.js');
  const signed = async evtBody => {
    const ts = Math.floor(Date.now() / 1000);
    const sg = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${evtBody}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
    return worker.fetch(req('/api/stripe-webhook', 'POST', evtBody, { 'Stripe-Signature': `t=${ts},v1=${sg}` }), env);
  };
  const refundEvent = (type, r) => signed(JSON.stringify({ type, data: { object: r } }));
  const run = async () => { const p = []; await worker.scheduled({ cron: CORRECTION_CRON }, env, { waitUntil: x => p.push(x) }); await Promise.all(p); };
  const run3 = async () => { for (let i = 0; i < 3; i++) await run(); }; // build, customer, owner: one step per run
  const orderId = sessions[0].metadata.order_id;
  const xmlOf = m => Buffer.from(m.attachments[0].Base64Content, 'base64').toString('utf8');
  const leftUltra = async () => (await (await worker.fetch(req('/api/slots'), env)).json()).ultra.left;
  const ultraBefore = await leftUltra();

  // full refund of the paid Ultra Strip
  const now = Math.floor(Date.now() / 1000);
  refunds.re_1 = { id: 're_1', amount: 12900, payment_intent: 'pi_0', status: 'succeeded', created: now };
  r = await refundEvent('refund.created', refunds.re_1);
  assert.equal(await r.text(), 'queued');
  assert.deepEqual(JSON.parse(kv.get('correction:re_1')), { refund: 're_1', attempts: 0 }, 'job holds only the refund id');
  let before = mails.length;
  await run();
  assert.equal(mails.length, before, 'step 1 only builds');
  assert.ok(kv.has('correctionpdf:re_1') && JSON.parse(kv.get('correction:re_1')).step === 'customer', 'PDF waits for step 2');
  await run();
  assert.equal(mails.length, before + 1, 'step 2: customer'); assert.equal(JSON.parse(kv.get('correction:re_1')).step, 'owner');
  await run();
  let [toCustomer, toOwner] = mails.slice(before);
  assert.equal(mails.length, before + 2, 'correction to customer and copy to owner');
  assert.ok(!kv.has('correctionpdf:re_1'), 'stored PDF removed after the copy');
  assert.equal(toCustomer.to[0], 't@example.com'); assert.match(toCustomer.subject, new RegExp(`Your invoice correction ${orderId}-K1`));
  assert.match(toCustomer.text, /refunded 129,00 €/); assert.match(toCustomer.text, /Rechnungskorrektur/); assert.ok(!/Gutschrift/.test(toCustomer.text));
  assert.equal(toOwner.to[0], 'owner@example.com'); assert.match(toOwner.subject, new RegExp(`Rechnungskorrektur ${orderId}-K1 \\(Buchhaltung, 8 Jahre`));
  assert.match(toOwner.text, /volle Erstattung 129,00 €/); assert.match(toOwner.text, /Wochenplatz ist wieder frei/); assert.ok(!/ACHTUNG/.test(toOwner.text), 'invoice date known');
  assert.equal(toCustomer.attachments[0].Filename, `astro.strip-Rechnungskorrektur-${orderId}-K1.pdf`);
  let xml = xmlOf(toCustomer);
  assert.ok(xml.includes('<ram:TypeCode>381</ram:TypeCode>'), 'document type 381');
  assert.ok(xml.includes(`<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${orderId}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${pis.pi_0.metadata.invoice_date.replace(/-/g, '')}</qdt:DateTimeString>`), 'refers to the invoice (BT-25, BT-26)');
  assert.ok(xml.includes('<ram:GrandTotalAmount>129.00</ram:GrandTotalAmount>') && xml.includes('<ram:LineOne>Teststraße 5</ram:LineOne>') && xml.includes('<ram:BillingSpecifiedPeriod>'));
  assert.ok(!kv.has('correction:re_1') && kv.has('correction:re_1') === false);
  assert.equal(await leftUltra(), ultraBefore + 1, 'refunded order frees its week slot');
  // Stripe delivers the same event again: no second correction
  await refundEvent('refund.created', refunds.re_1); before = mails.length; await run3();
  assert.equal(mails.length, before, 'one refund, one correction'); assert.ok(!kv.has('correction:re_1'));

  // two partial refunds of an older order (no invoice date at Stripe yet): K follows Stripe's order, not the queue's
  sessions.push({ id: 'cs_part', created: now - 86400, expires_at: 0, status: 'expired', payment_intent: 'pi_1', metadata: { strip: 'maxi', order_id: 'AS-20261001-PART1', week: String(addWeeks(weekStart(), -3)) },
    customer_details: { name: 'Kim Test', email: 'k@example.com', address: { line1: 'Ring 1', postal_code: '1010', city: 'Wien', country: 'AT' } } });
  pis.pi_1 = { id: 'pi_1', amount: 7900, created: now - 86400, metadata: { order_id: 'AS-20261001-PART1', strip: 'maxi' } };
  refunds.re_2 = { id: 're_2', amount: 3950, payment_intent: 'pi_1', status: 'succeeded', created: now - 60 };
  refunds.re_3 = { id: 're_3', amount: 1000, payment_intent: 'pi_1', status: 'pending', created: now };
  await refundEvent('refund.created', refunds.re_3); before = mails.length; await run3();
  [toCustomer, toOwner] = mails.slice(before);
  assert.match(toCustomer.subject, /AS-20261001-PART1-K2/); assert.equal(toCustomer.to[0], 'k@example.com');
  await refundEvent('refund.created', refunds.re_2); before = mails.length; await run3();
  [toCustomer, toOwner] = mails.slice(before);
  assert.match(toCustomer.subject, /AS-20261001-PART1-K1/); assert.match(toCustomer.text, /^Hi Kim Test,/);
  assert.match(toOwner.text, /Teilerstattung 39,50 € inkl\. 19 % USt \(netto 33,19 €, USt 6,31 €\)/); assert.match(toOwner.text, /Rechnungsdatum nicht bei Stripe hinterlegt/);
  xml = xmlOf(toCustomer);
  assert.ok(xml.includes('<ram:LineTotalAmount>33.19</ram:LineTotalAmount>') && xml.includes('<ram:TaxTotalAmount currencyID="EUR">6.31</ram:TaxTotalAmount>') && xml.includes('<ram:GrandTotalAmount>39.50</ram:GrandTotalAmount>'), 'partial amounts');
  assert.equal(Math.round(3319 * 0.19), 631, 'BR-CO-17'); assert.ok(xml.includes('Teilerstattung') && xml.includes('<ram:CountryID>AT</ram:CountryID>') && !xml.includes('<ram:BillingSpecifiedPeriod>'));
  // a slot outside the booking window changes nothing
  assert.equal(await leftUltra(), ultraBefore + 1);

  // failed refund, refund without a website order, refund.failed event: only Sandra is told
  refunds.re_4 = { id: 're_4', amount: 3900, payment_intent: 'pi_1', status: 'failed', created: now + 5 };
  pis.pi_2 = { id: 'pi_2', amount: 5000, created: now, metadata: {} };
  refunds.re_5 = { id: 're_5', amount: 5000, payment_intent: 'pi_2', status: 'succeeded', created: now };
  for (const [id, pattern] of [['re_4', /re_4: failed, keine Rechnungskorrektur/], ['re_5', /Erstattung ohne Website-Bestellung: re_5/]]) {
    await refundEvent('refund.created', refunds[id]); before = mails.length; await run();
    assert.equal(mails.length, before + 1); assert.equal(mails[before].to[0], 'owner@example.com'); assert.match(mails[before].subject, pattern);
  }
  before = mails.length;
  r = await refundEvent('refund.failed', refunds.re_4);
  assert.equal(mails.length, before + 1); assert.match(mails[before].subject, /ERSTATTUNG FEHLGESCHLAGEN: re_4/);
  // a job that keeps failing: retried, then Sandra is warned
  kv.set('correction:re_broken', JSON.stringify({ refund: 're_broken', attempts: 0 }));
  for (let i = 0; i < INVOICE_TRIES; i++) await run().catch(() => {});
  assert.equal(JSON.parse(kv.get('correction:re_broken')).attempts, INVOICE_TRIES);
  before = mails.length; await run();
  assert.match(mails[before].subject, /RECHNUNGSKORREKTUR FEHLT: Erstattung re_broken/); assert.ok(!kv.has('correction:re_broken'));
  // the customer mail keeps failing: after INVOICE_TRIES the warning to Sandra carries the PDF
  refunds.re_6 = { id: 're_6', amount: 1000, payment_intent: 'pi_1', status: 'succeeded', created: now + 20 };
  await refundEvent('refund.created', refunds.re_6); await run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url) === 'https://api.mailjet.com/v3.1/send' && JSON.parse(init.body).Messages[0].To[0].Email === 'k@example.com') ? new Response('{"ErrorMessage":"test"}', { status: 500 }) : realFetch(url, init);
  for (let i = 0; i < INVOICE_TRIES; i++) await run().catch(() => {});
  before = mails.length; await run();
  globalThis.fetch = realFetch;
  assert.equal(mails.length, before + 1); assert.match(mails[before].subject, /RECHNUNGSKORREKTUR FEHLT: Erstattung re_6/);
  assert.match(mails[before].text, /nicht an die Kundin/); assert.equal(mails[before].attachments[0].Filename, 'astro.strip-Rechnungskorrektur-AS-20261001-PART1-K4.pdf'); // K3 is the failed re_4: numbers stay stable, gaps allowed
  assert.ok(!kv.has('correction:re_6') && !kv.has('correctionpdf:re_6'));
  // the slot tests below count the original bookings
  kv.delete('slots:freed'); sessions.splice(sessions.findIndex(x => x.id === 'cs_part'), 1);
  console.log('correction ok');
}
// bad signature
r = await worker.fetch(req('/api/stripe-webhook', 'POST', evt, { 'Stripe-Signature': `t=${t2},v1=00` }), env);
assert.equal(r.status, 400);

// fill this week's ultra slots -> sold out
assert.equal(sessions[0].metadata.week, String(weekStart()), 'first order books this week');
assert.match(sessions[0].description, /within 10 working days\./);
for (const ip of Array.from({ length: STRIPS.ultra.weekly - 1 }, (_, i) => `2.2.${i}.2`)) { r = await worker.fetch(req('/api/checkout', 'POST', { ...good, week: thisWeek }, { ip }), env); assert.equal(r.status, 200); }
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
for (let i = 0; i < WEEKS_AHEAD * STRIPS.ultra.weekly; i++) {
  r = await worker.fetch(req('/api/slots'), env); const x = (await r.json()).ultra;
  if (!x.next) break;
  r = await worker.fetch(req('/api/checkout', 'POST', { ...good, week: x.next }, { ip: '6.6.' + i + '.1' }), env); assert.equal(r.status, 200);
}
r = await worker.fetch(req('/api/checkout', 'POST', good, { ip: '7.7.7.7' }), env);
out = await r.json();
assert.equal(r.status, 409); assert.equal(out.soldOut, true); assert.match(out.error, new RegExp('fully booked until ' + longDate(sl.ultra.until)));
assert.equal(sessions.filter(s => s.metadata.strip === 'ultra').length, WEEKS_AHEAD * STRIPS.ultra.weekly, 'exactly the weekly limit per week in the window');
// expired open session frees the slot in its week
sessions[1].expires_at = Math.floor(Date.now() / 1000) - 10;
r = await worker.fetch(req('/api/slots'), env);
sl = await r.json();
assert.equal(sl.ultra.left, 1); assert.equal(sl.ultra.next, thisWeek); assert.equal(sl.ultra.thisWeek, true);
// a booking from 7 weeks ago for this week still counts; one from 9 weeks ago does not
{ const w0 = weekStart(); sessions.push({ id: 'cs_old', created: addWeeks(w0, -7) + 100, expires_at: 0, status: 'complete', metadata: { strip: 'maxi', week: String(w0) } });
  sessions.push({ id: 'cs_older', created: addWeeks(w0, -9), expires_at: 0, status: 'complete', metadata: { strip: 'maxi', week: String(w0) } });
  r = await worker.fetch(req('/api/slots'), env); assert.equal((await r.json()).maxi.left, STRIPS.maxi.weekly - 1); }
// rate limit: 5 per hour per IP
for (let i = 0; i < 5; i++) await worker.fetch(req('/api/checkout', 'POST', { ...good, strip: 'mini', lifeArea: '' }, { ip: '9.9.9.9' }), env);
r = await worker.fetch(req('/api/checkout', 'POST', { ...good, strip: 'mini', lifeArea: '' }, { ip: '9.9.9.9' }), env);
assert.equal(r.status, 429);

// withdrawal
mails.length = 0;
r = await worker.fetch(req('/api/withdraw', 'POST', { name: 'Test Person', contract: co.orderId, email: 't@example.com' }), env);
const w = await r.json();
assert.equal(r.status, 200); assert.match(w.received, /Europe\/Berlin/);
assert.equal(mails.length, 2); assert.match(mails[0].text, /Eingegangen: \d+\. \w+ 20\d\d/); assert.match(mails[0].text, /Received: \d+ \w+ 20\d\d/); assert.match(mails[0].text, new RegExp(co.orderId));
assert.ok(mails[0].text.indexOf('Hi Test Person') > mails[0].text.indexOf('Erstattung:'), 'German block first, then English');
assert.match(mails[0].text, /angemessenen Betrag für den Anteil/); assert.match(mails[0].text, /proportionate amount/); assert.match(mails[0].text, /Widerrufsrecht erloschen/);
assert.match(w.receivedEn, /Europe\/Berlin/);
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

// retention: buyer list after 3 years without purchase, consent proof 3 years after the last list ended
{
  const { runRetention, RETENTION_BATCH } = await import('../src/worker.js');
  const now = Date.parse('2030-06-01T12:00:00Z');
  const ago = y => new Date(now - y * 365.25 * 86400000).toISOString();
  const store = new Map();
  const renv = {
    MAILJET_API_KEY: 'k', MAILJET_SECRET_KEY: 's', MAILJET_NEWSLETTER_LIST_ID: '111', MAILJET_CUSTOMER_LIST_ID: '222',
    ORDERS: {
      get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); },
      list: async ({ prefix, cursor, limit }) => {
        const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
        const start = Number(cursor || 0), keys = all.slice(start, start + limit).map(name => ({ name }));
        return { keys, list_complete: start + limit >= all.length, cursor: String(start + limit) };
      },
    },
  };
  const optin = { type: 'newsletter-optin', confirmedAt: ago(6) };
  const buy = y => ({ type: 'customer-7-3-uwg', at: ago(y) });
  const put = (email, ...events) => store.set('consent:' + email, JSON.stringify({ events }));
  // Mailjet state per address: list id -> unsubscribed at (null = subscribed)
  const mj = {
    'active@x.de': { 111: null },                        // newsletter running for 6 years: keep, untouched
    'unsub-old@x.de': { 111: ago(3.2) },                 // unsubscribed > 3 years ago: delete
    'unsub-new@x.de': { 111: ago(1) },                   // unsubscribed 1 year ago: keep, note the end
    'buyer-old@x.de': { 222: null },                     // last purchase 3.5 years ago: remove from list, keep proof
    'buyer-new@x.de': { 222: null },                     // bought 2 years ago: keep
    'buyer-objected@x.de': { 222: ago(4) },              // objected 4 years ago: delete
    'both@x.de': { 111: null, 222: null },               // old buyer, still on newsletter: removed from buyers, proof stays
    'removed@x.de': {},                                  // gone from Mailjet: end noted now, kept 3 more years
  };
  put('active@x.de', optin); put('unsub-old@x.de', optin); put('unsub-new@x.de', optin);
  put('buyer-old@x.de', buy(3.5)); put('buyer-new@x.de', buy(5), buy(2)); put('buyer-objected@x.de', buy(4.5));
  put('both@x.de', optin, buy(4)); put('removed@x.de', optin);
  const removed = []; let calls = 0;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls++;
    const m = url.match(/^https:\/\/api\.mailjet\.com\/v3\/REST\/listrecipient\?ContactEmail=([^&]+)&Limit=100$/);
    if (m) {
      const st = mj[decodeURIComponent(m[1])] || {};
      return new Response(JSON.stringify({ Data: Object.entries(st).map(([id, at]) => ({ ListID: Number(id), IsUnsubscribed: at !== null, UnsubscribedAt: at || '' })) }));
    }
    if (url === 'https://api.mailjet.com/v3/REST/contactslist/222/managecontact') { const b = JSON.parse(init.body); removed.push(b); delete mj[b.Email][222]; return new Response('{}', { status: 201 }); }
    throw new Error('unexpected fetch ' + url);
  };
  store.set('order:cs_x', '{}'); // other keys are never touched
  let res = await runRetention(renv, now);
  assert.equal(res.updated + res.kept + res.deleted, Math.min(RETENTION_BATCH, 8));
  while (store.has('retention:cursor')) res = await runRetention(renv, now);
  const has = e => store.has('consent:' + e);
  assert.ok(has('active@x.de') && !JSON.parse(store.get('consent:active@x.de')).newsletterEndedAt);
  assert.ok(!has('unsub-old@x.de'), 'unsubscribed > 3 years: deleted');
  assert.ok(has('unsub-new@x.de') && JSON.parse(store.get('consent:unsub-new@x.de')).newsletterEndedAt);
  assert.ok(has('buyer-old@x.de') && JSON.parse(store.get('consent:buyer-old@x.de')).customerEndedAt, 'removed buyer keeps proof 3 more years');
  assert.ok(has('buyer-new@x.de') && !JSON.parse(store.get('consent:buyer-new@x.de')).customerEndedAt, 'latest purchase counts');
  assert.ok(!has('buyer-objected@x.de'), 'objection > 3 years: deleted');
  assert.ok(has('both@x.de'), 'newsletter still running');
  assert.ok(has('removed@x.de'));
  assert.deepEqual(removed.map(r => [r.Email, r.Action]).sort(), [['both@x.de', 'remove'], ['buyer-old@x.de', 'remove']]);
  assert.ok(store.has('order:cs_x'));
  // a proof whose end was noted 3+ years ago disappears on a later pass
  const later = now + 3.1 * 365.25 * 86400000;
  while (true) { await runRetention(renv, later); if (!store.has('retention:cursor')) break; }
  for (const e of ['unsub-new@x.de', 'buyer-old@x.de', 'removed@x.de']) assert.ok(!has(e), e + ' deleted after 3 more years');
  assert.ok(has('active@x.de'), 'running newsletter is never deleted');
  assert.ok(has('buyer-new@x.de') && JSON.parse(store.get('consent:buyer-new@x.de')).customerEndedAt, 'buyer-new now 5 years without purchase: removed, proof kept');
  // Mailjet down: nothing is deleted
  put('fail@x.de', optin);
  globalThis.fetch = async () => new Response('err', { status: 500 });
  res = await runRetention(renv, later + 1e12);
  assert.ok(res.failed >= 1 && has('fail@x.de'));
  assert.deepEqual(await runRetention({ ...renv, MAILJET_API_KEY: '' }, now), { skipped: true });
  console.log('retention ok');
}

// website statistics (Sandra, 07.10.2026): anonymous counter, weekly rollup into KV, protected read
{
  const { runStatsRollup } = await import('../src/worker.js');
  const points = [];
  const store = new Map();
  const senv = {
    STATS: { writeDataPoint: p => points.push(p) },
    ORDERS: { get: async k => store.get(k) ?? null, put: async (k, v, o) => { assert.equal(o, undefined, 'rollup kept without expiry'); store.set(k, v); } },
    ASSETS: { fetch: async () => new Response('asset') },
    CF_ACCOUNT_ID: 'acc123', CF_ANALYTICS_READ_TOKEN: 'tok', STATS_READ_KEY: 'readkey',
  };
  const stat = (b, raw, cf = { country: 'DE' }) => { const q = new Request('https://astrostrip.com/api/stat', { method: 'POST', body: raw ?? JSON.stringify(b), headers: { 'CF-Connecting-IP': '9.9.9.9' } }); Object.defineProperty(q, 'cf', { value: cf }); return worker.fetch(q, senv); };
  for (const b of [{ event: 'visit', src: 'ig' }, { event: 'visit', src: 'tt' }, { event: 'visit', src: 'direct' }, { event: 'visit', src: 'evil' }, { event: 'visit' },
    { event: 'click', card: 'mini' }, { event: 'click', card: 'ultra' }, { event: 'click', card: 'giga' }, { event: 'other' }]) {
    assert.equal((await stat(b)).status, 204);
  }
  assert.equal((await stat(null, 'not json')).status, 204, 'broken JSON is ignored');
  assert.equal((await stat(null, 'null')).status, 204, 'JSON null is ignored');
  assert.deepEqual(points.map(p => p.blobs), [['visit', 'ig', 'DE'], ['visit', 'tt', 'DE'], ['visit', 'direct', 'DE'], ['visit', 'direct', 'DE'], ['visit', 'direct', 'DE'], ['click', 'mini'], ['click', 'ultra']]);
  // country (Sandra, 09.10.2026): ISO code from request.cf, anything else = XX; clicks carry no country
  for (const cf of [{ country: 'AT' }, { country: 'T1' }, { country: 'XX' }, {}, null, { country: 'de' }, { country: 'DEU' }]) await stat({ event: 'visit', src: 'ig' }, undefined, cf);
  assert.deepEqual(points.slice(7).map(p => p.blobs[2]), ['AT', 'XX', 'XX', 'XX', 'XX', 'XX', 'XX']);
  assert.ok(!points.slice(7).some(p => JSON.stringify(p).includes('9.9.9.9')));
  assert.ok(!JSON.stringify(points).includes('9.9.9.9'), 'no IP in the data points');
  assert.equal((await worker.fetch(new Request('https://astrostrip.com/api/stat', { method: 'POST', body: '{"event":"visit","src":"ig"}' }), { ...senv, STATS: undefined })).status, 204, 'missing binding: still 204');

  // rollup: Monday 12.10.2026 sums the week 05.–11.10. (Berlin)
  const now = Date.parse('2026-10-12T01:10:00Z');
  const sqls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), 'https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql');
    assert.equal(init.headers.Authorization, 'Bearer tok');
    sqls.push(init.body);
    return new Response(JSON.stringify({ data: [
      { blob1: 'visit', blob2: 'ig', blob3: 'DE', n: '10' }, { blob1: 'visit', blob2: 'ig', blob3: 'LU', n: '1' }, { blob1: 'visit', blob2: 'ig', blob3: 'AT', n: '1' },
      { blob1: 'visit', blob2: 'tt', blob3: 'AT', n: 3 }, { blob1: 'visit', blob2: 'direct', blob3: 'DE', n: '30' }, { blob1: 'visit', blob2: 'direct', blob3: 'AT', n: '1' },
      { blob1: 'visit', blob2: 'direct', blob3: '', n: '6' }, { blob1: 'visit', blob2: 'direct', blob3: 'US', n: '3' },
      { blob1: 'click', blob2: 'maxi', blob3: '', n: '7' }, { blob1: 'click', blob2: 'other', blob3: '', n: '1' }, { blob1: 'x', blob2: 'ig', blob3: 'DE', n: '5' },
    ] }));
  };
  const r = await runStatsRollup(senv, now);
  assert.equal(r.week, '2026-10-05');
  // source summed over all countries; country summed over all sources (never crossed); AT 1+3+1 = 5 stays, LU 1 and US 3 below 5;
  // points without country (before 09.10.2026) count as XX
  assert.deepEqual(JSON.parse(store.get('stats:week:2026-10-05')), { visit: { ig: 12, tt: 3, direct: 40 }, click: { mini: 0, maxi: 7, ultra: 0 },
    country: { DE: 40, AT: 5, XX: 6 }, countryOther: { visits: 4, countries: 2 } });
  assert.ok(sqls[0].includes('GROUP BY blob1, blob2, blob3'));
  const from = Date.parse('2026-10-04T22:00:00Z') / 1000;
  assert.ok(sqls[0].includes(`toDateTime(${from})`) && sqls[0].includes(`toDateTime(${from + 7 * 86400})`), 'Berlin week bounds');
  assert.ok(sqls[0].includes('FROM astrostrip_stats'));
  assert.deepEqual(await runStatsRollup(senv, now + 3600000), { skipped: 'stats:week:2026-10-05' }, 'second run the same week skips');
  assert.equal(sqls.length, 1);
  assert.ok((await runStatsRollup({ ...senv, CF_ACCOUNT_ID: '' }, now + 7 * 86400000)).skipped, 'not configured: skipped');
  globalThis.fetch = async () => new Response('denied', { status: 403 });
  assert.deepEqual(await runStatsRollup(senv, now + 7 * 86400000), { error: 'denied' });
  assert.ok(!store.has('stats:week:2026-10-12'), 'failed query writes nothing');
  globalThis.fetch = realFetch;

  // read: 404 without or with a wrong key, n weeks newest first, empty weeks as {}
  const read = q => worker.fetch(new Request('https://astrostrip.com/api/stats' + q), senv);
  assert.equal((await read('')).status, 404);
  assert.equal((await read('?key=wrong')).status, 404);
  assert.equal((await worker.fetch(new Request('https://astrostrip.com/api/stats?key='), { ...senv, STATS_READ_KEY: '' })).status, 404, 'no key set: closed');
  const last = weekDate(addWeeks(weekStart(Date.now()), -1));
  store.set(`stats:week:${last}`, JSON.stringify({ visit: { ig: 1, tt: 0, direct: 2 }, click: { mini: 0, maxi: 1, ultra: 0 } }));
  let w = (await (await read('?key=readkey')).json()).weeks;
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], { week: last, visit: { ig: 1, tt: 0, direct: 2 }, click: { mini: 0, maxi: 1, ultra: 0 } });
  w = (await (await read('?key=readkey&weeks=3')).json()).weeks;
  assert.deepEqual(w.map(x => x.week), [0, 1, 2].map(i => weekDate(addWeeks(weekStart(Date.now()), -1 - i))));
  assert.deepEqual(w[2], { week: w[2].week, visit: {}, click: {} });
  assert.equal((await (await read('?key=readkey&weeks=99')).json()).weeks.length, 12, 'at most 12 weeks');
  assert.equal((await (await read('?key=readkey&weeks=abc')).json()).weeks.length, 1);
  // the page's counter script: same endpoint, no cookie, no storage
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(page.includes("fetch('/api/stat'"));
  assert.ok(!/document\.cookie|localStorage|sessionStorage/.test(page), 'no cookie or browser storage on the start page');
  console.log('stats ok');
}

// Transit Weekly (Sandra, 11.10.2026): add-on to Maxi/Ultra, booked later with the strip's order number, minutes per
// reading week, own invoice, booking with only the time zone, cancellation button (§ 312k BGB)
{
  globalThis.fetch = stripeMailMock;
  const { TRANSIT, TRANSIT_MAX_AREAS, TIME_CONSENT, validateRebook, mondayOnOrAfter, transitDates, planTransit, afterWithdrawal, withdrawalEnds, INVOICE_CRON, CORRECTION_CRON } = await import('../src/worker.js');
  const { servicePeriod, splitGross } = await import('../src/invoice.js');
  const { berlinYmd } = await import('../src/time.js');
  const runCron = async cron => { const p = []; await worker.scheduled({ cron }, env, { waitUntil: x => p.push(x) }); await Promise.all(p); };
  const signedEvt = async evtBody => {
    const ts = Math.floor(Date.now() / 1000);
    const sg = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${evtBody}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
    return worker.fetch(req('/api/stripe-webhook', 'POST', evtBody, { 'Stripe-Signature': `t=${ts},v1=${sg}` }), env);
  };
  const residence = { label: 'New York, United States', lat: 40.71, lon: -74.01, tz: 'America/New_York' };
  const maxi = { ...good, strip: 'maxi', lifeArea: '', ancestry: false, sensitiveConsent: false, questionnaire: { residence }, transit: { areas: ['Love and relationships', 'Work and calling'], earlyStart: true } };

  // prices: 117 € per area (39 € a month), invoice amounts clean for every possible number of areas
  assert.equal(TRANSIT.cents, 11700); assert.equal(TRANSIT.monthCents * 3, TRANSIT.cents); assert.equal(TRANSIT_MAX_AREAS, 5);
  for (let n = 1; n <= TRANSIT_MAX_AREAS; n++) { const a = splitGross(n * TRANSIT.cents); assert.equal(a.vat, Math.round(a.net * 0.19), `BR-CO-17 for ${n} areas`); assert.equal(a.net % n, 0, `unit price × ${n} = line total`); }

  // validation
  assert.equal(validateOrder(maxi).errors.length, 0, JSON.stringify(validateOrder(maxi).errors));
  assert.deepEqual(validateOrder(maxi).order.transit, { areas: ['Love and relationships', 'Work and calling'], timeConsent: false, tz: 'America/New_York', tzLabel: 'New York' });
  assert.ok(validateOrder({ ...maxi, strip: 'mini' }).errors.some(e => /Maxi or Ultra/.test(e)), 'not with the Mini Strip');
  assert.ok(validateOrder({ ...maxi, questionnaire: {} }).errors.some(e => /where you live now/.test(e)), 'residence required with Transit Weekly');
  assert.equal(validateOrder({ ...maxi, questionnaire: {}, transit: null }).errors.length, 0, 'maxi without Transit Weekly: residence optional');
  assert.ok(validateOrder({ ...maxi, timeSource: 'family' }).errors.some(e => /birth time is not exact/.test(e)), 'family memory needs the confirmation');
  assert.ok(validateOrder({ ...maxi, timeSource: 'approximate' }).errors.some(e => /birth time is not exact/.test(e)), 'approximate needs the confirmation');
  assert.equal(validateOrder({ ...maxi, timeSource: 'approximate', transit: { ...maxi.transit, timeConsent: true } }).order.transit.timeConsent, true);
  assert.equal(validateOrder({ ...maxi, transit: { ...maxi.transit, timeConsent: true } }).order.transit.timeConsent, false, 'exact time: no confirmation stored');
  assert.ok(validateOrder({ ...maxi, transit: { ...maxi.transit, earlyStart: false } }).errors.some(e => /preparing Transit Weekly/.test(e)), 'early-start consent required');
  // two-part reading (Sandra, 11.10.2026): part 1 = emails before day 22, read at once; part 2 from day 15
  { const paid = Date.parse('2026-10-19T10:00:00Z'); assert.equal(withdrawalEnds(paid), '2026-11-02'); assert.equal(afterWithdrawal(paid), '2026-11-03');
    const twWeeks = Array.from({ length: 11 }, (_, i) => addWeeks(weekStart(paid), i)); const empty = { twWeeks, tw: Object.fromEntries(twWeeks.map(w => [w, 0])) };
    const p = planTransit(empty, weekStart(Date.parse('2026-10-28T12:00:00Z')), 1, paid);
    assert.deepEqual([p.readWeek, p.start, p.part1Weeks, p.readWeek2, p.part2From, p.end], ['2026-10-26', '2026-11-02', 2, '2026-11-09', '2026-11-03', '2027-01-31'], 'Maxi paid 19.10.: part 1 from 26.10., first email 02.11., weeks 3–13 in the week from Mon 09.11.');
    const full = { twWeeks, tw: { ...empty.tw, [weekStart(Date.parse('2026-11-09T12:00:00Z'))]: TRANSIT.budget - 20 } };
    assert.notEqual(planTransit(full, weekStart(Date.parse('2026-10-28T12:00:00Z')), 1, paid).readWeek, '2026-10-26', 'part 2 week without room: plan moves on');
    const late = planTransit(empty, addWeeks(weekStart(paid), 4), 2, paid);
    assert.equal(late.readWeek2, null); assert.equal(late.part1Weeks, 13, 'reading week after the withdrawal period: all at once'); }
  assert.ok(validateOrder({ ...maxi, transit: { areas: ['Health'], earlyStart: true } }).errors.some(e => /life areas for Transit Weekly/.test(e)));
  assert.ok(validateOrder({ ...maxi, transit: { areas: [...Array(6)].map((_, i) => ['Love and relationships', 'Work and calling', 'Money and self-worth', 'Home and family', 'Creativity and self-expression', 'Friends and belonging'][i]), earlyStart: true } }).errors.some(e => /at most 5/.test(e)));
  assert.match(TIME_CONSENT.en, /^I understand that my birth time is not exact/); assert.match(TIME_CONSENT.de, /^Mir ist klar/);
  const html = readFileSync(new URL('../public/order.html', import.meta.url), 'utf8') + readFileSync(new URL('../public/transit-weekly.html', import.meta.url), 'utf8');
  assert.equal(html.split(TIME_CONSENT.en.replace('100 %', '100&nbsp;%')).length, 3, 'confirmation wording on both pages = the stored proof text');

  kv.set('twfounding:count', '12'); // founding places used up: full price in the flow below; founding price tested at the end
  // checkout Maxi + 2 areas: reading week = Monday on or after the strip's delivery deadline, first email the Monday after
  let r = await worker.fetch(req('/api/checkout', 'POST', maxi, { ip: '10.0.0.1' }), env);
  let out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  const s1 = sessions[sessions.length - 1];
  const stored = JSON.parse(kv.get('order:' + s1.id));
  const deadline = servicePeriod(stored, STRIPS.maxi, berlinYmd(Date.now())).end;
  const read = weekStart(Date.parse(deadline + 'T12:00:00Z'));
  assert.equal(stored.transit.withdrawalEnds, withdrawalEnds(Date.now()));
  assert.deepEqual({ readWeek: stored.transit.readWeek, start: stored.transit.start, end: stored.transit.end }, transitDates(read));
  assert.ok(stored.transit.readWeek2 ? Number(s1.metadata.tw_week2) === mondayOnOrAfter(stored.transit.readWeek2) : !s1.metadata.tw_week2, 'second reading week in the metadata');
  assert.equal(new Date(stored.transit.start + 'T12:00:00Z').getUTCDay(), 1); assert.equal(new Date(stored.transit.end + 'T12:00:00Z').getUTCDay(), 0, 'term ends on a Sunday');
  assert.equal((Date.parse(stored.transit.end) - Date.parse(stored.transit.start)) / 86400000, 13 * 7 - 1, '13 weeks');
  assert.equal(s1.metadata.tw_week, String(read)); assert.equal(s1.metadata.tw_n, '2'); assert.equal(s1.metadata.strip, 'maxi');
  const p1 = new URLSearchParams(s1.body);
  assert.equal(p1.get('line_items[1][quantity]'), '2'); assert.equal(p1.get('line_items[1][price_data][unit_amount]'), '11700');
  assert.match(p1.get('custom_text[submit][message]'), /the Maxi Strip and Transit Weekly \(2 life areas\) \(313,00 € incl\. 19 % VAT\)/);
  assert.equal(p1.get('payment_intent_data[metadata][tw_n]'), '2');
  assert.ok(!s1.body.includes('1990-05-01') && !s1.body.includes('New York') && !s1.body.includes('America'), 'no birth data or residence at Stripe');
  // minutes: 300 per reading week; 60 per area, split 20 (part 1) / 40 (part 2) -> until a week is full, then later
  const four = { ...maxi, transit: { areas: ['Love and relationships', 'Work and calling', 'Money and self-worth', 'Home and family'], earlyStart: true } };
  const plans = [];
  for (let i = 0; i < 4; i++) {
    r = await worker.fetch(req('/api/checkout', 'POST', four, { ip: `10.0.0.${10 + i}` }), env); assert.equal(r.status, 200);
    const md = sessions[sessions.length - 1].metadata; plans.push(`${md.tw_week}/${md.tw_week2 || ''}`);
  }
  const used = {};
  for (const s of sessions.filter(x => x.metadata.tw_n)) { const n = Number(s.metadata.tw_n); if (s.metadata.tw_week2) { used[s.metadata.tw_week] = (used[s.metadata.tw_week] || 0) + n * 20; used[s.metadata.tw_week2] = (used[s.metadata.tw_week2] || 0) + n * 40; } else used[s.metadata.tw_week] = (used[s.metadata.tw_week] || 0) + n * 60; }
  assert.ok(Object.values(used).every(m => m <= TRANSIT.budget), 'never more than 300 minutes in a week: ' + JSON.stringify(used));
  assert.notEqual(plans[0], plans[3], 'full weeks push later bookings to later weeks');
  sessions.splice(sessions.length - 4, 4); // keep the counts simple below

  // payment -> mails, booking (time zone only), two invoices
  s1.status = 'complete'; s1.payment_status = 'paid'; s1.payment_intent = 'pi_tw';
  s1.customer_details = { name: 'Test Person', email: 't@example.com', address: { line1: 'Teststraße 5', postal_code: '20149', city: 'Hamburg', country: 'DE' } };
  pis.pi_tw = { id: 'pi_tw', status: 'succeeded', amount: 31300, created: s1.created, latest_charge: { refunded: false }, metadata: { order_id: stored.id, strip: 'maxi', tw_n: '2', tw_week: String(read) } };
  let before = mails.length;
  r = await signedEvt(JSON.stringify({ type: 'checkout.session.completed', data: { object: s1 } }));
  assert.equal(await r.text(), 'ok');
  const [mOrder, mReading, mCustomer] = mails.slice(before);
  // customer emails in the weekly-mail design, with a way to book more (Sandra, 11.10.2026)
  assert.match(mCustomer.text, /Want another life area or 13 more weeks\? Book at https:\/\/astrostrip\.com\/transit-weekly\.html with your order number AS-/);
  assert.match(mCustomer.html, /<meta name="color-scheme" content="light">/); assert.match(mCustomer.html, />Order confirmation</);
  assert.match(mCustomer.html, /href="https:\/\/astrostrip\.com\/transit-weekly\.html"[^>]*>Add or renew Transit Weekly</, 'button to book more');
  assert.ok(!/<img|prefers-color-scheme/.test(mCustomer.html), 'no images, light only');
  for (const l of ['Widerrufsbelehrung (Deutsch)', 'Model withdrawal form', CANCELLATION_POLICY.de[1], CANCELLATION_POLICY.en[1]]) assert.ok(mCustomer.html.includes(l.replace(/&/g, '&amp;')), 'legal text complete: ' + l.slice(0, 40));
  { const { brandFromText } = await import('../src/worker.js');
    const h = brandFromText('Hi Ann,\n\nthanks.\n\n\nHallo Ann,\n\nReceived: today\nName: Ann\n\nastro.strip · Sandra Willuweit · Bundesweg 4', { kicker: 'Test · Kicker', attach: 'PDF' });
    assert.match(h, /<h1[^>]*>Hi Ann,<\/h1>/); assert.match(h, />Received<\/td>/); assert.match(h, /Attached · Anhang/); assert.equal((h.match(/Bundesweg 4/g) || []).length, 1, 'address only in the footer'); }
  assert.match(mOrder.subject, /Maxi Strip und Transit Weekly \(2 Lebensbereiche\)/);
  assert.match(mOrder.text, /Transit Weekly: 2 × 117,00 € = 234,00 € inkl\. 19 % USt/); assert.match(mOrder.text, /Preis gesamt: 313,00 €/);
  assert.match(mOrder.text, new RegExp(`Rechnungen: zwei.*${stored.id}-T`)); assert.match(mOrder.text, /Lesewoche ab Montag/);
  assert.match(mReading.text, /Zeitzone \(Wohnort, gilt die ganze Laufzeit\): America\/New_York · in den Mails „New York“ · Rechner: --wohn-tz America\/New_York/);
  assert.match(mReading.text, /Lebensbereiche: Love and relationships, Work and calling/); assert.match(mReading.text, /Lesen in zwei Teilen: Teil 1 \(Wochen 1–\d\)|Lesewoche ab .*alle 13 Wochen/); assert.match(mReading.text, /Geburtszeit: genau/);
  assert.ok(!mReading.text.includes('t@example.com') && !mReading.text.includes('Test Person'), 'reading mail stays pseudonymous');
  assert.match(mCustomer.subject, /Your Maxi Strip and Transit Weekly \(2 life areas\) order/);
  assert.match(mCustomer.text, /Times in the emails are New York time/); assert.match(mCustomer.text, /cancel\.html; notice takes effect at the end of the 13 weeks/);
  assert.match(mCustomer.text, /Price: 313,00 € including 19 % VAT/); assert.match(mCustomer.text, /start preparing Transit Weekly before the withdrawal period ends/);
  const bkKey = `tw:${stored.id}:${stored.id}`;
  const bk = JSON.parse(kv.get(bkKey));
  assert.deepEqual(Object.keys(bk).sort(), ['areas', 'base', 'bookedAt', 'email', 'end', 'exactTime', 'expiration', 'language', 'order', 'part1Weeks', 'readWeek', 'readWeek2', 'start', 'tz', 'tzLabel'].sort());
  assert.ok(!kv.get(bkKey).includes('1990') && !kv.get(bkKey).includes('United States') && !kv.get(bkKey).includes('Test Person'), 'booking: no birth data, no city, no name');
  assert.equal(bk.expiration, Math.floor(Date.parse(bk.end + 'T12:00:00Z') / 1000) + 15 * 86400, 'kept until 14 days after the term');
  assert.ok(kv.has(`invoice:${stored.id}`) && kv.has(`invoice:${stored.id}-T`), 'strip invoice and Transit Weekly invoice');
  before = mails.length;
  for (let i = 0; i < 6; i++) await runCron(INVOICE_CRON);
  const twInv = mails.slice(before).find(m => m.to[0] === 't@example.com' && m.subject.includes(`${stored.id}-T`));
  assert.ok(twInv, 'Transit Weekly invoice mailed'); assert.match(twInv.text, /invoice for your Transit Weekly/);
  const twXml = Buffer.from(twInv.attachments[0].Base64Content, 'base64').toString('utf8');
  assert.ok(twXml.includes('<ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>') && twXml.includes('<ram:ChargeAmount>98.32</ram:ChargeAmount>') && twXml.includes('<ram:LineTotalAmount>196.64</ram:LineTotalAmount>') && twXml.includes('<ram:GrandTotalAmount>234.00</ram:GrandTotalAmount>'), 'quantity 2 × 98,32 € net');
  assert.ok(twXml.includes(`<udt:DateTimeString format="102">${stored.transit.start.replace(/-/g, '')}</udt:DateTimeString>`) && twXml.includes('wöchentliche persönliche Transite'), 'service period = the 13 weeks');
  assert.match(pis.pi_tw.metadata.tw_invoice_date, /^\d{4}-\d{2}-\d{2}$/); assert.match(pis.pi_tw.metadata.invoice_date, /^\d{4}-\d{2}-\d{2}$/, 'both invoice dates kept apart');

  // booking later: order number + email must match a paid, unrefunded Maxi/Ultra at Stripe
  const later = { baseOrder: stored.id, email: 'T@example.com', name: 'Test Person', birthDate: '1990-05-01', birthTime: '08:15', timeSource: 'certificate', place: good.place, residence, language: 'de', transit: { areas: ['Personal growth'], earlyStart: true }, acceptTerms: true };
  assert.equal(validateRebook(later).errors.length, 0, JSON.stringify(validateRebook(later).errors));
  assert.ok(validateRebook({ ...later, residence: null }).errors.some(e => /where you live now/.test(e)));
  assert.ok(validateRebook({ ...later, baseOrder: 'AS-123' }).errors.some(e => /order number/.test(e)));
  r = await worker.fetch(req('/api/transit-weekly', 'POST', { ...later, email: 'other@example.com' }, { ip: '10.0.1.1' }), env);
  assert.equal(r.status, 400); assert.match((await r.json()).error, /could not find a paid Maxi or Ultra Strip/, 'wrong email: same answer as an unknown number');
  r = await worker.fetch(req('/api/transit-weekly', 'POST', later, { ip: '10.0.1.2' }), env);
  out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  const s2 = sessions[sessions.length - 1];
  assert.equal(s2.metadata.strip, 'transit'); assert.equal(s2.metadata.base, stored.id); assert.equal(s2.metadata.tw_n, '1');
  assert.equal(new URLSearchParams(s2.body).get('line_items[0][price_data][unit_amount]'), '11700');
  assert.match(new URLSearchParams(s2.body).get('cancel_url'), /transit-weekly\.html\?cancelled=1$/);
  const st2 = JSON.parse(kv.get('order:' + s2.id));
  assert.equal(st2.transit.readWeek, weekDate(weekStart(Date.now() + 3 * 86400000)), 'booked later: this week if three days are left, else next week');
  // renewal of a running area: seamless, the Monday after the old term
  r = await worker.fetch(req('/api/transit-weekly', 'POST', { ...later, transit: { areas: ['Love and relationships'], earlyStart: true } }, { ip: '10.0.1.3' }), env);
  out = await r.json();
  if (r.status === 200) assert.equal(JSON.parse(kv.get('order:' + sessions[sessions.length - 1].id)).transit.start, weekDate(mondayOnOrAfter(bk.end)), 'renewal starts right after the old term');
  else { assert.equal(r.status, 409); assert.match(out.error, /You can renew it from/); }
  // refunded or too old: no booking
  pis.pi_old = { id: 'pi_old', status: 'succeeded', created: Math.floor(Date.parse('2021-06-01') / 1000), latest_charge: { refunded: false }, metadata: { order_id: 'AS-20210601-OLD01', strip: 'ultra' } };
  r = await worker.fetch(req('/api/transit-weekly', 'POST', { ...later, baseOrder: 'AS-20210601-OLD01' }, { ip: '10.0.1.4' }), env);
  assert.equal(r.status, 400); assert.match((await r.json()).error, /too old/);
  pis.pi_tw.latest_charge.refunded = true;
  r = await worker.fetch(req('/api/transit-weekly', 'POST', later, { ip: '10.0.1.5' }), env);
  assert.equal(r.status, 400, 'fully refunded strip');
  pis.pi_tw.latest_charge.refunded = false;
  // paid later booking: own invoice with the order number, reading mail without the questionnaire
  s2.status = 'complete'; s2.payment_status = 'paid'; s2.payment_intent = 'pi_tw2'; s2.customer_details = s1.customer_details;
  pis.pi_tw2 = { id: 'pi_tw2', status: 'succeeded', amount: 11700, created: s2.created, metadata: { order_id: st2.id, strip: 'transit', tw_n: '1', base: stored.id } };
  before = mails.length;
  await signedEvt(JSON.stringify({ type: 'checkout.session.completed', data: { object: s2 } }));
  assert.match(mails[before].text, new RegExp(`Nachgebucht zu Bestellung ${stored.id}`)); assert.match(mails[before + 1].text, /Wohnort heute: New York/); assert.ok(!/Beruf:/.test(mails[before + 1].text));
  assert.match(mails[before + 2].text, new RegExp(`Booked for the reading of your order ${stored.id}`)); assert.ok(!/Delivery:/.test(mails[before + 2].text));
  assert.ok(kv.has(`tw:${stored.id}:${st2.id}`) && kv.has(`invoice:${st2.id}`) && !kv.has(`invoice:${st2.id}-T`));

  // cancellation button: confirmation with content, date and time of receipt and the end of the contract
  before = mails.length;
  r = await worker.fetch(req('/api/cancel', 'POST', { name: 'Test Person', contract: stored.id, email: 't@example.com', kind: 'ordinary' }, { ip: '10.0.2.1' }), env);
  out = await r.json();
  assert.equal(r.status, 200); assert.match(out.received, /Europe\/Berlin/); assert.match(out.endDe, /zum Ende der Laufzeit am/);
  assert.equal(mails.length, before + 2); assert.match(mails[before].subject, /Eingangsbestätigung Kündigung/); assert.match(mails[before].text, /Art der Kündigung: ordentliche Kündigung/); assert.match(mails[before].text, /Der Vertrag endet: zum Ende der Laufzeit am/); assert.match(mails[before].text, /Eingegangen: \d+\. \w+ 20\d\d/);
  assert.match(mails[before + 1].subject, /^KÜNDIGUNG eingegangen: /); assert.match(mails[before + 1].text, /Buchung gefunden/);
  assert.equal(JSON.parse(kv.get(bkKey)).notice.kind, 'ordinary', 'notice noted at the booking');
  assert.equal(JSON.parse(kv.get(`tw:${stored.id}:${st2.id}`)).notice.kind, 'ordinary', 'strip order number: noted at all its bookings');
  r = await worker.fetch(req('/api/cancel', 'POST', { name: 'Test Person', contract: stored.id, email: 't@example.com', kind: 'extraordinary' }, { ip: '10.0.2.2' }), env);
  assert.equal(r.status, 400, 'good cause needs a reason');
  r = await worker.fetch(req('/api/cancel', 'POST', { name: 'Someone', contract: 'AS-20990101-NOPE1', email: 'x@example.com', kind: 'extraordinary', reason: 'Moving abroad' }, { ip: '10.0.2.3' }), env);
  out = await r.json(); assert.equal(r.status, 200); assert.match(out.endDe, /mit sofortiger Wirkung/);
  const cancelHtml = readFileSync(new URL('../public/cancel.html', import.meta.url), 'utf8');
  assert.ok(cancelHtml.includes('Verträge hier kündigen') && cancelHtml.includes('JETZT KÜNDIGEN'), '§ 312k wording of both buttons');
  for (const page of ['index', 'order', 'terms', 'datenschutz', 'impressum', 'cancellation', 'withdraw', 'thanks', 'newsletter', 'transit-weekly']) {
    assert.ok(readFileSync(new URL(`../public/${page}.html`, import.meta.url), 'utf8').includes('href="cancel.html">Verträge hier kündigen'), `cancellation button on ${page}`);
  }

  // refund of strip + Transit Weekly in one payment: Sandra corrects by hand, slot and minutes are freed
  const leftBefore = await (await worker.fetch(req('/api/slots'), env)).json();
  refunds.re_tw = { id: 're_tw', amount: 31300, payment_intent: 'pi_tw', status: 'succeeded', created: Math.floor(Date.now() / 1000) };
  await signedEvt(JSON.stringify({ type: 'refund.created', data: { object: refunds.re_tw } }));
  before = mails.length;
  await runCron(CORRECTION_CRON);
  assert.equal(mails.length, before + 1); assert.match(mails[before].subject, /Rechnungskorrektur bitte von Hand/); assert.match(mails[before].text, /Wochenplatz und Transit-Minuten sind wieder frei/);
  assert.equal(JSON.parse(kv.get(bkKey)).stopped?.reason, 'refund', 'fully refunded strip + Transit Weekly: no more weekly emails'); assert.match(mails[before].text, /Voll erstattet: Transit Weekly wird nicht mehr verschickt/);
  assert.equal(kvMeta.get(bkKey).x, 'refund', 'stop also in the list summary');
  const freed = JSON.parse(kv.get('slots:freed'));
  assert.equal(freed.filter(f => f.s === 'transit' && f.n === 2).reduce((a, f) => a + f.m, 0), 2 * TRANSIT.minutes, 'all Transit Weekly minutes freed');
  assert.equal((await (await worker.fetch(req('/api/slots'), env)).json()).maxi.left, leftBefore.maxi.left + (leftBefore.maxi.thisWeek ? 1 : 0), 'strip slot freed');
  // full refund of a later booking: automatic correction, booking deleted at once
  refunds.re_tw2 = { id: 're_tw2', amount: 11700, payment_intent: 'pi_tw2', status: 'succeeded', created: Math.floor(Date.now() / 1000) };
  await signedEvt(JSON.stringify({ type: 'refund.created', data: { object: refunds.re_tw2 } }));
  before = mails.length;
  for (let i = 0; i < 3; i++) await runCron(CORRECTION_CRON);
  assert.match(mails[before].subject, new RegExp(`Your invoice correction ${st2.id}-K1`)); assert.match(mails[before].text, /for your Transit Weekly/);
  assert.match(mails[before + 1].text, /Transit-Minuten der Lesewoche sind wieder frei/);
  assert.ok(!kv.has(`tw:${stored.id}:${st2.id}`), 'refunded booking deleted');
  // Monday reading list for Sandra: due parts and first emails of the week, pseudonymous
  { const { readingList, runReadingList } = await import('../src/worker.js');
    const b = { order: 'AS-20261019-AAAAA', base: 'AS-20261019-AAAAA', email: 'x@example.com', areas: ['Love and relationships'], readWeek: '2026-10-26', readWeek2: '2026-11-09', part1Weeks: 2, start: '2026-11-02', end: '2027-01-31' };
    assert.match(readingList([b], '2026-10-26')[0], /Teil 1, Wochen 1–2 · fertig vor der ersten Mail am 2026-11-02/);
    assert.match(readingList([b], '2026-11-02')[0], /erste Wochenmail am 2026-11-02/);
    assert.match(readingList([b], '2026-11-09')[0], /Teil 2, Wochen 3–13 · fertig vor der Mail am 2026-11-16 · Vorlage von der Montags-Routine/);
    assert.equal(readingList([b], '2026-11-16').length, 0);
    assert.ok(!readingList([b], '2026-10-26').join().includes('x@example.com'), 'no email address in the list');
    const before = mails.length;
    const res = await runReadingList(env, Date.parse(bk.readWeek + 'T08:00:00Z'));
    assert.ok(res.rows >= 1); assert.match(mails[before].subject, /^Lesezettel Transit Weekly/); assert.equal(mails[before].to[0], 'owner@example.com');
    assert.equal((await runReadingList(env, Date.parse('2030-01-07T08:00:00Z'))).rows, 0, 'nothing due: no mail'); assert.equal(mails.length, before + 1); }
  // Founding price (Sandra, 11.10.2026): first 12 bookings 29 € a month / 87 € per area, then 39 €; the page shows only the places left
  { const { twPrice, TW_FOUNDING, invoiceProduct } = await import('../src/worker.js');
    assert.deepEqual(TW_FOUNDING, { cents: 8700, monthCents: 2900, places: 12 }); assert.equal(TW_FOUNDING.monthCents * 3, TW_FOUNDING.cents);
    for (let n = 1; n <= TRANSIT_MAX_AREAS; n++) { const a = splitGross(n * TW_FOUNDING.cents); assert.equal(a.vat, Math.round(a.net * 0.19), `founding BR-CO-17 for ${n}`); assert.equal(a.net % n, 0, `founding unit × ${n}`); }
    kv.delete('twfounding:count');
    assert.deepEqual(await twPrice(env), { cents: 8700, monthCents: 2900, founding: true, left: 12 }, 'start: 12 places');
    kv.set('twfounding:count', '11');
    let pr = await (await worker.fetch(req('/api/transit-price'), env)).json();
    assert.deepEqual(pr, { cents: 8700, monthCents: 2900, founding: true, left: 1 });
    const rf = await worker.fetch(req('/api/checkout', 'POST', maxi, { ip: '10.0.0.77' }), env); assert.equal(rf.status, 200);
    const sf = sessions[sessions.length - 1]; const pf = new URLSearchParams(sf.body);
    assert.equal(pf.get('line_items[1][price_data][unit_amount]'), '8700'); assert.equal(sf.metadata.tw_unit, '8700');
    assert.match(pf.get('line_items[1][price_data][product_data][name]'), /founding price/);
    assert.match(pf.get('custom_text[submit][message]'), /\(253,00 € incl\. 19 % VAT\)/);
    const of = JSON.parse(kv.get('order:' + sf.id)); assert.equal(of.transit.unitCents, 8700); assert.equal(of.transit.founding, true);
    Object.assign(sf, { status: 'complete', payment_status: 'paid', payment_intent: 'pi_tf', customer_details: { ...s1.customer_details } });
    const bf = mails.length;
    assert.equal(await (await signedEvt(JSON.stringify({ type: 'checkout.session.completed', data: { object: sf } }))).text(), 'ok');
    assert.ok(mails.slice(bf).some(m => /Transit Weekly: 2 × 87,00 € \(Founding-Preis\) = 174,00 €/.test(m.text)), 'owner mail: founding price');
    assert.ok(mails.slice(bf).some(m => /87,00 € per area for 13 weeks, 29,00 € a month, founding price/.test(m.text)), 'customer mail: founding price');
    assert.equal(kv.get('twfounding:count'), '12', 'place counted');
    const job = JSON.parse(kv.get(`invoice:${of.id}-T`)); assert.equal(job.order.unit, 8700); assert.equal(invoiceProduct(job.order).cents, 17400);
    pr = await (await worker.fetch(req('/api/transit-price'), env)).json();
    assert.deepEqual(pr, { cents: 11700, monthCents: 3900, founding: false, left: 0 }, 'sold out: 39 €');
    for (const k of [...kv.keys()]) if (k.includes(of.id)) kv.delete(k); // leave the queues below as they were
    for (const k of [...kvMeta.keys()]) if (k.includes(of.id)) kvMeta.delete(k);
    sessions.pop(); }
  console.log('transit weekly ok');

  // Stufe 6 (Sandra, 11.10.2026): approved texts uploaded with a key, sent Monday 07:00 in the customer's time zone
  // (send time from the Mac script), in portions, logged without text and address; never an empty mail
  { const { runTwMails, runTwFriday, twFridayNoon, twMeta, weeklyMail, weekRange, TW_SEND_BATCH } = await import('../src/worker.js');
    env.TW_UPLOAD_KEY = 'up_key_test';
    const B = { order: 'AS-20261019-BBBBB', base: 'AS-20261019-BBBBB', email: 'tw@example.com', language: 'en', areas: ['Love and relationships', 'Work and calling'], tz: 'America/New_York', tzLabel: 'New York', exactTime: true, readWeek: '2026-10-26', readWeek2: '2026-11-09', part1Weeks: 2, start: '2026-11-02', end: '2027-01-31', expiration: 1900000000 };
    const bKey = `tw:${B.base}:${B.order}`;
    await env.ORDERS.put(bKey, JSON.stringify(B), { expiration: B.expiration, metadata: twMeta(B) });
    const md = '# Your week in love\n*November 2 to 8, 2026*\n\nThis week is about **depth**, not new questions. ' + 'A steady, quiet stretch. '.repeat(12) + '\n\n## The testing force\n\n- **Wednesday: Give your gut room.**';
    const ny7 = ymd => Date.parse(ymd + 'T12:00:00Z'); // 07:00 New York (EST) = 12:00 UTC
    const up = (b, k = 'up_key_test') => worker.fetch(req('/api/tw-texts', 'POST', b, { Authorization: `Bearer ${k}` }), env);
    assert.equal((await up({ order: B.order, action: 'status' }, 'wrong')).status, 404, 'wrong key = 404');
    assert.equal((await worker.fetch(req('/api/tw-texts', 'POST', { order: B.order }), env)).status, 404, 'no key = 404');
    let r = await up({ order: B.order, texts: [
      { area: 'love', week: 1, sendAt: ny7('2026-11-02'), text: md }, { area: 'work', week: 1, sendAt: ny7('2026-11-02'), text: md },
      { area: 'growth', week: 1, sendAt: ny7('2026-11-02'), text: md }, { area: 'love', week: 2, sendAt: ny7('2026-11-02'), text: md },
      { area: 'love', week: 3, sendAt: ny7('2026-11-16'), text: md + ' Write to me@example.com' },
    ] });
    let o = await r.json();
    assert.equal(r.status, 200); assert.deepEqual(o.stored, ['love Woche 1', 'work Woche 1']);
    assert.equal(o.skipped.length, 3); assert.match(o.skipped.join(), /nicht gebucht/); assert.match(o.skipped.join(), /Versandzeit passt nicht/); assert.match(o.skipped.join(), /E-Mail-Adresse/);
    assert.ok(o.missing.includes('love 2') && !o.missing.includes('love 1'), 'missing weeks reported');
    assert.equal((await runTwMails(env, ny7('2026-11-02') - 3600000)).due, 0, 'nothing before 07:00 local');
    let before = mails.length;
    let res = await runTwMails(env, ny7('2026-11-02') + 300000);
    assert.equal(res.sent, 2); assert.equal(mails.length, before + 2);
    const m = mails[before];
    assert.deepEqual(m.to, ['tw@example.com']); assert.equal(m.subject, 'Your week in love, stripped down · Nov 2–8');
    // Design B "Papier", light only (Sandra, 11.10.2026)
    assert.match(m.html, /<meta name="color-scheme" content="light">/); assert.ok(!/prefers-color-scheme|<img|https?:\/\/(?!astrostrip\.com)/.test(m.html), 'no dark styles, no images, no foreign links');
    assert.match(m.html, />Transit Weekly<\/p>\s*<p[^>]*>Love and relationships<\/p>/, 'head: two lines');
    assert.match(m.html, /<h1[^>]*>Your week in love<\/h1>/); assert.match(m.html, /<strong[^>]*>depth<\/strong>/); assert.match(m.html, /font-style:italic[^>]*>November 2 to 8, 2026</);
    assert.match(m.html, /Week 1 of 13</); assert.match(m.html, /Times in this email are New York time\./); assert.match(m.html, /href="https:\/\/astrostrip\.com\/cancel"/);
    { const h = weeklyMail(B, 'Love and relationships', 1, md + '\n\n*Most noticeable: Friday.*\n\n## What matters most this week\n\n- **Friday: Rest.** One line.\n- **Sunday: Show up.**').html;
      assert.match(h, /font-style:italic;color:#7A5C25;">Most noticeable: Friday\.</, 'italic line alone');
      assert.match(h, /border:1px solid #C9B48A;"><tr><td[^>]*><p[^>]*>What matters most this week<\/p>[\s\S]*&#10022;[\s\S]*Friday: Rest\.<\/strong> One line\.[\s\S]*Sunday: Show up/, 'last section boxed'); } assert.ok(!/[*#]{1,2}\w/.test(m.html.replace(/#[0-9A-Fa-f]{6}|&#\d+;/g, '')), 'no Markdown marks in HTML');
    assert.ok(m.html.length < 102000 / 3, 'far below the Gmail clip');
    assert.match(m.text, /^YOUR WEEK IN LOVE\nNovember 2 to 8, 2026\n/); assert.ok(!/[*#]/.test(m.text), 'no Markdown marks');
    assert.match(m.text, /Week 1 of 13\.\nTimes in this email are New York time\./); assert.match(m.text, /astrostrip\.com\/cancel/);
    const log = JSON.parse(kv.get(`twlog:2026-11-02:${B.order}:love`));
    assert.equal(log.result, 'sent'); assert.ok(log.id);
    { const { twLogExpiry } = await import('../src/worker.js'); assert.equal(new Date(twLogExpiry('2027-01-31') * 1000).toISOString().slice(0, 10), '2031-01-01', 'log: 3 years from the end of the term year'); } assert.ok(!JSON.stringify(log).includes('example.com') && !JSON.stringify(log).includes('depth'), 'log without address and text');
    assert.equal((await runTwMails(env, ny7('2026-11-02') + 600000)).due, 0, 'never twice');
    o = await (await up({ order: B.order, texts: [{ area: 'love', week: 1, sendAt: ny7('2026-11-02'), text: md }] })).json();
    assert.match(o.skipped[0], /schon verschickt/);
    // German booking: German subject and time zone line
    assert.equal(weeklyMail({ ...B, language: 'de', tzLabel: 'Berlin' }, 'Work and calling', 4, md).subject, 'Deine Woche im Beruf, stripped down · 23.–29. November');
    assert.match(weeklyMail({ ...B, language: 'de', tzLabel: 'Berlin' }, 'Work and calling', 4, md).html, /Du bekommst diese Mail, weil du Transit Weekly gebucht hast\. <a[^>]*>Verträge hier kündigen<\/a>/);
    { const { weeklySubject } = await import('../src/worker.js'); assert.equal(weeklySubject('Home and family', '2026-10-19', false), 'Your week at home, stripped down · Oct 19–25'); }
    assert.match(weeklyMail({ ...B, language: 'de', tzLabel: 'Berlin' }, 'Work and calling', 4, md).text, /Woche 4 von 13\.\nDie Zeiten in dieser Mail gelten für Berlin\./);
    assert.equal(weekRange('2026-10-26'), 'Oct 26 – Nov 1'); assert.equal(weekRange('2026-10-26', 'de'), '26. Oktober – 1. November');
    // stopped by Sandra: no mail, logged; resumed later
    assert.equal((await (await up({ order: B.order, action: 'stop' })).json()).stopped, 'manual');
    await up({ order: B.order, texts: [{ area: 'love', week: 2, sendAt: ny7('2026-11-09'), text: md }] });
    before = mails.length;
    res = await runTwMails(env, ny7('2026-11-09') + 60000);
    assert.equal(res.stopped, 1); assert.equal(mails.length, before, 'stopped: no mail');
    assert.equal(JSON.parse(kv.get(`twlog:2026-11-09:${B.order}:love`)).result, 'stopped');
    assert.equal((await (await up({ order: B.order, action: 'resume' })).json()).stopped, null);
    // Friday 12:00 Berlin: warning about week 3 (love missing, work there)
    await up({ order: B.order, texts: [{ area: 'work', week: 3, sendAt: ny7('2026-11-16'), text: md }] });
    assert.equal(twFridayNoon(Date.parse('2026-11-13T11:30:00Z')), true); assert.equal(twFridayNoon(Date.parse('2026-11-13T12:30:00Z')), false);
    before = mails.length;
    res = await runTwFriday(env, Date.parse('2026-11-13T11:30:00Z'));
    assert.equal(res.missing, 1); assert.equal(mails[before].to[0], 'owner@example.com');
    assert.match(mails[before].text, /AS-20261019-BBBBB · Love and relationships · Woche 3/); assert.ok(!mails[before].text.includes('tw@example.com'));
    // a text more than a week late is not sent any more
    before = mails.length;
    res = await runTwMails(env, ny7('2026-11-16') + 8 * 86400000);
    assert.equal(res.expired, 1); assert.equal(mails.length, before);
    // Monday list: last week's balance, the missing love text logged as not sent
    before = mails.length;
    await (await import('../src/worker.js')).runReadingList(env, Date.parse('2026-11-23T02:00:00Z'));
    const lz = mails.slice(before).find(x => /^Lesezettel/.test(x.subject));
    assert.match(lz.text, /Letzte Woche nicht verschickt, Text fehlte[^]*AS-20261019-BBBBB · Love and relationships · Woche 3/);
    assert.match(lz.text, /Wochenmails letzte Woche: 0 verschickt, 1 verfallen \(Text zu spät\), 1 nicht verschickt \(Text fehlte\)\./);
    assert.equal(JSON.parse(kv.get(`twlog:2026-11-16:${B.order}:love`)).result, 'missing');
    // portions: 10 due mails, 8 in the first run, 2 in the next
    const C = { ...B, order: 'AS-20261019-CCCCC', base: 'AS-20261019-CCCCC', areas: ['Love and relationships', 'Work and calling', 'Money and self-worth', 'Home and family', 'Personal growth'], start: '2026-12-07', end: '2027-03-07' };
    const D = { ...C, order: 'AS-20261019-DDDDD', base: 'AS-20261019-DDDDD' };
    for (const X of [C, D]) {
      await env.ORDERS.put(`tw:${X.base}:${X.order}`, JSON.stringify(X), { metadata: twMeta(X) });
      await up({ order: X.order, texts: ['love', 'work', 'money', 'home', 'growth'].map(a => ({ area: a, week: 1, sendAt: ny7('2026-12-07'), text: md })) });
    }
    res = await runTwMails(env, ny7('2026-12-07') + 60000);
    assert.equal(res.sent, TW_SEND_BATCH); assert.equal(res.left, 10 - TW_SEND_BATCH);
    assert.equal((await runTwMails(env, ny7('2026-12-07') + 400000)).sent, 10 - TW_SEND_BATCH);
    // Mailjet down: two retries, then one warning to Sandra and no further tries
    await up({ order: C.order, texts: [{ area: 'love', week: 2, sendAt: ny7('2026-12-14'), text: md }] });
    const okFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url) === 'https://api.mailjet.com/v3.1/send' && JSON.parse(init.body).Messages[0].To[0].Email === 'tw@example.com') ? new Response('{"ErrorMessage":"down"}', { status: 500 }) : okFetch(url, init);
    assert.equal((await runTwMails(env, ny7('2026-12-14'))).retry, 1);
    assert.equal((await runTwMails(env, ny7('2026-12-14') + 300000)).retry, 1);
    before = mails.length;
    assert.equal((await runTwMails(env, ny7('2026-12-14') + 600000)).failed, 1);
    assert.match(mails[before].subject, /Mail nicht zugestellt/);
    assert.equal((await runTwMails(env, ny7('2026-12-14') + 900000)).due, 0, 'given up');
    globalThis.fetch = okFetch;
    // withdrawal: the bookings behind the number pause at once, Sandra is told how to resume
    before = mails.length;
    r = await worker.fetch(req('/api/withdraw', 'POST', { name: 'Test Person', contract: `Order ${D.order}`, email: 'TW@example.com' }, { ip: '7.7.7.7' }), env);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(kv.get(`tw:${D.base}:${D.order}`)).stopped.reason, 'withdrawal');
    assert.match(mails.slice(before).find(x => /^WIDERRUF/.test(x.subject)).text, /automatisch pausiert[^]*--weiter AS-20261019-DDDDD/);
    assert.equal(kvMeta.get(`tw:${D.base}:${D.order}`).x, 'withdrawal');
  }
  // the 5-minute crons send weekly mails only when their own queue is idle
  { const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.match(src, /r && r\.sent === 0 \? runTwMails/); }
  console.log('transit weekly mails ok');
}
