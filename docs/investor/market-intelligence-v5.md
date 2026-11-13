# Market Intelligence V5 — internal status, demo checklist and measured metrics

**INTERNAL — not for distribution.** Contains measured performance, source-licensing status and roadmap. Do not share with
marketplaces, data providers or the public. Prepared 2026-11-13.

## 1. What was built (commits c31c8ad..620d295, branch feat/core-scan-001; migration 20261113120000 APPLIED 2026-11-13)

| Capability | Where | State |
|---|---|---|
| Source registry with explicit permission states (authorized / authorized_restricted / public_research_only / not_authorized / unknown) | `api/_lib/market/sources.js` | Code done, tested |
| Enforcement: no automated retrieval or long-term history without permission; Yad2/Facebook prices never used, even from a scan's own search | `sources.js`, `service.js`, `structured-data.js` | Code done, tested |
| Normalised observation schema, with private asking / completed sale / refurbished / new retail / price guide kept separate | `api/_lib/market/observations.js` | Code done, tested |
| Feedback-loop guard: GetWorth estimates, recommended prices and engine-priced listings can't become evidence | `observations.js` (`isSelfGenerated`) | Code done, tested |
| Market index: observations by product, appended price history, retention set by permission, deduplication by listing fingerprint | `api/_lib/market/index-store.js`, migration `20261113120000` | Live; migration applied and verified 2026-11-13 |
| Fast path: indexed evidence that is current for the item's kind and strong enough on Israeli evidence prices with **no search**; otherwise it joins the live research pool | `api/_lib/scan/service.js` | Live, tested |
| Adaptive refresh policy (proposed defaults: phones/consoles 24 h, appliances 72 h, furniture 7 d), used by the fast path and the scheduled refresh | `api/_lib/market/refresh-policy.js`, `scan/prewarm.js` | Code done, tested |
| Retention purge on every daily cron run (no OpenAI cost) | `api/prewarm.js` | Code done, tested |
| JSON-LD Product/Offer extractor (no dependency), callable only for sources that may be retrieved | `api/_lib/market/structured-data.js` | Code done, tested; **no source is currently enabled** |
| Telemetry: index rows, read ms, priced/pool/none, rows stored, sources refused | `api/scan.js` `core_scan_priced` | Code done |

Unchanged on purpose: evidence-based condition prices (no ladder), strict model/variant/capacity matching, live research
fallback, marketplace-sale evidence rules, retail references kept apart from used prices.

## 2. Source permissions (the binding constraint)

| Source | State | Automated ingestion | Long-term history |
|---|---|---|---|
| GetWorth marketplace sales (qualified) | authorized | yes | yes |
| eBay (official Browse API) | authorized_restricted | API only; **no keys configured** | — |
| Homeless | public_research_only (terms forbid robots and commercial use) | no | no (7-day scan window only) |
| ad.co.il | public_research_only (prior written permission required) | no | no |
| Yad2 | not_authorized | no | no; prices not used |
| Facebook Marketplace | not_authorized | no | no; prices not used |
| KSP, BUG, Ivory, Zap, zuzz, doskatv | unknown (terms not reviewed) | no | no |

**What this means.** The dynamic database and background ingestion are built, but today nothing external may be
ingested automatically. The index fills only from evidence that the scans' own live searches verify, and it keeps that
evidence for the existing 7-day research window. Durable Israeli price history needs a licence or written permission
from at least one Israeli marketplace. Granting one is a single line in `sources.js`, and retention and ingestion follow
from it. No provider was contacted (draft inquiries are in `docs/partnerships/`, unsent).

## 3. Delivery scorecard (2026-11-13, Production = 620d295)

