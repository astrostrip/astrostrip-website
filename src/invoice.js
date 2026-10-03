// Invoice for every paid order (Sandra, 02.10.2026): ZUGFeRD / Factur-X, profile EN 16931,
// as a PDF/A-3 with the embedded factur-x.xml (UStAE 14.1 Abs. 14; the XML is the leading part).
// All strips cost at most 250 €, so a Kleinbetragsrechnung (§ 33 UStDV) would suffice; we still give
// the full details of § 14 Abs. 4 UStG. Invoice number = order number (unique, AS-YYYYMMDD-XXXXX).
//
// The free Workers plan allows 10 ms CPU per request, too little to lay out a PDF. So the page, the
// fonts and the logo come ready-made from src/invoice-template.js (built on the Mac by
// tools/invoice/build-template.py), and this file only appends an incremental update: a content
// stream with the variable text, the XML attachment and new versions of the page and the catalog.
// The template length is a multiple of 3, so its base64 can be reused as is.

import { TEMPLATE_B64, TEMPLATE_META as T } from './invoice-template.js';
import { CORRECTION_META as C } from './invoice-correction-template.js';

export const SELLER = {
  name: 'Sandra Willuweit', trading: 'astro.strip', street: 'Bundesweg 4', zip: '20149', city: 'Hamburg',
  country: 'DE', email: 'hello@astrostrip.com', vatId: 'DE317306093',
};
export const VAT_RATE = 19;

// ---------- amounts and dates ----------
// Gross price incl. 19 % VAT -> net and VAT in cents. Checked against EN 16931 BR-CO-17
// (VAT = basis × rate, rounded) in the tests for every strip.
export function splitGross(grossCents) {
  const net = Math.round(grossCents * 100 / (100 + VAT_RATE));
  return { net, vat: grossCents - net, gross: grossCents };
}

