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