| Metric | Historical baseline | Measured result | Sample and method |
|---|---|---|---|
| Defensible price coverage | 10/20 replay | **10/20 live** | Live API run of the fixed 20-item price step (`il-coverage-eval.mjs record`, real OpenAI web search, $0.43). Identities are fixed, so identification is not exercised. The first live pass priced 11; one of those (Squier '50s from a '60s ad) was a sibling model, fixed in 620d295. Replay of the original recordings: 11/20 (scooter fix). |
| Identification accuracy | not established | 10/18 exact, 0 confidently wrong | 18 labelled photos, 2026-11-08. **Not re-measured** this round. |
| Wrong-model acceptance | DualSense Edge incident | 1 of 11 live prices (Squier) → fixed; 0 in 10 after the fix | Manual check of every accepted reference in the live run |
| Fresh research latency | ~12.1 s p50 | **p50 11.9 s, p90 16.3 s** (range 5.3–18.3 s) | Same live run, n=20, from a local machine (not Production) |
| Full scan latency p50 / p90 | not established | **not measured** | Needs signed-in Production scans (§7) |
| Cache / index hit rate | ~39% | **not yet measured on the index** | The index went live 2026-11-13; it fills from Production scans and the daily refresh |
| Cost per research / per priced item | ~$0.04 replay | **$0.021 / $0.043** | Live run: $0.4252 ÷ 20 researches ÷ 10 priced |
| Evidence freshness | not established | 99 observations, 20 products, 59 Israeli private asks, each kept 7 days | Production `market_observations` after recording the live run's verified evidence |
| Production E2E success rate | not established | **not measured** | Blocked: needs a signed-in browser session (§7) |
| Real iPhone verification | not performed | **not performed** | Founder action |

Do NOT claim: 80% coverage, six-second scans, verified transaction-price accuracy or a proprietary Israeli price
database. None of these is supported by measurement today.

## 4. Investor demo checklist (real Production, no staging tricks)

1. **Pick candidates from evidence, not hope.** Live 2026-11-13, MEDIUM confidence: iPhone 13 128GB (≈₪990, 2 IL ads),
   Apple Watch Series 8 45mm (≈₪770, 3 ads), iPad 9th gen 64GB (≈₪860, 3 ads), MacBook Air M1 (≈₪1,650, 3 ads). LOW:
   PS5 (ads ₪935–3,900, dispersed), Switch OLED (1 ad), Dyson V11, Trek Marlin 5, Xiaomi Pro 2 scooter (1 ad). Exclude
   the AirPods Pro 2 (two of its three references are generic category-page rows).
2. **The day before:** scan each candidate once on the iPhone, signed in, in Production. Keep only the ones that price.
   This also warms the research cache and the index (24 h for phones and consoles), so the live demo is fast and runs on
   the same evidence.
3. **On the day:** use the same physical items in good light, with the model label visible if there is one.
4. **Show** the identification, the one question if it is asked, the three prices (estimated worth dominant), the
   evidence sheet with each Israeli listing and its date, the confidence wording, and then "list for sale".
5. **Say plainly:** prices come from current Israeli listings the search could read; asking prices are not sale prices;
   the negotiation and quick-sale allowances are assumptions, not measured Israeli behaviour; the system shows no price
   rather than an invented one.
6. **If a scan doesn't price:** show the honest "not enough Israeli evidence" result and explain why (licensing). Never
   enter a price by hand to rescue a demo.
7. **Never:** hard-coded prices, seeded fake ads, an admin account presented as a user, or offline replay figures
   presented as live coverage.

## 5. Tooling audit

No new packages were installed. Already available and used: Node test runner, PGlite (local database rehearsal),
jsdom, the Supabase CLI, the Vercel REST API (git-source deployments), and the Claude-in-Chrome browser tools for QA
screenshots. Playwright and Cheerio were evaluated and **not** added. No source may be fetched automatically, so a
crawler has nothing permitted to run on, and JSON-LD extraction needs no HTML library. Add Playwright for end-to-end PWA
tests only if a test plan calls for it.

## 7. Blockers that need the founder

- **Signed-in Production E2E:** I may not type passwords into the live site. Sign in once in the Chrome window the
  browser tools use (or provide a test-account session); then scan → question → prices → evidence → listing → own
  price → return can be run and timed on Production.
