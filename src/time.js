// Berlin time without Intl (Sandra, 03.10.2026). The first Intl.DateTimeFormat of an invocation costs
// ~20–40 ms CPU (locale and time zone data), the free plan allows 10 ms; the first toISOString ~5 ms.
// Cloudflare Metrics showed 27 and 31 ms for checkout and payment webhook. These functions give the
// same strings as the Intl calls they replace (checked in the tests against Intl, DST edges included).
// Berlin follows the EU rule: summer time from the last Sunday in March 01:00 UTC to the last Sunday
// in October 01:00 UTC.

const lastSundayUtc = (y, month) => { const d = new Date(Date.UTC(y, month + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); };
const p2 = n => String(n).padStart(2, '0');

// Offset of Berlin to UTC at an instant, in minutes (60 or 120).
export function berlinOffsetMinutes(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSundayUtc(y, 2) && ms < lastSundayUtc(y, 9) ? 120 : 60;
}

// Berlin wall clock at an instant, as a Date read with the UTC getters.
const berlinWall = ms => new Date(ms + berlinOffsetMinutes(ms) * 60000);
const ymd = t => `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;

// YYYY-MM-DD in Berlin (was Intl 'en-CA' with timeZone Europe/Berlin).
export const berlinYmd = ms => ymd(berlinWall(ms));

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
};
// "19 October 2026" / "19. Oktober 2026" (was Intl en-GB / de-DE, day numeric, month long).
const dateText = (t, lang) => lang === 'de'
  ? `${t.getUTCDate()}. ${MONTHS.de[t.getUTCMonth()]} ${t.getUTCFullYear()}`
  : `${t.getUTCDate()} ${MONTHS.en[t.getUTCMonth()]} ${t.getUTCFullYear()}`;

// For a YYYY-MM-DD date.
export function longDateText(ymdStr, lang = 'en') {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return dateText(new Date(Date.UTC(y, m - 1, d)), lang);
}

// "3. Oktober 2026 um 15:42:07" / "3 October 2026 at 15:42:07" in Berlin
// (was Intl de-DE / en-GB with dateStyle long, timeStyle medium).
export function berlinStampText(ms, lang = 'de') {
  const t = berlinWall(ms);
  const time = `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
  return `${dateText(t, lang)} ${lang === 'en' ? 'at' : 'um'} ${time}`;
}

// Same string as new Date(ms).toISOString().
export function isoUtc(ms) {
  const t = new Date(ms);
  return `${ymd(t)}T${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}.${String(t.getUTCMilliseconds()).padStart(3, '0')}Z`;
}