// No Intl here: the first Intl.DateTimeFormat with a time zone costs ~40 ms CPU (time zone data),
// four times the free plan's budget. Berlin time follows the EU rule: summer time from the last
// Sunday in March 01:00 UTC to the last Sunday in October 01:00 UTC.
const lastSundayUtc = (y, month) => { const d = new Date(Date.UTC(y, month + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); };
export function berlinDate(ms) {
  const y = new Date(ms).getUTCFullYear();
  const summer = ms >= lastSundayUtc(y, 2) && ms < lastSundayUtc(y, 9);
  return ymdUtc(new Date(ms + (summer ? 2 : 1) * 3600000));
}
// toISOString costs ~5 ms on its first call; building the string by hand costs nothing.
const p2 = n => String(n).padStart(2, '0');
const ymdUtc = t => `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
const dmy = ymd => ymd.split('-').reverse().join('.');
// n working days (Mon–Fri) after a date; public holidays are not counted out.
export function addWorkdays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (let k = 0; k < n;) { t += 86400000; const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) k++; }
  return ymdUtc(new Date(t));
}
// Service period = the delivery promise of the order mail: from payment N working days, or for a
// booked later week from its Monday (counted as day 1) N working days.
export function servicePeriod(order, strip, paidYmd) {
  if (order.thisWeek === false && order.week) return { start: order.week, end: addWorkdays(order.week, strip.days - 1) };
  return { start: paidYmd, end: addWorkdays(paidYmd, strip.days) };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const enDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const money = cents => `${(cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
const xmlAmount = cents => (cents / 100).toFixed(2);

// Country names on the page (German, as the invoice is issued in Germany); others show the ISO code.
const COUNTRIES = {
  DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', LI: 'Liechtenstein', LU: 'Luxemburg', NL: 'Niederlande', BE: 'Belgien',
  FR: 'Frankreich', IT: 'Italien', ES: 'Spanien', PT: 'Portugal', DK: 'Dänemark', SE: 'Schweden', NO: 'Norwegen', FI: 'Finnland',
  PL: 'Polen', CZ: 'Tschechien', SK: 'Slowakei', HU: 'Ungarn', SI: 'Slowenien', HR: 'Kroatien', RO: 'Rumänien', BG: 'Bulgarien',
  GR: 'Griechenland', CY: 'Zypern', MT: 'Malta', IE: 'Irland', EE: 'Estland', LV: 'Lettland', LT: 'Litauen', IS: 'Island',
  GB: 'Vereinigtes Königreich', US: 'Vereinigte Staaten', CA: 'Kanada', AU: 'Australien', NZ: 'Neuseeland',
};
const countryName = code => COUNTRIES[code] || code;

// Buyer as Stripe collected it (name and billing address of the Checkout Session).
function buyerData(cd, fallbackName, email) {
  const a = cd.address || {};
  const country = /^[A-Z]{2}$/.test(a.country || '') ? a.country : '';
  return {
    name: (cd.name || fallbackName || '').trim(),
    lines: [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.state].map(s => (s || '').trim()).filter(Boolean),
    country, countryName: country ? countryName(country) : '',
    email,
    raw: a,
  };
}

// Everything the invoice shows, from the stored order and the paid Stripe session.
export function invoiceData(order, session, strip, nowMs = Date.now(), paidMs = nowMs) {
  const cd = session.customer_details || {};
  const country = buyerData(cd, order.name, order.email).country;
  const date = berlinDate(nowMs);
  return {
    number: order.id,
    issueDate: date, paidDate: berlinDate(paidMs),
    period: servicePeriod(order, strip, berlinDate(paidMs)),
    buyer: buyerData(cd, order.name, order.email),
    item: { name: `${strip.name} – ${strip.tag}`, short: strip.name },
    amounts: splitGross(strip.cents),
    missingCountry: !country,
  };
}

// ---------- XML (UN/CEFACT CII D16B, Factur-X / ZUGFeRD profile EN 16931) ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The invoice correction (d.correction set) uses the same structure: document type 381 (credit note /
// Rechnungskorrektur, EN 16931 BT-3), the refunded amount as positive values, and the reference to the
// corrected invoice (BT-25 number, BT-26 date), as § 31 Abs. 5 UStDV asks.
export function invoiceXml(d) {
  const { net, vat, gross } = d.amounts;
  const b = d.buyer;
  const addr = buyerPostal(b);
  const k = d.correction;
  const note = k
    ? `Rechnungskorrektur zur Rechnung ${k.invoice} vom ${dmy(k.invoiceDate)}: ${k.full ? 'Erstattung des vollen Betrags' : 'Teilerstattung; der nicht erstattete Betrag bleibt Entgelt für die bereits erbrachte Leistung'}. Erstattet am ${dmy(k.refundDate)} über Stripe.`
    : `Leistungszeitraum ${dmy(d.period.start)} bis ${dmy(d.period.end)}: persönliches astrologisches Reading als PDF per E-Mail. Bezahlt am ${dmy(d.paidDate)} über Stripe.`;
  const terms = k
    ? `Erstattet am ${dmy(k.refundDate)} über Stripe auf das ursprüngliche Zahlungsmittel / refunded on ${enDate(k.refundDate)} via Stripe to the original payment method`
    : `Bezahlt am ${dmy(d.paidDate)} über Stripe / paid on ${enDate(d.paidDate)} via Stripe`;
  const period = d.period ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${d.period.start.replace(/-/g, '')}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${d.period.end.replace(/-/g, '')}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>\n` : '';
  const ref = k ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(k.invoice)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${k.invoiceDate.replace(/-/g, '')}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${esc(d.number)}</ram:ID>
<ram:TypeCode>${k ? 381 : 380}</ram:TypeCode>
<ram:IssueDateTime><udt:DateTimeString format="102">${d.issueDate.replace(/-/g, '')}</udt:DateTimeString></ram:IssueDateTime>
<ram:IncludedNote><ram:Content>${esc(note)}</ram:Content></ram:IncludedNote>
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct><ram:Name>${esc(d.item.name)}</ram:Name><ram:Description>${esc(d.item.xmlDesc || 'Persönliches astrologisches Reading als PDF / personal astrology reading (PDF)')}</ram:Description></ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${xmlAmount(net)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement>
<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${VAT_RATE}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${xmlAmount(net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
</ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty>
<ram:Name>${esc(SELLER.name)}</ram:Name>
<ram:SpecifiedLegalOrganization><ram:TradingBusinessName>${esc(SELLER.trading)}</ram:TradingBusinessName></ram:SpecifiedLegalOrganization>
<ram:PostalTradeAddress><ram:PostcodeCode>${SELLER.zip}</ram:PostcodeCode><ram:LineOne>${esc(SELLER.street)}</ram:LineOne><ram:CityName>${SELLER.city}</ram:CityName><ram:CountryID>${SELLER.country}</ram:CountryID></ram:PostalTradeAddress>
<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${SELLER.email}</ram:URIID></ram:URIUniversalCommunication>
<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${SELLER.vatId}</ram:ID></ram:SpecifiedTaxRegistration>
</ram:SellerTradeParty>
<ram:BuyerTradeParty>
<ram:Name>${esc(b.name)}</ram:Name>
${addr}
<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(b.email)}</ram:URIID></ram:URIUniversalCommunication>
</ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery><ram:ShipToTradeParty><ram:Name>${esc(b.name)}</ram:Name></ram:ShipToTradeParty></ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:ApplicableTradeTax><ram:CalculatedAmount>${xmlAmount(vat)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${xmlAmount(net)}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${VAT_RATE}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
${period}<ram:SpecifiedTradePaymentTerms><ram:Description>${terms}</ram:Description></ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${xmlAmount(net)}</ram:LineTotalAmount>
<ram:TaxBasisTotalAmount>${xmlAmount(net)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="EUR">${xmlAmount(vat)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${xmlAmount(gross)}</ram:GrandTotalAmount>
<ram:TotalPrepaidAmount>${xmlAmount(gross)}</ram:TotalPrepaidAmount>
<ram:DuePayableAmount>0.00</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${ref}</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

// Buyer address in CII order: PostcodeCode, LineOne, LineTwo, CityName, CountryID, CountrySubDivisionName.
function buyerPostal(b) {
  const a = b.raw || {};
  const parts = [
    a.postal_code ? `<ram:PostcodeCode>${esc(a.postal_code)}</ram:PostcodeCode>` : '',
    a.line1 ? `<ram:LineOne>${esc(a.line1)}</ram:LineOne>` : '',
    a.line2 ? `<ram:LineTwo>${esc(a.line2)}</ram:LineTwo>` : '',
    a.city ? `<ram:CityName>${esc(a.city)}</ram:CityName>` : '',
    `<ram:CountryID>${b.country || SELLER.country}</ram:CountryID>`,
    a.state ? `<ram:CountrySubDivisionName>${esc(a.state)}</ram:CountrySubDivisionName>` : '',
  ];
  return `<ram:PostalTradeAddress>${parts.join('')}</ram:PostalTradeAddress>`;
}

// ---------- page text (same glyph mapping as the template) ----------
const COLORS = { ink: T.colors.ink, grey: T.colors.grey };

function glyphs(font, s) {
  const f = T.fonts[font];
  return [...s.normalize('NFC')].map(c => f.cmap[c.codePointAt(0)] ?? f.fallback);
}
export function textWidth(font, s, size) {
  const f = T.fonts[font];
  return glyphs(font, s).reduce((w, g) => w + (f.widths[g] || 0), 0) * size / 1000;
}
function text(x, y, s, font = 'R', size = 9.5, color = COLORS.ink, align = 'left') {
  if (align === 'right') x -= textWidth(font, s, size);
  const hex = glyphs(font, s).map(g => g.toString(16).toUpperCase().padStart(4, '0')).join('');
  return `BT /F${font} ${size} Tf 0 Tc ${color.map(c => c.toFixed(3)).join(' ')} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex}> Tj ET\n`;
}
// Shortens a value that would not fit (very long names or streets), so it never runs into the next column.
function fit(s, font, size, width) {
  if (textWidth(font, s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && textWidth(font, t + '…', size) > width) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function pageContent(d) {
  const L = T.layout;
  const { net, vat, gross } = d.amounts;
  const out = ['q\n'];
  const colW = 270;
  out.push(text(L.buyer.x, L.buyer.y, fit(d.buyer.name, 'B', 10, colW), 'B', 10));
  [...d.buyer.lines, d.buyer.countryName].filter(Boolean).slice(0, 4).forEach((line, i) => {
    out.push(text(L.buyer.x, L.buyer.y - L.buyer.step * (i + 1), fit(line, 'R', 9.5, colW), 'R', 9.5));
  });
  const meta = d.meta || [d.number, dmy(d.issueDate), dmy(d.paidDate), `${dmy(d.period.start)} – ${dmy(d.period.end)}`];
  const metaYs = d.correction ? C.metaYs : L.meta.ys;
  meta.forEach((v, i) => out.push(text(L.meta.x, metaYs[i], v, i === 0 ? 'B' : 'R', 9.5)));
  out.push(text(40, L.row.y, '1', 'R', 9.5));
  out.push(text(68, L.row.y, fit(d.item.name, 'B', 10, L.row.qty_x - 68 - 40), 'B', 10));
  out.push(text(68, L.row.desc_y, fit(d.item.desc || 'Persönliches astrologisches Reading als PDF · Personal astrology reading (PDF)', 'R', 8.5, L.row.net_x - 68), 'R', 8.5, COLORS.grey));
  out.push(text(L.row.qty_x, L.row.y, '1', 'R', 9.5, COLORS.ink, 'right'));
  out.push(text(L.row.vat_x, L.row.y, `${VAT_RATE} %`, 'R', 9.5, COLORS.ink, 'right'));
  out.push(text(L.row.net_x, L.row.y, money(net), 'R', 9.5, COLORS.ink, 'right'));
  [money(net), money(vat), money(gross), money(gross), money(0)].forEach((v, i) => {
    const bold = i === 2;
    out.push(text(L.totals.x, L.totals.ys[i], v, bold ? 'B' : 'R', bold ? 10.5 : 9.5, bold ? COLORS.ink : COLORS.grey, 'right'));
  });
  out.push('Q\n');
  return out.join('');
}

// ---------- incremental update ----------
const enc = new TextEncoder();
function concat(chunks) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function base64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const pdfDate = ms => { const t = new Date(ms); return `D:${ymdUtc(t).replace(/-/g, '')}${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}${p2(t.getUTCSeconds())}+00'00'`; };

// Returns the bytes appended to the template (incremental update with xref section and trailer).
export function invoiceUpdate(d, xml, nowMs = Date.now(), fileId = null) {
  const dyn = T.size, ef = T.size + 1, fs = T.size + 2;
  const content = enc.encode(pageContent(d));
  const xmlBytes = enc.encode(xml);
  // The correction replaces the invoice's fixed labels (its own content stream) and the XMP title.
  const lab = T.size + 3, xmp = T.size + 4;
  const corr = !!d.correction;
  let pageDict = T.pageDict.replace('{dyn}', dyn);
  let catalog = T.catalog;
  if (corr) {
    pageDict = pageDict.replace(/\/Contents \[\d+ 0 R /, `/Contents [${lab} 0 R `);
    catalog = catalog.replace(/\/Metadata \d+ 0 R/, `/Metadata ${xmp} 0 R`);
  }
  const stream = (num, dict, bytes) => [num, [enc.encode(`${num} 0 obj\n<< ${dict}/Length ${bytes.length} >>\nstream\n`), bytes, enc.encode('\nendstream\nendobj\n')]];
  const objs = [
    [dyn, [enc.encode(`${dyn} 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, enc.encode('\nendstream\nendobj\n')]],
    [ef, [enc.encode(`${ef} 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Params << /ModDate (${pdfDate(nowMs)}) /Size ${xmlBytes.length} >> /Length ${xmlBytes.length} >>\nstream\n`), xmlBytes, enc.encode('\nendstream\nendobj\n')]],
    [fs, [enc.encode(`${fs} 0 obj\n<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /Desc (Factur-X invoice) /AFRelationship /Alternative /EF << /F ${ef} 0 R /UF ${ef} 0 R >> >>\nendobj\n`)]],
    ...(corr ? [stream(lab, '', enc.encode(C.static)), stream(xmp, '/Type /Metadata /Subtype /XML ', enc.encode(C.xmp))] : []),
    [T.page, [enc.encode(`${T.page} 0 obj\n${pageDict}\nendobj\n`)]],
    [T.root, [enc.encode(`${T.root} 0 obj\n${catalog.replace(/>>\s*$/, `/Names << /EmbeddedFiles << /Names [(factur-x.xml) ${fs} 0 R] >> >> /AF [${fs} 0 R]>>`)}\nendobj\n`)]],
  ];
  const chunks = [];
  const offsets = {};
  let pos = T.length;
  for (const [num, parts] of objs) {
    offsets[num] = pos;
    for (const p of parts) { chunks.push(p); pos += p.length; }
  }
  // xref: one subsection per run of consecutive object numbers
  const nums = Object.keys(offsets).map(Number).sort((a, b) => a - b);
  let xref = 'xref\n';
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    xref += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) xref += `${String(offsets[nums[k]]).padStart(10, '0')} 00000 n\r\n`;
    i = j + 1;
  }
  const newId = fileId || [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  xref += `trailer\n<< /Size ${T.size + (corr ? 5 : 3)} /Root ${T.root} 0 R /Prev ${T.prevXref} /ID [<${T.id}> <${newId}>] >>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(enc.encode(xref));
  return concat(chunks);
}

export const invoiceFilename = d => `astro.strip-Rechnung-${d.number}.pdf`;

// The complete PDF as base64, for the mail attachment. The template part is reused as is.
export function invoicePdfBase64(d, xml, nowMs = Date.now(), fileId = null) {
  return TEMPLATE_B64 + base64(invoiceUpdate(d, xml, nowMs, fileId));
}

// For tests: the complete PDF as bytes.
export function invoicePdfBytes(d, xml, nowMs = Date.now(), fileId = null) {
  const bin = atob(TEMPLATE_B64);
  const tpl = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) tpl[i] = bin.charCodeAt(i);
  return concat([tpl, invoiceUpdate(d, xml, nowMs, fileId)]);
}

// ---------- invoice correction for refunds (Sandra, 03.10.2026) ----------
// Not called "Gutschrift": in VAT law that is a self-billing invoice issued by the buyer (§ 14 Abs. 2 Satz 5
// UStG). A refund changes the taxable amount (§ 17 UStG); the correction documents it and refers to the
// invoice (§ 31 Abs. 5 UStDV). Number = invoice number + K1, K2 … (one per refund of the same payment).
// k: { orderId, n, invoiceDate (YYYY-MM-DD), period ({start, end} or null), refundCents, refundMs, full }
export function correctionData(k, customerDetails, email, strip, nowMs = Date.now()) {
  const cd = customerDetails || {};
  const buyer = buyerData(cd, '', email);
  const refundDate = berlinDate(k.refundMs);
  const issueDate = berlinDate(nowMs);
  const number = `${k.orderId}-K${k.n}`;
  return {
    number, issueDate, period: k.period || null,
    correction: { invoice: k.orderId, invoiceDate: k.invoiceDate, refundDate, full: k.full },
    meta: [number, dmy(issueDate), `${k.orderId} · ${dmy(k.invoiceDate)}`, k.period ? `${dmy(k.period.start)} – ${dmy(k.period.end)}` : '–', dmy(refundDate)],
    buyer,
    item: {
      name: `Erstattung · Refund: ${strip.name}`, short: strip.name,
      desc: k.full ? 'Erstattung des vollen Betrags · Full refund' : 'Teilerstattung, der Rest bleibt Entgelt für die erbrachte Leistung · Partial refund',
      xmlDesc: k.full ? 'Erstattung des vollen Betrags / full refund' : 'Teilerstattung; der nicht erstattete Betrag bleibt Entgelt für die bereits erbrachte Leistung / partial refund',
    },
    amounts: splitGross(k.refundCents),
    missingCountry: !buyer.country,
  };
}
export const correctionFilename = d => `astro.strip-Rechnungskorrektur-${d.number}.pdf`;

export function buildCorrection(k, customerDetails, email, strip, nowMs = Date.now()) {
  const d = correctionData(k, customerDetails, email, strip, nowMs);
  const xml = invoiceXml(d);
  return { data: d, xml, filename: correctionFilename(d), base64: invoicePdfBase64(d, xml, nowMs) };
}

export function buildInvoice(order, session, strip, nowMs = Date.now(), paidMs = nowMs) {
  const d = invoiceData(order, session, strip, nowMs, paidMs);
  const xml = invoiceXml(d);
  return { data: d, xml, filename: invoiceFilename(d), base64: invoicePdfBase64(d, xml, nowMs) };
}