- **Durable Israeli price history:** needs a licence or written permission from an Israeli marketplace (no outreach was
  made, per the founder's instruction).
- **eBay Browse API keys** (free developer programme) would allow abroad price context through the permitted channel.

## 6. Remaining limitations

- Coverage is limited by Israeli data licensing, not by code (see §2).
- The negotiation allowance (`NEGOTIATION = 0.9`) and the quick-sale rule are heuristics, labelled as such, and not
  validated against Israeli transactions.
- The refresh intervals are proposed defaults. Price-history rows (`market_observation_prices`) will let them be tuned
  once enough sightings accumulate.
- Identification at ~7.8 s p50 sets the floor on scan time. A faster model scored worse on the labelled benchmark.

## 8. Production browser E2E, 2026-11-13 (Production 620d295 → c0e43cf)

Desktop Chrome, signed in as the founder, Production site, photos = independently labelled Wikimedia Commons images
uploaded through the gallery input. **Not an iPhone test**, and the window did not actually resize to phone width, so
mobile layout is NOT verified. Answers were given instantly by a script (the labelled model when offered, "not sure"
otherwise), so the latencies below are machine time with no human thinking time.

| Product (label) | Identification | Questions | Result | Identify / price (s) |
|---|---|---|---|---|
| PS5 | correct (disc edition) | 0 | no price | 7.8 / 14.5 |
| iPhone 12 | 12 vs 12 mini → chose 12 | 2 (model, storage→unsure) | ≈₪950, list ≈₪1,300, quick ≈₪870, low | 8.2 / 16.5 |
| iPhone 12 (repeat) | same | 2 | same ₪950 (reused research) | 7.7 / **1.3** |
| Switch OLED | correct | 0 | ≈₪900, list ≈₪1,000, quick ≈₪680, low | 7.2 / 13.1 |
| Galaxy S21 | S20/S20+/S21 → chose S21 | 2 | ≈₪860, list ≈₪950, quick ≈₪700, low | 9.9 / 12.0 |
| Canon 5D Mark III | correct (body) | 0 | **≈₪42,500 — WRONG** (₪46,970 outlier ad) → fixed in c0e43cf → now no price | 7.0–8.6 / 8.5–17.4 |
| Apple Watch Series 4 | family → series question → Series 4 | 1 | no price | 7.9 / 8.3 |
| AirPods Pro 2 | AirPods Pro, generation question offered (script answered unsure) | 1 | ≈₪450 family-level, low | 8.8 / 14.1 |
| iPhone 11 Pro | 11 Pro vs 11 Pro Max → chose 11 Pro | 2 | ≈₪2,000, list ≈₪2,200, quick ≈₪1,150, low | 7.7 / 13.1 |

- Identification: 8 of 8 products named correctly or with the correct model offered in one question; 3 of 8 exact with
  no question; 0 confidently wrong. n=8 photos — small.
- Price coverage in this browser set (final code): 5 of 8 products priced; 0 wrong-model prices; 1 wrong price
  (Canon ₪42,500) found and fixed. All prices are LOW confidence.
- Full machine time per fresh scan (identify + price requests), n=11 scans: **p50 22.0 s, p90 ≈25 s**. Identify p50 7.9 s.
- Repeat scan of the same product (research reused): price **1.3 s** after the last answer; whole scan ≈9.2 s (n=1).
- Market index: Production read OK (641 ms, in parallel with the cache read) and writes OK; the fast path did NOT serve
  any of these scans (no current, strong evidence under those product keys yet).
- Condition: choosing a condition reprices locally (0 new requests). "Faulty" with no faulty ads now shows the market
  price as context only (fixed 9748891).
- Listing: draft opens with the identity, description, the seller's phone/area; the price is empty for a condition
  without evidence; the seller's own price is kept; Back returns to the result. **Publish was NOT pressed**: the founder
  does not own these items, and a published test ad would be a fake public listing. Listing completion is unmeasured.
- Saved results: "My scans" lists every scan; it showed the range midpoint (₪1,085) instead of the worth (₪950) — fixed.

Defects found and fixed today: faulty-condition headline, confirmed model not in name/title, saved worth ≠ shown worth,
Canon outlier pricing (three iterations). Still open: confirmed Apple Watch series not in its name; no size question for
a watch; a Production scan re-searches when the model words its identification differently (research key includes the
query wording); the service-worker "update available" banner did not appear once while a new version was waiting.

## 9. Listing test and latency, 2026-11-13 (Production c659004)

- **Listing publish is broken in Production, root cause found.** The Storage bucket `listings` does not exist (only
  `avatars`, `verification-photos`, `scan-lab`); its policies do (20260519000007). The app uploads every listing photo
  there and refuses to publish without one, so no listing has been created since 2026-07-17 (all 45 existing rows hold
  base64 photos). Also fixed on the way: `fetch(data:)` was refused by the CSP (8448e70), and the failure was invisible
  (c659004 shows it). **Fix prepared, NOT applied (permission guard): migration 20261113150000** (public bucket, ≤5 MB,
  JPEG/PNG/WebP). The QA test listing was therefore never created (DB check: 0 rows titled "GetWorth QA Test%").
- **Latency from Production telemetry (server time; add ~1 s network):** cold scans n=11 — identify+market p50 19.7 s,
  p90 23.0 s (market p50 12.6 s, p90 15.9 s); repeat scans n=3 — p50 7.1 s, p90 7.3 s (market 0.4–0.6 s). Index read
  233–903 ms in parallel with the cache read; the index served one scan outright and joined the pool in four.

## 10. Marketplace workflow verified end to end, 2026-11-13 (Production f9bf660)

- **Bucket:** migration 20261113150000 applied after founder approval (project xbwxbdxuklrbnkpgonjc; bucket absent
  before; policies: authenticated insert/update/delete only in the own-uid folder, public read; public, ≤5 MB,
  JPEG/PNG/WebP; rollback refuses while any object exists). Note: the public SELECT policy also lets anyone LIST object
  names (user-id folders) — as designed in 20260519000007, not changed.
- **QA listing `d2e66c1e-86f7-4ab0-8a1c-ad57fdfe5ba5`:** scanned iPhone 12 → model question → storage "not sure" →
  ≈₪950 / ≈₪1,300 / ≈₪870 (low) → condition good → draft → title "GetWorth QA Test — Temporary Listing", own price
  ₪999 → published 11:04 UTC ("המודעה שלך פורסמה!"). Row: price 999, price_source seller_entered, condition used,
  valuation linked, status active, 1 photo in Storage + thumbnail. Anonymous REST read returned it; photo URL HTTP 200
  (199 KB). Opened from My listings → /listing/d2e66c1e… (photo, ₪999, used, description correct; title showed the AI
  Hebrew name — fixed in 7038609). Deleted via the app's trash + confirm sheet → "המודעה נמחקה"; row status `deleted`
  (soft delete by design), anonymous read returns [], Storage objects in `listings` = 0, photo URL HTTP 400.
- Fixed and live (7038609, f9bf660): seller's title wins over the AI Hebrew name; description drops sentences naming
  an unchosen candidate; confirmed series joins the name (verified live: "Apple Watch Series 4"); research shared
  across wordings (product key); update banner — verified live: with 7038609 running, the banner for f9bf660 appeared
  on its own and the app's Update button loaded it.
- Open: the Apple Watch Series 4 price (≈₪900, low) rests on an Ivory refurbished unit and a Homeless ad titled only
  "שעוני אפל ווטש" — weak evidence, shown as such. Edit/delete icon buttons on My listings lack accessible labels. A
  listing's own page offers "message seller" to its seller.

## 11. Final hardening, 2026-11-13 (Production 5390628, dpl_8TQKwizFY3R97gamvF7Yaxm6gEYP)

- **Apple Watch Series 4 ≈₪900 — root cause:** identity = family "Apple Watch" (model null, exact false) + owner-confirmed
  "Series 4". Its name runs reduce to "watch", so a Homeless category row titled only "שעוני אפל ווטש" (₪1,000) bound as
  verified_row/close_comparable; the Ivory refurbished Series 4 (₪1,699, shop page) then joined as supporting evidence
  (refurbished alone is set aside). **Fix (dd61e4f):** a row must state the number of a confirmed generation/series/year
  (`row_does_not_state_the_confirmed_generation`); RESEARCH_VERSION 5 (5390628) so research bound by the older rule is
  not reused. Re-scan on Production: **no price** (fresh search). Replays unchanged (11/20, 10/20, 9/20).
- **Canon regression:** fresh Production scan ≈₪4,400 (range ₪2,200–4,800, low) from three genuine 5D Mark III ads
  (₪4,900 current exact, ₪3,000 old, ₪2,000 comparable) — no outlier; the ₪46,970 case stays covered by tests.
- **Storage (20261113170000, APPLIED):** rehearsal on Production (rolled back): before — anon/owner/other user each see 1
  object; after — anon 0, owner 1, other user 0. Live: with the QA photo in the bucket, anonymous list of the root and
  of the owner's folder both return []; the public photo URL returns 200; the owner's delete removed the object.
- **QA listing #2 `2937abf6-c0ae-447a-a330-df3902c1c1b1`:** published at ₪999 (seller_entered, title_hebrew empty →
  seller title shown in Hebrew), anon-visible, opened from My listings (labelled edit/delete buttons, no "message seller"
  on own listing), deleted → status deleted, anon [], 0 objects, photo 400.
