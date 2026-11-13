# Market Intelligence V5 — internal status, demo checklist and measured metrics

**INTERNAL — not for distribution.** Contains measured performance, source-licensing status and roadmap. Do not share with
marketplaces, data providers or the public. Prepared 2026-11-13.

## 1. What was built (commit c31c8ad, branch feat/core-scan-001)

| Capability | Where | State |
|---|---|---|
| Source registry with explicit permission states (authorized / authorized_restricted / public_research_only / not_authorized / unknown) | `api/_lib/market/sources.js` | Code done, tested |
| Enforcement: no automated retrieval or long-term history without permission; Yad2/Facebook prices never used, even from a scan's own search | `sources.js`, `service.js`, `structured-data.js` | Code done, tested |
| Normalised observation schema, with private asking / completed sale / refurbished / new retail / price guide kept separate | `api/_lib/market/observations.js` | Code done, tested |
| Feedback-loop guard: GetWorth estimates, recommended prices and engine-priced listings can't become evidence | `observations.js` (`isSelfGenerated`) | Code done, tested |
| Market index: observations by product, appended price history, retention set by permission, deduplication by listing fingerprint | `api/_lib/market/index-store.js`, migration `20261113120000` | Code done; **migration NOT applied to Production** (needs founder approval) |
| Fast path: indexed evidence that is current for the item's kind and strong enough on Israeli evidence prices with **no search**; otherwise it joins the live research pool | `api/_lib/scan/service.js` | Code done, tested; works only once the migration is applied |
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

## 3. Measured metrics (sample sizes stated; nothing extrapolated)

| Metric | Value | Method / sample |
|---|---|---|
| Defensible price coverage, offline | **10 / 20 (50%)** | Fixed 20-item replay of recorded live searches (`scripts/il-coverage-eval.mjs`), re-run on c31c8ad on 2026-11-13. Not a Production rate. |
| Of those 10, confidence | 2 medium, 8 low | Same replay |
| Identification latency | p50 7.8 s | Production telemetry 2026-11-08..11-12 (small n; founder and test scans) |
| Fresh market research latency | p50 12.1 s | Same window |
| Reused research latency | ~0.8 s | Same window |
| Research cache hit rate | 39% | Same window, before the product-keyed index |
| Cost per fresh research | mean $0.021 (range $0.012–0.024) | 10-product controlled test, 2026-11-08 |
| Identification accuracy | 10/18 exact, 0 confidently wrong | 18 labelled photos, V3 benchmark 2026-11-08 |
| Valuation accuracy against real sales | **unmeasured** | 0 genuine completed marketplace sales |
| Full scan in ~6 s | **not met** | Cold scan ≈ identify 7.8 s + research 12.1 s; a reused or indexed product ≈ identify + ~1 s |

Do NOT claim: 80% coverage, six-second scans, verified transaction-price accuracy or a proprietary Israeli price
database. None of these is supported by measurement today.

## 4. Investor demo checklist (real Production, no staging tricks)

1. **Pick candidates from evidence, not hope.** In the replay, the best-evidenced items are the iPhone 13 (≈₪990, medium
   confidence) and the Nintendo Switch OLED (≈₪900, medium). PS5, Apple Watch 8, iPad 9, MacBook Air M1, Canon 5D III and
   Dyson V11 priced with LOW confidence. Exclude the AirPods Pro 2 (priced from one ad, probably low).
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

## 6. Remaining limitations

- Coverage is limited by Israeli data licensing, not by code (see §2).
- The negotiation allowance (`NEGOTIATION = 0.9`) and the quick-sale rule are heuristics, labelled as such, and not
  validated against Israeli transactions.
- The refresh intervals are proposed defaults. Price-history rows (`market_observation_prices`) will let them be tuned
  once enough sightings accumulate.
- Identification at ~7.8 s p50 sets the floor on scan time. A faster model scored worse on the labelled benchmark.
