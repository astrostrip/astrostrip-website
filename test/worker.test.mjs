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
const env = {
  STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: secret, MAILJET_API_KEY: 'k', MAILJET_SECRET_KEY: 's', MAILJET_NEWSLETTER_LIST_ID: '111', MAILJET_CUSTOMER_LIST_ID: '222', OWNER_EMAIL: 'owner@example.com', SITE_URL: 'https://astrostrip.com',
  ORDERS: {
    get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix, limit }) => { const keys = [...kv.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit).map(name => ({ name })); return { keys, list_complete: true }; },
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
    const s = { id: 'cs_' + sessions.length, created: Math.floor(Date.now() / 1000), expires_at: Number(p.get('expires_at')), status: 'open', payment_status: 'unpaid', metadata: { strip: p.get('metadata[strip]'), order_id: p.get('metadata[order_id]'), week: p.get('metadata[week]') }, description: p.get('line_items[0][price_data][product_data][description]'), url: 'https://checkout.stripe.com/x' };
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), String(STRIPS[s.metadata.strip].cents));
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
    mails.push({ to: m.To.map(t => t.Email), subject: m.Subject, text: m.TextPart, attachments: m.Attachments });
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