- **Identification profile (Production, n=16):** total p50 7.3 s / p90 8.3 s = OpenAI 6.9 s (first token 1.6 s; ~460 output
  tokens ≈ 5.3 s of generation) + quota 0.48 s + auth ~0. Image p50 186 KB, ~4k input tokens. NOT changed: running the
  quota beside the model call would let rate-limited requests start paid calls; shortening the output needs the labelled
  accuracy benchmark first. Before = after.

## 12. Price stability, identification benchmark, mobile QA, 2026-11-13 (Production 89411a0, dpl_Fepb5YvL6esjNdCk4hUC1gLjfM6h)

- **iPhone 12 ₪950 → ₪1,300 root cause:** two searches reached different Homeless ads (09:29: ₪1,050 exact + ₪2,000, ₪800,
  ₪1,450; 11:44: ₪2,000, ₪1,400, ₪1,200, ₪1,450) — search variance on sparse evidence, no wrong model, no outlier, no
  classification change; the 7-day pool that normally merges searches was empty for the second one because RESEARCH_VERSION
  5 (11:30) changed the cache keys. Pooled, the eight ads give ₪1,250 (range ₪950–1,750), still low (storage unknown).
  Regression test MI-18 on the real evidence (tests/fixtures/iphone12-two-searches-2026-11-13.json). No freezing added.
