# astro.strip website

Landing page with a birth chart calculator and an order form for personal readings. No build step: static files in `public/`, plus a small Cloudflare Worker (`src/worker.js`) for orders and the newsletter. The calculator itself runs only in the browser.

## How it works

- Everything is calculated in the visitor's browser. No birth data is sent or stored.
- Engine: [Swiss Ephemeris](https://www.astro.com/swisseph/) by Astrodienst AG, compiled to WebAssembly by the npm package `swisseph-wasm` 0.1.0 (`vendor/swisseph/`).
- Conventions: tropical zodiac, Placidus houses (Porphyry above 66° latitude), true node, orbs of the astro.strip school.
- Places: GeoNames (`data/cities.js`), all places worldwide with at least 15,000 inhabitants plus Germany, Austria and Switzerland from 1,000, each with its IANA time zone. Historical daylight saving time comes from the browser's own time zone data.
- Texts: `assets/texts.js` (sign level for Rising, Sun and Moon) and `assets/degrees/<sign>.js` (one Sun text per degree; since 10.10.2026 signs switch one by one to the carousel form: still growing, grown into it, in real life before/after, Aries first). The free calculator reads the Sun only; Rising and Moon are shown with sign and degree, their reading is part of the paid strips.
- Text check: `node tools/check-texts.mjs` before every upload of `assets/texts.js`, `assets/degrees/` or `data/transits/` (exit code 1 = do not upload). It looks only at the visible texts and blocks author and source names, unexplained technical terms and healing words (list in the script); Chiron transit texts may say "wound". The texts speak for themselves: no name-dropping, rulers only with a plain explanation (Sandra, 06.10.2026). `tools/build-public-degrees.mjs` runs it automatically.
- This week's transits to the Sun: `data/transits/<monday>.json`, one file per week (Monday to Sunday, German time), built ahead by `tools/build-transits.py` with the Swiss Ephemeris. Same rules as astro.strip's weekly transit posts: Mercury to Pluto plus Chiron, major aspects (exact = the aspect point falls into the Sun's degree); from the week of 12 October 2026 on, orbs only while applying and inside the Sun sign: Mercury, Venus and Mars from 5° before exact, Jupiter to Pluto and Chiron from 1° before. After exact a fast planet drops out, a slow planet gets one line on integration. Week files from then on carry `orbs` and per hit `status` (exact, applying, separating), houses as whole signs from 0° of the Sun sign. From 6 October 2026 a slow hit (exact or applying) can carry `triggers`: a fast planet on the same Sun degree that week (Mercury and Venus when exact, Mars also while applying, any fast planet stationing in its orb; L15 pp. 14-16, `/transit` D24). The calculator then adds one small line under the slow hit without naming the fast planet: Mercury/Venus "Likely most tangible on <day before> and <exact day>.", Mars "Building all week, likely most tangible around <day>." (or "Building all week." without exact day), station "Lingers for weeks: a fast planet stands still on this degree." (wording Sandra, 06.10.2026). The calculator reads the file for the current week and, from Friday on, also the file for the coming week (the weekend posts read the coming week); without a file it shows nothing for that week.
- Progressed Moon phase: computed in the browser from the birth moment with secondary progressions (one day after birth = one tropical year, 365.24219 days). The phase is one of the school's four (New Moon, First Quarter, Full Moon, Last Quarter, each 90° of progressed Moon–Sun elongation, about 7.4 years); start and end are the calendar years of the phase boundaries. Without a birth time the chart is set for noon, which can move these dates by up to half a year. The block also names the year of the last progressed New Moon and, with a birth time, its natal house with a short life-area label; in the Last Quarter the teaser points to the next progressed New Moon (its year). Shown in its own frame with a circle of the four phases (current phase as a gold arc, a dot for today), a timeline from the start to the end of the phase and a collapsible "What is the progressed Moon?" (school L17 pp. 23-24). The transit block above has its own frame too and is titled "Your week, stripped down", as in the weekly posts.

## Ordering

Tests: `node test/worker.test.mjs` (Stripe and mail are mocked).

`src/worker.js` (Cloudflare Worker) serves `/api/*`: weekly slots (counted from Stripe, Monday 00:00 Europe/Berlin; when a week is full, the next free week can be booked, up to 8 weeks ahead), Stripe Checkout, the Stripe webhook, the electronic withdrawal function (§ 356a BGB) and the newsletter double opt-in (Mailjet, tracking off). Birth data is kept in KV only until payment, then mailed to the owner and deleted. It is never sent to Stripe. Secrets are set in the Cloudflare dashboard, never in this repository.

Invoices: every paid order gets an e-invoice (ZUGFeRD / Factur-X, profile EN 16931, PDF/A-3). The webhook only queues it; a cron run every 5 minutes does one step per run: build it (`src/invoice.js`, PDF kept in the KV until sent), mail it to the customer, send the copy to the owner (so the customer has it after at most ~10 minutes; each step stays well under 10 ms CPU). The page layout, logo and fonts come ready-made from `src/invoice-template.js`, generated by `tools/invoice/build-template.py` (PyMuPDF and fontTools, which embeds the fonts without hinting and layout tables; needs Playfair Display TTF files from Google Fonts, SIL Open Font License, in `tools/invoice/fonts/`). The Worker only appends an incremental update, which keeps it within the free plan's CPU limit.

Invoice corrections: a refund in the Stripe dashboard sends `refund.created`; the webhook queues the refund id and a cron run of its own (minutes 2, 7, 12 …), like the invoices one step per run (build, customer, owner), mails an invoice correction (Rechnungskorrektur, document type 381, referring to the invoice; number = invoice number + K1, K2 …) to the customer with a copy to the owner, and frees the week slot. Name and billing address are fetched from Stripe again. Its fixed labels come from `src/invoice-correction-template.js`, generated by the same script.

FAQ: the "Before you order" section in `public/index.html` (`#faq`) restates the terms, the cancellation policy, the privacy notice, the order form and the strip cards in plain words. Whenever one of those changes (delivery, withdrawal, data retention, payment, form fields, prices, page counts, Transit Weekly), update the matching answer in the same change.

Retention: an hourly cron (`runRetention`) removes buyers from the Mailjet list "Kundinnen" three years after their last purchase and deletes consent records three years after the last list relationship ended (unsubscribe, objection or removal). It checks ten records per run because of the free plan's subrequest limit.

Statistics without cookies: a small script at the end of `public/index.html` posts one category to `/api/stat` (a visit by source, from `?src=ig`/`?src=tt` or the referrer, or a click on one of the three sample tabs). No cookie, no IP, no identifier, nothing stored in the browser; the Worker writes only the category to Workers Analytics Engine (`STATS`). A Monday cron (`runStatsRollup`) sums last week into one KV entry, readable with a secret key at `/api/stats`.

## Run locally

The website itself is in `public/`. Any static web server works, for example:

    python3 -m http.server 8765 --directory public

then open http://localhost:8765. Opening `index.html` directly as a file does not work (ES modules and WebAssembly need a server).

## Licences

- The code of this website is licensed under the GNU Affero General Public License v3.0 (`LICENSE`), because it uses the Swiss Ephemeris under the AGPL.
- Swiss Ephemeris © Astrodienst AG, AGPL-3.0. `swisseph-wasm` © prolaxu, GPL-3.0-or-later (`vendor/swisseph/LICENSE`).
- Place data © GeoNames, CC BY 4.0.
- Playfair Display, SIL Open Font License 1.1 (`fonts/OFL.txt`).
- The written interpretations in `assets/texts.js` and `assets/degrees/` are © astro.strip.
