# GW-MARKET-DATA-001 — The GetWorth Market Data Layer: design audit and architecture

**Type:** Design / code audit. **No code was changed; no provider was called; nothing was deployed.**
**Date:** 2026-10-05
**Branch:** `scan-engine-v2` @ `6857691` (GW-SCAN-V2-001 committed, not pushed)
**Depends on:** `docs/audits/GW-SCAN-V2-001.md` (the coverage finding this document answers)

Evidence labels: `CODE FACT` (this repository) · `CAPTURE FACT` / `PROBE FACT` (GW-SCAN-V2-001's persisted capture and two probes) · `DOC FACT` (a provider's public documentation or a site's robots.txt, read on 2026-10-05) · `INDEX FACT` (a general web index consulted on 2026-10-05 from this session's own search tool, not GetWorth's provider) · `UNMEASURED`.

---

## 1. Commit / staging result

| | |
|---|---|
| Commit | `6857691` on `scan-engine-v2` — "feat(scan-v2): a plan that never halves itself, a configuration for every listing, and an estimate only behind a measured factor" |
| Staged | exactly the 29 files of GW-SCAN-V2-001 §6.4: 21 modified, 8 new |
| `package.json` | staged as HEAD's content plus one insertion (`tests/scan-v2-resolution.test.mjs` in the test list); the unrelated `pricing-evidence` entry stays unstaged |
| Not staged | 14 modified + 11 untracked unrelated V1 / Phase-B files (`api/analyze.js`, `api/_lib/phaseb/*` except the two data fields in `config.js`, `api/_lib/valuation-guard.js`, `src/views/CameraResultsView.jsx`, scripts, older audit docs, `pricing-evidence`, `query-planner.js`) — shown by `git status` before the commit |
| Validation of the exact commit | a detached scratch worktree at `6857691`: nine V2 suites + provider-discovery + round5 provider controls + phaseb-isolation, **343 / 343 pass** |
| Pushed / deployed | **No.** Pushing was not previously authorised; Production untouched |
| Paid provider calls in this phase | **Zero.** |

---

## 2. The proven market-data coverage problem

`PROBE FACT` + `CAPTURE FACT` (GW-SCAN-V2-001 §0, §2): across 76 results for the witness under its printed and market names, and a 27-result iPhone 13 control, the OpenAI `web_search` tool returned **no yad2 or Facebook Marketplace listing page**. Retail recall was high (nine exact-product shop pages) but most excerpts carried no price.

`INDEX FACT` (this document): a general web index **does** hold yad2 listing URLs — `yad2.co.il/item/2_98_963`, `yad2.co.il/market/item/9050168655932` were returned for a plain query. So yad2 listing pages are indexable and indexed somewhere; the gap is specific to the provider GetWorth uses. `DOC FACT`: yad2's robots.txt does not disallow `/item/` or `/market/item/` and publishes sitemap indexes (taxonomy-level; no listing-level sitemap was visible). But the site answers a non-browser fetch of its homepage with a Radware bot-management challenge — direct retrieval is actively controlled, and is therefore **not** a permitted route without yad2's agreement.

So the problem has three parts, and only the first is about search:

1. **Discovery:** the current provider's index does not surface the local listing pages that exist.
2. **Access:** the two sources that are the Israeli second-hand market (yad2, Facebook Marketplace) offer no public API and both manage automated access.
3. **Calibration:** with no local used observations, the only honest fallback is a *measured* resale relationship, and none has been measured.

Everything below is built around separating those three.

---

## 3. Market Data Layer — architecture

### 3.1 Five layers, five questions

```
A  RECOGNITION          what is in the photograph?            api/_lib/v2/identity.js, sufficiency.js, calibration.js   (exists)
B  MARKET IDENTITY      what is it called in commerce?        api/_lib/v2/market-identity.js + the identity memory      (exists; memory reuse new)
C  MARKET DATA          where are the price observations?     NEW  api/_lib/v2/market/  (orchestrator + providers)
D  EVIDENCE NORMALISER  one listing schema for every source   NEW  api/_lib/v2/market/listing.js; extraction/configuration/source-type reused
E  VALUATION            what is this item worth?              api/_lib/v2/evidence.js (tiers, gate) + pricing.js (states)  (exists; hierarchy renamed)
```

Today's `runV2Price` collapses C and D into one call to `runV2Search` → `extractListings`. `CODE FACT`: the search adapter contract already exists in V1 as `createMarketResearch().search(query) -> { observations, provenance }` (`api/_lib/phaseb/market-research.js`), and V2's `search.js` returns `{ outcome, provenance, timings }`. Neither is a provider *class*; both are "the one search".

### 3.2 The provider interface

```js
// api/_lib/v2/market/provider.js  (contract only; providers implement it)
export const PROVIDER_CLASS = Object.freeze({
  LOCAL_USED: 'LOCAL_USED', LOCAL_RETAIL: 'LOCAL_RETAIL',
  INTERNATIONAL_USED: 'INTERNATIONAL_USED', INTERNATIONAL_RETAIL: 'INTERNATIONAL_RETAIL',
  SEARCH_DISCOVERY: 'SEARCH_DISCOVERY', HISTORICAL: 'HISTORICAL_CALIBRATION',
});

/**
 * @typedef MarketEvidenceProvider
 * @prop {string}  id                       e.g. 'openai_web_search', 'ebay_browse', 'identity_memory'
 * @prop {string[]} classes                 PROVIDER_CLASS values this provider can supply
 * @prop {(identity, market, evidenceClass) => boolean} supports
 * @prop {(identity, ctx) => Promise<RawResult>} search   ctx: { market, level, deadlineMs, signal, budget }
 * @prop {(raw, ctx) => NormalizedListing[]} normalize    pure, deterministic, no I/O
 * @prop {{ cost_per_call_usd, typical_ms, max_results, rate_limit }} profile
 */
```

Rules the contract enforces (tests, not comments):

- `search` is **total**: it resolves to `{ outcome, raw, timings, billed }` and never throws; a timeout or an abort is an outcome.
- `normalize` is **pure** and runs on the raw record the platform or API returned, never on model prose (the V2 doctrine from `search.js`).
- A provider declares what it **cannot** say (e.g. eBay Browse: no "sold" status; OpenAI search: no listing timestamp), and the normaliser fills those fields with `null`, never a default.
- Every normalised listing carries `provenance: { provider, request_id, retrieved_at, raw_ref }`.

### 3.3 The orchestrator

```
identity + market identity (incl. memory hit)
   │
   ▼
Market Data Orchestrator  (api/_lib/v2/market/orchestrator.js)
   ├── plan: which providers, which queries, which budget per provider
   ├── run:  Promise.allSettled over the chosen providers, each with its own AbortSignal and deadline
   ├── stop: when a tier-A quorum is admitted from completed providers, abort providers that can only
   │         supply lower tiers (C, D, E) — never abort a higher-tier provider for a lower-tier result
   └── ledger: one row per provider: planned, started, completed/aborted/timed-out, results, cost, ms
   │
   ▼
Evidence Normaliser → cross-provider dedupe → tiers → gate → valuation (existing evidence.js / pricing.js)
```

Early stopping is **tier-ordered**: a provider's declared classes say which tiers it can produce; the orchestrator cancels only work that cannot raise the verdict. With one provider (today) the orchestrator degenerates to the current single search, so the migration is additive.

### 3.4 Normalised listing schema

`NormalizedListing` (the shape every provider's `normalize` emits; the existing `entries` of `extractListings` already carry most fields and would be lifted into it):

| field | notes |
|---|---|
| `provider`, `provider_class` | from the provider |
| `source_type`, `locale` | `source-type.js` (host-decided) |
| `market` | ISO country of the listing's market, not of the currency |
| `url`, `listing_id` | id from the API when there is one; else `listing-identity.js` (url id / fingerprint) |
| `title`, `text_excerpt` | third-party text, clipped |
| `canonical_identity` | `{ brand, model, model_number, exact_roots }` the market-identity stage resolved |
| `relation` | EXACT / REGIONAL_VARIANT / SIBLING / FAMILY / OTHER_PRODUCT / UNKNOWN |
| `configuration` | `configuration.js` |
| `condition` | provider-stated (eBay `condition`) or lexicon-read; `null` when unsaid |
| `price`, `currency`, `currency_basis` | marker / site_locale / api |
| `shipping` | `{ amount, currency }` or null |
| `status` | `active` / `sold` / `ended` / `unknown` (sold only from a provider that states it) |
| `seller_ref` | opaque, when the provider gives one; never a person's name |
| `observed_at`, `listed_at`, `freshness` | provider timestamp; excerpt "Crawled: 2 weeks ago" parsed to a range |
| `extraction_confidence` | `marker` price on own sentence = high; row-bound = medium; locale-inferred = low |
| `identity_confidence` | from relation and the calibrated identity |
| `qualification_state`, `rejection_reason`, `tier` | from `evidence.js` |
| `provenance` | `{ provider, request_id, retrieved_at, raw_ref }` |

### 3.5 Cross-provider deduplication

A listing is one listing however many providers indexed it. Keys, in order (reusing `listing-identity.js`, which already does the first two for one provider):

1. canonical URL (device subdomain and tracking parameters removed);
2. provider listing id, namespaced by site (`ebay:1234`, `yad2:9050168655932`);
3. fingerprint: site + normalised title + price + location, **only** when 1 and 2 are absent;
4. **cross-site syndication**: same title tokens + same price + same stated location on two sites within the same market → one observation, attributed to the earlier `observed_at`, flagged `syndicated_from`.

Dedupe runs **before** the quorum and source-diversity counts, and the count of removed duplicates is reported (it already is for one provider).

### 3.6 Caching, three stores, three lifetimes

| store | what | lifetime | exists today? |
|---|---|---|---|
| **Product identity cache** | read name → canonical market identity (exact roots, siblings, regional variants, aliases, kind), with `established_by` (sites), `version` of the resolver | long (months); invalidated by resolver version | **Yes, in V1:** `recognition_memory` (canonical key, aliases, `key_attrs`, confirmation counts, `memory_lookup` RPC, service-role only). V2 can read it without a schema change; writing V2's exact roots into `key_attrs` under a versioned key needs a migration review (it is a JSON column, no DDL). |
| **Market evidence cache** | normalised listings per canonical identity, with `observed_at`, provider, TTL | short: 24–72 h for active listings; a cached listing is reported with its `observed_at` and the state is never VERIFIED from cache alone (a verified value needs at least one fresh provider completion) | No. Needs a table (`market_listings`: identity key, provider, listing id, normalised fields, observed_at, expires_at) → **schema change, approval required**. Until then: no cross-scan cache; per-scan dedupe only. |
| **Calibration data** | `(category, product_class, condition) → resale factor` with provenance | until re-measured; dated | `resale-factors.data.js` (empty), `scripts/valuation-calibration.mjs` (measures, refuses thin data) |

Stale evidence never becomes current evidence: a cached listing contributes to `MARKET_INFORMED_ESTIMATE` context and to calibration, never to `VERIFIED_*` states, unless re-observed within the TTL.

### 3.7 Valuation hierarchy (rename of today's states; the machinery exists)

| new | from today's | requirement |
|---|---|---|
| `VERIFIED_LOCAL_USED_MARKET` | `VERIFIED_MARKET_VALUE` (token from tier-A listings) | ≥3 tier-A listings, ≥2 independent local sites, guard accepted |
| `VERIFIED_USED_MARKET` | new | tier-A below quorum **plus** tier-B exact used listings converted at the Bank of Israel representative rate with a dated proof, together meeting the quorum; disclosed as mixed-market |
| `MARKET_INFORMED_ESTIMATE` | exists (gated) | product-level identity + local exact retail anchor + **measured** factor with sample ≥ floor |
| `INSUFFICIENT_EVIDENCE` | `NO_PRICE_EVIDENCE` / below-quorum / need-more | everything else, with `limitation` |

Recognition confidence and pricing confidence stay separate fields (already the case).

---

## 4. Source-access matrix (Israeli second-hand market and its complements)

Access forms: **API** (official), **INDEX** (reachable through a search provider's index), **STRUCTURED** (page carries machine-readable data), **RETRIEVAL** (permitted direct server-side fetch), **NONE**.

| source | role | official API | reachable via current provider? | reachable via a general web index? | direct retrieval | verdict |
|---|---|---|---|---|---|---|
| **yad2.co.il** (incl. `market.yad2.co.il`) — the Israeli second-hand market (~160k product listings, `INDEX FACT` via a yad2 description) | LOCAL_USED | **None public** (`DOC FACT`: no developer portal; only third-party scraping products exist) | **No listing pages** in 76 + 27 results; index pages only (`PROBE FACT`) | **Yes** — listing URLs `/item/…`, `/market/item/…` returned by a general index (`INDEX FACT`) | robots.txt permits `/item/`; the site serves a Radware bot challenge to non-browser clients (`DOC FACT`); terms of use not readable without passing it → **treat as controlled; no retrieval without yad2's written permission** | Discovery via a provider whose index holds yad2 pages is the only legitimate route today. Partnership / data agreement is the long-term route. |
| **Facebook Marketplace** | LOCAL_USED | **None** for reading listings (Content Library API is for accredited researchers only; Partnerships programme is for *publishing* inventory) (`DOC FACT`) | No | Listings are login-walled | Not permitted | **Unavailable.** |
| **market2.co.il**, **agora.co.il** (free giveaways), niche boards | LOCAL_USED (minor) | none | market2 index page appeared once (`PROBE FACT`) | partial | unknown ToS | Marginal; include only through discovery, never targeted. |
| **Israeli shops** (ivory, super-pharm, office depot, cwc, bug, ksp …) | LOCAL_RETAIL | none public | **Yes**, product and category pages (`CAPTURE FACT`, 9 exact pages) | yes | most are ordinary retail pages; JSON-LD `Product/offers` is common (`UNMEASURED` per shop) | Already the anchor source. Price-in-excerpt is the weak point; structured data would fix it but requires opening pages, which the V2 doctrine forbids today (§13/§40) — a Plan A decision. |
| **zap.co.il** (price comparison) | LOCAL_RETAIL aggregate | none public | **Yes**, model and category pages with prices in excerpts (`CAPTURE FACT`) | yes | n/a | Best local retail-price density per result; keep as a discovery target by *kind* (price-comparison), not by name. |
| **eBay** (`ebay.com`, `il.ebay.com` localisation) | INTERNATIONAL_USED (+ some new) | **Browse API**: `item_summary/search` by keyword/GTIN, price, currency, condition, item location, shipping, `itemWebUrl`; application (client-credentials) token; marketplace via `X-EBAY-C-MARKETPLACE-ID`. **`EBAY_IL` exists as an id but Browse is not supported for it**; use `EBAY_US` / `EBAY_GB` / `EBAY_DE` (`DOC FACT`). **Marketplace Insights** (sold prices, 90 days) is **limited release**, approval by eBay required. Call limits are per application (Developer Analytics API) | Yes, occasionally (`PROBE FACT`: one base-only item) | yes | n/a (API) | **The viable tier-B source.** Free API key; no payment; needs an eBay developer account (a new *provider*, not a paid one — approval per §34). Converted prices on `il.ebay.com` are still abroad (already handled). |
| **swappa, backmarket, mercari, vinted, craigslist** | INTERNATIONAL_USED / refurbished | swappa: none public; backmarket: none; mercari: none; craigslist: none; vinted: none | craigslist yes (`PROBE FACT`), swappa yes | yes | not permitted / unknown | Discovery-only context; craigslist/swappa titles carry prices. |
| **OpenAI `web_search`** (current) | SEARCH_DISCOVERY | tool; supports `user_location` and **`filters.allowed_domains` up to 100 domains** (`DOC FACT`) | — | — | — | Stays as one provider. **Untested, cheap, decisive:** a domain-filtered search (`allowed_domains: ['yad2.co.il']`) tells whether the index holds *any* yad2 listing page. Requires one approved paid call. |
| **Brave Search API** | SEARCH_DISCOVERY | $5 / 1,000 queries, `country`, `count ≤ 20`, 50 rps, $5 monthly free credit (`DOC FACT`) | — | its index coverage of yad2 is `UNMEASURED` | — | Candidate second discovery provider; benchmark before adoption (new provider → approval). |
| **Google Custom Search JSON API** | SEARCH_DISCOVERY | **closed to new customers; shuts down 2027-01-01** (`DOC FACT`) | — | — | — | Not viable. |
| **Bank of Israel** `PublicApi/GetExchangeRates` | FX for tier B | free JSON, daily representative rates (`DOC FACT`) | — | — | — | The rate source `market-evidence.js`'s V-FX proof was designed for; a new network dependency → approval. |
| **GetWorth's own data** (`recognition_memory` + samples, `price_observations`, `observations`) | HISTORICAL / identity | internal | — | — | — | Identity cache exists; scan-price history exists for calibration input (V1-written; V2 writes nothing yet). |

**Answers to the research questions**

1. *Required sources:* for general goods in Israel the market **is** yad2 plus Facebook Marketplace; everything else is marginal. Retail anchors come from shops and price-comparison pages, already reachable.
2. *Access forms:* table above. No source in the local used class offers an official API.
3. *No bypassing:* yad2's challenge page and Facebook's login wall are access controls; neither is to be worked around. Third-party "scraper APIs" for yad2 exist commercially and are **not** proposed.
4. *Can the existing provider retrieve individual listing URLs?* Shops: yes. yad2: **no** (76 + 27 results, zero). Facebook: no. eBay/craigslist: occasionally.
5. *Would a different legitimate provider help?* A general index demonstrably holds yad2 listing URLs; whether a purchasable search API (Brave; OpenAI with domain filters) exposes them is `UNMEASURED` and is the first benchmark question. Expectation, stated as a hypothesis: domain-filtered OpenAI search is the cheapest test; Brave's index is the most likely improvement if OpenAI's own index lacks the pages.
6. *International used as tier B:* yes, eBay Browse gives structured active listings with condition, location and currency, and with the Bank of Israel rate a dated V-FX proof is constructible. Sold prices need Marketplace Insights approval. International evidence must never pose as local (already enforced).
7. *Calibration programme:* §6 below.

---

## 5. Plan A — the production market-data system

**Providers (in order of adoption):**
1. `openai_web_search` — discovery, split into two *profiles* run in parallel: local-market (today's four queries, `user_location: IL`) and **domain-scoped local-used** (`allowed_domains` = the market's used-marketplace hosts, supplied as market data, not code). Two actions in parallel, not serial.
2. `ebay_browse` — tier B exact used listings by model number / GTIN; `EBAY_US` + `EBAY_GB`; Marketplace Insights when approved for sold prices.
3. `brave_search` (or equivalent) — second discovery index, only if the benchmark shows it reaches local listing pages the first does not.
4. `identity_memory` — the existing `recognition_memory` as the product-identity cache (read first; it removes the market-identity cold start for repeat products).
5. `market_listings` cache (new table) — fresh listings per canonical identity with TTL; feeds tier context and calibration.
6. A **yad2 data agreement** is the only route to tier-A coverage at scale; it is a business action, not an engineering one, and the provider interface is designed so it slots in as `LOCAL_USED` when it exists.

**Structured retail prices:** opening the top exact-product shop pages (robots-permitted, 2–3 pages, parallel, 1 s budget) and reading JSON-LD offers would turn "7 of 9 exact pages have no price in the excerpt" into anchors. It reverses the "GetWorth never fetches a URL" doctrine and needs an explicit decision and a per-host permission list; it is listed, not assumed.

**Calibration pipeline:** every scan writes its normalised listings and anchors to the evidence cache; a nightly job builds the calibration dataset for `valuation-calibration.mjs`; measured groups are reviewed and published into `resale-factors.data.js` with provenance.

**Valuation:** the four-state hierarchy of §3.7; FX proofs from the Bank of Israel feed with date; cross-provider dedupe; identity and pricing confidences separate.

**Persistence:** V2 writes a `scan_market_evidence` row per scan (ledger + normalised listings) — the thing the b3888a5 witness lacked — behind the same allowlist.

---

## 6. Plan B — the one-week MVP

**Scope rule:** nothing that weakens qualification, nothing serial, nothing paid without approval, no scraping.

| day | milestone | provider calls per scan |
|---|---|---|
| 1 | **Benchmark the discovery gap** (§7): run the 44-item set through the engine's own search function *offline-replayable*; add one domain-scoped OpenAI search per item (`allowed_domains` = local used hosts) **in parallel** with today's search. Measures: does any local listing page ever appear? | 2 search actions in parallel (same wall-clock as today) — **requires approval: ~44 × 2 paid search actions** |
| 2 | **Orchestrator + provider contract** (`api/_lib/v2/market/`), with `openai_web_search` as the only provider in two profiles, `Promise.allSettled`, per-provider deadline, ledger row per provider. Existing `search.js` becomes a provider. No behaviour change when one profile is configured. | — |
| 3 | **eBay Browse provider** (tier B): application token, `EBAY_US`/`EBAY_GB`, query by corroborated model number only (never by the read name alone), normalised into the listing schema, condition and configuration applied, **context only** until FX is approved. | +1 API call in parallel (~300–800 ms) — **requires approval: new provider (free)** |
| 4 | **FX proof** from the Bank of Israel feed, cached 24 h server-side, dated; tier-B exact used listings become convertible; `VERIFIED_USED_MARKET` (mixed-market) state with its own copy. | +0 per scan (daily fetch) — **requires approval: new dependency** |
| 5 | **Identity memory read** (`memory_lookup`, service role) before market identity; exact roots from memory skip corroboration on repeat products. No writes. | — |
| 6 | **Calibration dataset v0**: export every anchor + admitted listing the benchmark produced into the harness's dataset shape; run `valuation-calibration.mjs`; publish only MEASURED groups (expected: none or very few at n ≥ 5 products). | — |
| 7 | Validation (suites, mutants, builds), the benchmark re-run, report. | — |

**What the MVP will price, honestly stated.** With the current provider the engine prices a used value only where local listings appear in search excerpts; GW-SCAN-V2-001 found none in 103 results across two products, so the base rate is unknown and presumed low. What the MVP *reliably* delivers for a correctly identified common product is: the market name, a STRONG local retail anchor, tier-B international used context, and a stated limitation. A used **number** appears when (a) the discovery benchmark finds local listing pages after all, (b) tier B plus FX reaches the mixed-market quorum, or (c) a resale group gets measured. **No coverage percentage is claimed; §7 is how it is measured.** Categories expected to stay weak regardless: furniture and generic household goods (no model number, no retail anchor), tools in kits (configuration ambiguity), perfume sizes (anchor exists, used supply thin), watches (authenticity-priced).

**Expected product experience after the MVP** for an obvious item: identity at ~3 s; "Checking today's market…"; at ~7–8 s one of: a verified value (rare until local discovery works), a mixed-market verified value (tier B + FX), a market-informed estimate (only where measured), or "Price new ₪X–₪Y from N shops; no reliable second-hand evidence yet", with identification and pricing confidence as two lines.

---

## 7. Benchmark design

**Set:** 44 items, four per category: phones, computer hardware, gaming, audio, small appliances, perfume, shoes, watches, tools, furniture, generic household goods. Each item: 1–3 photographs at the PWA's 1280 px, a ground-truth identity (brand, model, model number if any, configuration), and where obtainable a ground-truth **current** price pair (one local retail price, and a used asking price observed by a human on yad2 on the same day, recorded with URL and date — a human reading a public listing page in a browser is not automated access). Manifest shape: `tests/fixtures/scan-v2/benchmark.example.json`, extended with `ground_truth.used_asking_ils`, `ground_truth.retail_ils`, `ground_truth.configuration`.

**Runner:** `scripts/scan-v2-benchmark.mjs` (exists; billed) extended to record the new fields and to persist every raw provider response under `--out`, so every later question is answered by replay, not by a second paid run.

**Per-item measures (each its own column):**

| measure | definition |
|---|---|
| recognition correctness | brand correct; category correct |
| exact model correctness | model (and configuration) equals ground truth; `OTHER` when a shortlist contains it |
| follow-up rate | decision was NEED_FOLLOWUP |
| identity latency | `identity_complete_ms` server, and client round-trip |
| market-data coverage | results per provider; results with a price in the excerpt |
| exact-used-comparable coverage | tier-A (local) and tier-B (abroad) EXACT, compatible, used listings |
| retail-anchor coverage | anchor strength and shops |
| valuation availability | a number was shown |
| valuation tier | the state / evidence_state |
| valuation error | `|recommended − used_asking_ils| / used_asking_ils` where ground truth exists; anchor error likewise |
| total latency | photo accepted → result rendered |

**Pass criteria, stated now so they cannot drift:** recognition ≥ 95 % brand-correct and ≥ 90 % exact-model-correct on items with a readable name; follow-up rate ≤ 15 %; identity ≤ 4 s; total ≤ 8 s at the 75th percentile; no fabricated evidence (every number traces to a ledger row). Coverage numbers are **outputs** of this benchmark, not inputs to the plan.

**Cost:** 44 items × (1 identity + 2 search actions) ≈ 44 × ~$0.03 ≈ $1.5 per full run, plus eBay (free). Every run is a paid call and needs approval.

---

## 8. Expected latency architecture

```
t=0.0  photo accepted
t≈0.3  identify request leaves (compression done)
t≈3.3  identity + sufficiency on screen                      [1 vision call, unchanged]
t≈3.4  /price: identity-memory lookup (≤50 ms, Supabase RPC)
t≈3.4  orchestrator fans out in parallel:
         openai_web_search (local profile)      ~3.4–4.5 s to results
         openai_web_search (domain-scoped used) ~3.4–4.5 s
         ebay_browse                            ~0.3–0.8 s
         (fx proof: served from a 24 h server cache, 0 ms)
t≈7.9  slowest discovery provider completes (or hits its 4.5 s deadline and is recorded as timed out)
t≈7.9  normalise + dedupe + tiers + gate + valuation   ≈ 10–20 ms  [measured 8.6 ms median today]
t≈8.0  result rendered
```

Wall-clock is bounded by the slowest *parallel* provider, not their sum. Early stop: if the local profile completes with a tier-A quorum, the domain-scoped and eBay calls are aborted (their cost is already incurred for the search action; the saving is wall-clock only). A per-provider deadline (4.5 s) and the function's 30 s ceiling remain; a provider that misses its deadline is a ledger row, not a failure of the scan.

---

## 9. Risks

| risk | mitigation |
|---|---|
| A second parallel search action doubles search cost per scan | Run it only for product-level identities; measure in the benchmark whether it ever finds a local listing; drop it if not |
| Domain-scoped discovery still finds nothing (the index simply lacks the pages) | Then the local used market is not reachable by any search product GetWorth can buy today; the honest product is anchor + estimate, and the yad2 agreement becomes the only path. The benchmark decides this on day 1 |
| eBay evidence mistaken for local | already impossible by locale rule (T01–T03 mutants); the mixed-market state has its own copy |
| FX proof staleness | dated proof, 24 h cache, refused when older than 3 days |
| Calibration groups thin for a long time | the harness refuses to emit a factor below its floors; the state says so |
| Cache serves stale listings as current | TTL + `observed_at` on every row; VERIFIED needs a fresh completion |
| Identity memory keyed by V1's canonical key fragments across spellings | read-only use; V2's exact roots are written only under a versioned key after review |
| Scope creep into scraping | the provider contract has no "fetch a URL" primitive; adding one is a doctrine change with a per-host permission list |

---

## 9A. M1 — implemented (2026-10-05)

Under `api/_lib/v2/market/`: `observation.js` (the normalised observation; `observationFromEntry` adapts today's extraction entries), `provider.js` (contract, `runProvider` total under a deadline with an abort signal, failure classes), `dedupe.js` (origin-namespaced listing key → canonical URL → conservative fingerprint; syndication only on a seller/id signal; `sourceIndependence` counts providers, retrievals and origins separately over QUALIFIED observations), `orchestrator.js` (parallel fan-out, `mergeProvenance`, tier-ordered early stop on a qualified tier-A token, listing resolution against the pages' market identity, FX attachment, cache write-through, a ledger row per provider), `search-provider.js` (today's search as a discovery provider in two profiles; `local_used_domains` is OFF by default and sends `filters.allowed_domains` = `LOCAL_USED_HOSTS[market]`), `ebay-provider.js` (Browse API boundary, off without `SCAN_ENGINE_V2_EBAY_ENABLED` + credentials; sold prices stated as unavailable), `fx.js` (Bank of Israel feed behind `SCAN_ENGINE_V2_FX_ENABLED`, dated proofs the gate re-verifies, stale/unsupported/unavailable refused), `cache.js` (key by canonical market identity; observations with `observed_at`; CACHED rows are context, expired rows visible and never current; in-memory store, durable store staged behind the same interface). `runV2Price` runs through the orchestrator; with one profile it is the previous engine (OR-1a). `report.js` describes the market-data half; the ledger line names every provider's fate.

Benchmark: `tests/fixtures/scan-v2/benchmark-44.json` (44 items, 4 × 11 categories, configuration and adversarial cases, ground truth null until a person records it, photographs not yet in the repository), `scripts/market-benchmark.mjs` (dry-run default; replay over `gw-market-capture/1` files with `$ref`; live gated by `--live`, `--approve-usd` ≥ estimate and `SCAN_ENGINE_V2_BENCHMARK_LIVE=yes`; refuses with no photograph), replay fixture for the witness. Dry-run of the full manifest: 46 identity calls, 44 search actions (88 with the second profile), 0 eBay, 0 FX; estimated $0.71 (one profile) / $1.28 (two); max runtime 22 min.

yad2: `docs/audits/GW-YAD2-ACCESS-001.md`. No contact made.

Validation (final, unloaded): full suite 1,729 tests · 1,728 pass · 0 fail · 1 pre-existing skip; V2 mutation harness 168 / 168 killed (23 M1 mutants); provider harness and guard/UI/sanitizer harnesses unchanged; builds with the V2 flag off and on; bundle scan: no key, no state secret, no allowlist, none of the new environment names or hosts. Waterfall (OR-6a, 300 ms deadline): fast local evidence stops the lower tier early; retail + international, one timeout, one failure and no evidence each complete inside the deadline with every provider in the ledger. Zero paid or live provider calls; Production unchanged.

## 9B. M2 — benchmark dataset and readiness (2026-10-05)

The manifest became a ground-truth record (gw-benchmark-manifest/2: photo, identity, condition, expected recognition level, market identity, special case, source, valuation class A–E), the runner gained readiness, capture format /2, cohort reporting, the failure taxonomy, the PROFILE A / B cost plan and the two prepared experiments, and the engine door was proven closed to the truth. Everything is in `docs/audits/GW-BENCHMARK-001.md`. Still not run; 44 photographs missing.

---

## 10. Exact next implementation milestone (awaiting approval)

**Milestone M1 — "Two profiles, one orchestrator, measured discovery":**

1. `api/_lib/v2/market/provider.js` (contract), `orchestrator.js` (parallel, deadlines, early stop, ledger), `listing.js` (normalised schema; `extractListings` output lifted into it). Today's `search.js` becomes provider `openai_web_search` with two profiles; the second profile is **off** by default (a market data field lists the local used-marketplace hosts for `allowed_domains`).
2. `runV2Price` calls the orchestrator; with one profile configured, behaviour and latency are identical to `6857691` (held by the existing 277 V2 tests).
3. The benchmark manifest (44 items) and runner extension (§7), run **once with the second profile on**, under approval: ~88 paid search actions + 44 identity calls, ≈ $2.

**Decisions needed from you before M1 runs anything paid:**
- approve the ~$2 benchmark run (the only way to measure the discovery gap);
- approve an eBay developer account (free) for M2;
- approve the Bank of Israel feed as a dependency for M2;
- whether to open the question of a yad2 data agreement.

Nothing in M1 weakens the gate, adds a serial round, invents a factor, or touches V1 or Production.