- **Coverage / confidence (current code, replays):** original recordings 11/20 (2 medium, 9 low); live run 1 10/20
  (4 medium, 6 low); live run 3 9/20 (6 medium, 3 low). Unpriced = no current Israeli second-hand ad tied to the exact
  product (most), or too few comparables. "High" needs ≈3 agreeing current Israeli ads — searches return 1–4.
- **Identification benchmark (18 labelled Commons photos, production config, $≈0.36):** full-size 11 correct / 0 wrong-
  confident / 7 hedged, p50 6.5 s p90 9.2 s, 465 output tokens; 768 px 9 / 0 / 9, p50 6.2 s p90 7.1 s — rejected (−2
  correct). No identification change shipped; Production identify p50 7.3 s.
- **Mobile QA:** Playwright-core 1.64.1 driving installed Chrome with iPhone SE (320), iPhone 13 (390), iPhone 15 Pro Max
  (430) profiles — Chromium emulation, NOT Safari/WebKit and NOT hardware: home and browse RTL, no horizontal overflow, no
  page errors; header icons 32–36 → 44 px, View All 20 → 44 px. Signed-in 390×787 window (same session): scan → model
  question → no-price screen, no overflow; scan close and update-banner buttons → 44 px. Remaining small: category chips
  42 px tall, gallery-upload pill 36 px tall.
- **Flaky test V2-30h:** it timed the module's first cold call under the parallel suite; now judges the fastest of five
  warm runs. Full suite 2,145 pass / 0 fail / 1 skip, twice.
- **Device-only checks left for the founder (real iPhone, installed PWA):** camera capture and permission prompt, HEIC
  from the photo picker, safe-area insets (notch/home bar), update banner after a deploy, Hebrew keyboard input in the
  listing form, scroll of the evidence sheet with a thumb, offline/poor-network behaviour.

## 13. Founder's real iPhone scan — DualSense, no price (scan dcb5196d, 2026-11-13 12:57–12:58 UTC)

**What happened (Production telemetry).** Installed PWA, founder account. Identify 5.5 s → "Sony DualSense Wireless
Controller", high confidence, exact model. Price 1: fresh search 10.2 s — 39 pages (12 Reddit, 3 Wikipedia, PlayStation,
TechRadar…; ad.co.il 2, bidix 2, KSP 2, Zap 2), **0 prices reported**. Re-identify 5.9 s; price 2: fresh search 17.8 s —
local 41 pages: GoodGame ₪289 new (unbound: another price between) and Ivory ₪288 new (weak: purple variant, price not
beside name); expand 42 pages incl. 7 Homeless: one ad reported — "שלט לסוני DualSense edge" ₪600 → correctly another
model. Owner then confirmed "Custom replacement shell"; price 3 reused the same research (0.36 s). no_price_cause: no
Israeli second-hand ad of the standard model tied. **The custom shell did not narrow the search** (not a search attribute)
and **no source-permission refusal** occurred. Cost ≈ 2 × $0.024.

**Leads checked by hand (one browser view each, no collection):** Homeless 1063159 — "שלט פליסטישן סוני 5 שחור", ₪270,
"new from the box, bought 12.11 at Bug for ₪330", **ad no longer available** → a sealed, expired private ask (new_sealed
band at best, never a current used price). KSP — DualSense white ₪279 / Midnight Black ₪264 new (Eilat prices excluded) →
new-retail reference only. bidix price guide — **could not be opened** (connection reset); a guide is context, never a sale.

**Root causes and fixes (all live):**
1. Israeli sellers do not write "DualSense": the identity's only alias was English ("PS5 controller"); Hebrew words were
   compared letter for letter ("פליסטישן" ≠ "פלייסטיישן"); the brand sat inside the name ("שלט פליסטישן **סוני** 5").
   → identity prompt asks for the Hebrew words sellers write (f3c63cc); Hebrew words ≥4 consonants match by consonants;
   brand words are passed over inside a name; a Hebrew seller name with a number names an established product
   (`hebrewNamesProduct`, c615286) — searched as written (no more "שלט פלייסטיישן 5 DualSense Wireless Controller") and
   tied; the model's own numbers and edition words must be in it (never the Edge, never אייפד 10 for iPad 9).
2. Re-scan 13:23 showed "new, sells for about ₪30": playstore.co.il sells it for ₪275 (page checked); ₪29 was another
   number. → points/instalment numbers are never a price; an Israeli new price below half of the exact used/sold/guide
   median or of the other shops is not the new price (ba61886).
3. A confirmed modification (custom/replacement shell) → the market price is presented as a STANDARD unit's, "effect on the
   price not verified"; list/quick hidden; listing draft starts empty (f3c63cc).

**Result after the fixes (Production re-scans 13:14, 13:23, 13:41 UTC; controlled live runs ~13:50):** identification
correct every time; the Homeless ₪270 ad is now found and tied, and correctly not used as a current used price; **still no
price** — open search (30 pages, 12 Reddit) and an Israeli-sites-only search (18 Israeli pages) both found **zero current
used ads for a standard DualSense** with a price. The no-price is now an absence of readable evidence, not a discard.
Outcome shown: "found 1 Israeli second-hand ad, none a current used one" + sell at your own price.

**Coverage before/after:** replays unchanged (11/20, 10/20, 9/20) — the fixes add evidence only where ads in seller wording
exist. **Latency (Production, server, today):** cold n=23 identify+market p50 19.2 s / p90 23.0 s; repeat n=5 p50 7.1 s /
p90 8.0 s.

## 14. Israeli market-data acquisition — feasibility audit and measured ceiling (2026-11-13, Production 8174678)

**Source by source** (robots.txt fetched once per site; terms read where reachable; terms read 2026-11-12 for Homeless /
ad.co.il / Yad2 in docs/partnerships/israeli-market-data.md). "Scan-time" = the price appears in OpenAI web-search results a
person's own scan triggered; "automated" = a GetWorth job fetching the site.

| Source | Automated commercial access | Item listings + prices | Bind to exact product | Dates / condition | Retain / refresh | Measured contribution |
|---|---|---|---|---|---|---|
| Homeless | **No** — terms forbid robots + commercial use (robots.txt itself permissive) | Yes, ad pages with price in title | Good when the title names the model | Some dates; condition in text | Scan window only (7 d) | The main Israeli source in every priced result |
| ad.co.il | **No** — written permission required | Mostly archive / category pages | Weak (rows off list pages) | Archive = expired | Scan window only | Rarely binds; archive excluded |
| Yad2 | **No** — operator pursues unauthorised collection; bot wall | Collection pages, no prices in snippets | — | — | Not used | 0 (removed from queries) |
| Facebook Marketplace | **No** — Meta terms; robots disallow | — | — | — | Not used | 0 |
| zuzz.co.il | **No** — terms §9: no manual/automated collection, no commercial use | Some | Unmeasured | — | Scan window only | ~0 seen in results |
| KSP | **No** — bot protection blocks automated requests | New prices only | 34% of all IL new prices bind (below) | In-stock flags | Scan window only | New-price reference only |
| playstore.co.il | **No** — terms forbid automated collection + commercial use | New prices | — | — | Scan window only | New-price reference only |
| Zap, Ivory, Bug | **Unknown** — terms not readable / not found without a browser session | New prices / comparison | 34% bind rate overall | — | Scan window only | New-price reference only |
| eBay Browse API | **Yes** (official API, free keys — not configured) | Abroad used/sold | Good (structured) | Yes | Per API terms | Abroad context only — never an Israeli price |
| GetWorth marketplace | **Yes** (own data) | 45 listings, all base64 test data; **0 genuine completed sales** | Exact (scan identity) | Yes | Yes (history) | 0 today |

**The one permitted channel in use — OpenAI web search over public search results — measured on the fixed 20-product set:**

| Acquisition approach | Priced / 20 | Notes |
|---|---|---|
| Open search, single run (live run 1) | 10 | 12 of ~30 local-stage pages are Reddit |
| Israeli-sites-only search (allowed_domains), single run (live run 3) | 9 | slower; finds different items |
| Union of both, run in parallel per scan | 11 | +Bugaboo Fox 3 from one ad (low) — +1 search call/scan |
| Three runs accumulated through one store (what background refresh / product reuse gives) | 10 | the same ads recur; the model classifies the same ad differently between runs (PS5 ₪1,800: exact in one, sibling in another) |
| Founder's DualSense (open and IL-only, live) | 0 / 1 | zero current used standard DualSense ads reachable; the only Israeli ad is an expired new-in-box ask |
| Israeli new-retail prices that bind to the product (Production, since 2026-11-01) | 10 of 29 (34%) | snippets show the price apart from the name, without ₪, or between other prices |

**Conclusion — a business dependency, measured:** with every currently permitted source, defensible Israeli second-hand
coverage plateaus at **≈50–55% of common products, almost all low/medium confidence**, and accumulation does not raise it.
More matching patches move single items, not the plateau. The step change requires **licensed, structured Israeli
second-hand data** (Yad2, Homeless or ad.co.il under a written data agreement, or a GetWorth marketplace with real
completed sales) — a founder/business decision; no provider was contacted. Engineering delivered against this limit: the
new-price reference is now its own card (shop, date, stock; bd65889), product-level research reuse and the 7-day pool make
repeat scans ≈7 s, and the registry blocks automated collection from every source whose terms forbid it.
