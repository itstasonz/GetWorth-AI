# GW-BENCHMARK-001 — M2: benchmark dataset and end-to-end benchmark readiness

**Branch** `scan-engine-v2` · **built on** `832cde8` (M1) · **date** 2026-10-05 · **status** implemented locally, not run, not pushed, not deployed.
**Rules this milestone kept:** no live benchmark, no paid provider call, no recognition or valuation tuning, no deploy. The engine never reads a ground-truth field. No accuracy number is claimed anywhere in this document.

---

## 1. What the benchmark measures, and from where

The benchmark starts from the **photograph**. `scripts/market-benchmark.mjs` hands the engine a base64 image and the environment, and nothing else (`runEngine`); recognition, sufficiency, market identity, discovery, normalisation, dedupe, qualification and valuation all run as they do for a user. The ground-truth record is read only by the scorer (`scripts/market-benchmark-report.mjs`), after the engine has answered. The expected identity is never a shortcut into the pipeline.

Two doors into the engine exist, and both are proven closed to the truth (§6):

| door | takes | used by |
|---|---|---|
| `runEngine({ photoBase64, followupPhotoBase64, env, model, apiKey, fetchImpl })` | the photograph(s) and the environment | live runs |
| `replayEngine(capture)` | one persisted capture | replay, compare, every test |

---

## 2. Dataset: `tests/fixtures/scan-v2/benchmark-44.json` (`gw-benchmark-manifest/2`)

44 items, four per category: phones, computer hardware, gaming, audio, small appliances, perfume, shoes, watches, tools, furniture, household.

**Record per item**

| group | fields |
|---|---|
| key | `benchmark_id`, `cohort` (A–D), `category`, `subcategory` |
| PHOTO | `photo.photo_path`, `photo_count`, `photo_type`, `photo_notes`, `followup_photo_path` (two items) |
| IDENTITY | `brand`, `brand_alternatives` (board-partner cards), `product_family`, `exact_model`, `model_number`, `variant`, `capacity_size`, `color`, `configuration`, `configuration_alternatives` |
| CONDITION | `condition`, `condition_notes` |
| EXPECTED RECOGNITION | exactly one of `exact_model_expected` / `family_only_acceptable` / `generic_only_acceptable`; `decision`, `level`; `exact_model_expected_after_followup` for the two follow-up items |
| MARKET IDENTITY | `canonical_market_name`, `known_aliases`, `known_model_numbers`, `candidate_model_numbers_unverified`, `regional_name` |
| SPECIAL CASE | `special_case` ∈ complete_product, base_only, box_only, accessory_only, part, bundle, generic_item, sibling_trap, multiple_objects, other; `must_not_be` |
| GROUND TRUTH SOURCE | `ground_truth_source` — `pending: …` until a person confirms from the physical item |
| VALUATION GROUND TRUTH | `class` (A–E, §5), `reference_ils`, `reference_low/high_ils`, `retail_reference_ils`, `evidence[]`, `methodology`, `observed_on`, `status`, `expected_class` |

**Unknown stays unknown.** `null` means unknown, never zero. Only definitional values are filled (the planned target item, its family, capacity where it defines the item, model numbers that *are* the model such as `U2722D`, `WH-1000XM5`, `GA-2100`, `DCD796`, `DGA452`, and the witnessed `TB301`). Everything a photograph decides — condition, colour, variant, the actual model number on the label — is `null`. Model numbers I believe but did not verify are listed under `candidate_model_numbers_unverified` and are **not** used for scoring. 43 of 44 `ground_truth_source` fields read `pending: …`; the Ninja witness is the one confirmed identity and carries the one recorded price evidence (class D, retail only, from the production witness of 2026-09-30).

**Cohorts** (counts fixed by the manifest, tested in BM-1b):

| cohort | n | items |
|---|---|---|
| A obvious identifiable | 28 | every readable brand + model item |
| B family / ambiguous | 4 | Logitech top view (follow-up), Seiko dial (follow-up), Tefal pan, phone back without a label |
| C generic | 5 | kettle, hammer, chair (must not become IKEA), corner sofa, laundry basket |
| D configuration / adversarial | 7 | AirPods case only, empty Sauvage bottle, shoebox only, DeWalt bare tool, Sauvage EDT 60 ml (sibling of the EDP), DualSense (not the console), kettle + toaster in one frame |

Cohort D is **reported separately** and never enters a cohort-A number (BM-7b, mutant B04).

---

## 3. Photographs — missing, and what to capture

`tests/fixtures/scan-v2/photos/` holds a README and no image. `node scripts/market-benchmark.mjs --readiness` lists the 44 missing files (46 with the two follow-ups) and, once they exist, writes `photo-hashes.json` (SHA-256 per item, follow-up included). **No catalog or web image was substituted.**

Capture checklist (also in the manifest under `photo_capture_checklist`):

1. Phone camera, handheld, ordinary room light. One item per frame (except `home-two-objects`), filling most of the frame.
2. Brand and model text readable where `photo_notes` says so (About screens for phones/Mac/Watch; labels for monitor, drill, grinder, GPU; dial text for watches).
3. The configuration exactly as described: bare drill with no battery, empty AirPods case, closed shoebox, empty bottle, controller without console, kettle and toaster side by side.
4. The ambiguous items as described: Logitech top view only and Seiko dial only (the follow-ups are the underside label and the caseback, as separate files named by `followup_photo_path`).
5. Export at the PWA size (longest side ≈ 1280 px, JPEG ≈ 82 %), named exactly as `photo_path`.
6. After placing each photograph: fill `condition`, `color`, `capacity_size`, `variant`, and the model number read from the label; replace `ground_truth_source` with how it was confirmed. For the GPU, fill `brand_alternatives` with the board partner.
7. Price ground truth is a separate, later pass (§5): URL, amount, date, class.

---

## 4. KPIs (per cohort; every KPI its own column, never one blended number)

**Recognition (independent of pricing):** brand correct (X/N) · exact model correct · model correct-or-acceptable (family rule for B, generic rule for C) · configuration correct (`COMPLETE` accepts `UNKNOWN`; a configuration case must come back as its configuration or a listed alternative) · unnecessary follow-up (exact model expected, engine asked) · decision as expected · `must_not_be` respected · identity latency median / P95.

**Market identity:** known model number reached the exact roots (X/N where a known number exists).

**Market data:** raw results · normalised observations · duplicates folded · exact-product observations · local used coverage (tier A rows) · international used coverage (tier B) · retail anchor coverage (shops) · qualified exact comparables · distinct sources / providers · provider statuses, timeouts, failures · FX status.

**Valuation:** available (a number shown) · state and evidence state · confidence · limitation code · error vs reference (classes A–C only; §5) · anchor error vs the retail reference.

**Performance and cost:** identity, market-data and total latency median / P95 / max; within 8 s (X/N); cost per item from the ledger.

---

## 5. Valuation ground-truth classes

| class | meaning | scores a used valuation? |
|---|---|---|
| A `RECENT_SOLD_EVIDENCE` | a sold/completed local price within 90 days, with source and date | yes |
| B `MULTIPLE_LOCAL_ASKING_PRICES` | ≥ 3 local asking prices for the same configuration; reference = median | yes |
| C `HUMAN_VERIFIED_RANGE` | low/high from a person with market knowledge; reference = midpoint | yes |
| D `RETAIL_ONLY` | only a new price exists; recorded under `retail_reference_ils` | **never** (BM-6b, mutant B01); it scores the retail anchor only |
| E `NO_RELIABLE_VALUE` | no defensible value; declining is right | never |

`SCORABLE_GT = {A, B, C}`. A row whose class is D or E has `reference_ils = null` whatever is written beside it.

---

## 6. Leakage prevention

- **Mechanical separation.** `runEngine` has no item parameter; `replayEngine` takes the capture only (`length === 1`). `liveItem` is the only place the manifest and the engine meet, and it passes `{ photoBase64, followupPhotoBase64, env, model, apiKey, safetyIdentifier }` and nothing else.
- **BM-2a (dynamic):** an item whose every truth field is a canary string is run through `liveItem` with an injected engine; the engine's argument keys are exactly the six above, the canary appears neither in the call nor in the capture.
- **BM-2b (dynamic):** `runEngine` wired to a fetch spy: the request body carries the photograph and no manifest field.
- **BM-2c (static):** the source of both doors mentions no `item`, `manifest`, `ground_truth`, `market_identity`, `expected`, `truth`, `must_not_be`, `known_`, `reference`, `cohort`; no module under `api/_lib/v2` or `api/v2` mentions the manifest, its fields or the benchmark.
- **Mutant B07** adds `hint: item.identity` to the engine call; BM-2a kills it.

---

## 7. Raw capture format `gw-market-capture/2` (one file per item)

`input` (image SHA-256, follow-up SHA-256, photo count) · `build` (commit SHA) · `configuration` (model, profiles, eBay, FX) · `timings` · `identity` (request model, raw and normalised identity — the engine returns the normalised reading; the vision JSON is that reading — sufficiency, timings, usage, follow-up) · `providers[]` (provider, profile, status, request profile and planned queries, **executed queries**, raw response — the search API's output items via `search.raw_output`, eBay's response as received — timings, elapsed, started/first-result/completed, error class, counts, billed, cost) · `observations[]` (normalised) · `dedupe` (counts + folded duplicates) · `independence` · `qualification` (market roots, accounting, counts, one decision per extracted listing: tier, admitted, anchor, reason) · `valuation` · `final_result` (what the user would see) · `fx` (status, rate date, retrieved at, and the rate table used).

No secret: the capture carries no API key, no bearer token, no state secret, no environment dump (BM-5b asserts). Format /1 captures still replay; a /2 capture built from a replayed engine result round-trips to the same row (BM-5b).

Engine changes made for this (observability only, no behaviour change): `search.js` keeps `raw_output` on the search result; `orchestrator.js` returns `fx_table`; `scan.js` exposes `raw_ledger` and `fx_table` under `market_data` to in-process callers. The endpoint's `describeMarketData` picks fields and sends neither (V2 endpoint and client suites unchanged, pass).

---

## 8. Cost control (prepared, not executed)

`node scripts/market-benchmark.mjs` (dry run) prints both configurations for the runnable items and for the full manifest:

| | PROFILE A — one search profile (`local`) | PROFILE B — two profiles (`local` + `local_used_domains`) |
|---|---|---|
| identity calls | 44 (+ 2 follow-ups) | 44 (+ 2) |
| search actions | 44 | 88 |
| eBay calls | 0 (44 if enabled, $0) | 0 (44 if enabled, $0) |
| FX calls | 0 (1 per run if enabled, $0) | same |
| other | 0 | 0 |
| estimated cost | **$0.71** | **$1.28** |
| maximum cost (ceiling rates) | **$1.07** | **$1.86** |
| estimated runtime | ≈ 6.6 min (9 s/item) | ≈ 6.6 min |
| maximum runtime | 22 min (30 s/item) | 22 min |

Rates are the M1 estimates from the witness's measured usage (identity $0.003 est / $0.006 max; search action $0.01 + tokens $0.003 est / $0.008 max); a live run records actuals in the ledger. **The first live run uses PROFILE A** (`first_live_configuration`). The live gate requires `--live`, `--approve-usd ≥ estimate`, `SCAN_ENGINE_V2_BENCHMARK_LIVE=yes` and at least one photograph; `npm test` contains none of these (BM-3c, BM-4a, mutant B02).

---

## 9. Experiments prepared (not run)

**§14 second-profile miss experiment.** After the PROFILE A run, `misses_for_profile_2_experiment` lists the cohort A/B items whose identity was correct, which reached SEARCH_NOW, and which got no valuation. Re-run only those with `--only <ids> --profiles local,local_used_domains --out <dir2>`, then `--replay <dir2> --compare <dir1>` reports per item and in total: new raw results, new normalised and exact-product observations, new qualified comparables, new distinct sources, new local/international/retail coverage, new valuations, added latency (median/P95) and added cost. Expected cost for N misses: N × $0.013 (est) / N × $0.018 (max).

**§15 eBay experiment.** Same items with `SCAN_ENGINE_V2_EBAY_ENABLED=true` and credentials in the environment; compare the same way. eBay Browse is free; its rows are tier-B context and reach a valuation only through FX and the mixed-market quorum, which the comparison shows separately (`new_international_used_coverage`, `new_valuations`).

---

## 10. Performance targets (defined, not engineered)

| measure | target | where measured |
|---|---|---|
| identity latency | ≤ 4 s median, ≤ 6 s P95 | `identity_latency_ms` |
| market data | within `V2_MARKET_BUDGET_MS` = 4.5 s | `market_data_latency_ms`, `timings.within_deadline` |
| total photo → result | ≤ 8 s at P75 (GW-MARKET-DATA-001 §7), reported as median/P95 and X/N within 8 s | `total_latency_ms`, `within_8s` |
| provider timeouts | reported per provider; a timeout never blocks the answer | `provider_timeouts` |

These are what the report prints next to the measured values. Nothing was tuned toward them.

---

## 11. Failure taxonomy (one primary class per row; a secondary where one stands behind it)

`PHOTO_PIPELINE` → `RECOGNITION_BRAND` → `UNNECESSARY_FOLLOWUP` → `RECOGNITION_MODEL` (incl. a violated `must_not_be`) → `RECOGNITION_CONFIGURATION` → *(stop: no price was asked, or cohort C/D)* → `PROVIDER_FAILURE` → `TIMEOUT` → `MARKET_IDENTITY` → `DISCOVERY_COVERAGE` (no result, or no used listing local or abroad) → `NORMALIZATION` → `QUALIFICATION` → `FX` → `CALIBRATION` → `VALUATION` → `OTHER`. `DEDUPLICATION` is visible as a column (`duplicate_observations`) and assigned by a person reading the capture. The Ninja witness replays to **primary DISCOVERY_COVERAGE, secondary CALIBRATION**: discovery found no used listing; the retail anchor existed; no measured resale factor.

---

## 12. Report design

`buildReport(rows)` → `{ items_measured, cohorts: { A|B|C|D: { name, n, recognition, market_data, valuation, performance, failures, failed_items } }, rows }`. Every ratio is `{ n, of, pct }`; every latency is `{ n, median, p95, max }`; `scorable_rows` says how many rows had a class A–C reference. There is no top-level number (BM-5a, BM-8b). The live run writes `report.json` and one capture per item under `--out`.

---

## 13. Readiness checklist (`--readiness`, BM-9)

An item is ready when: every record group exists · cohort A–D · special case listed · exactly one expected level · valuation class A–E (classes A–C with a reference value) · brand known (except cohort C and the multiple-objects frame) · exact model known where expected · configuration known · `ground_truth_source` not pending · the photograph exists and loads (JPEG/PNG/WEBP magic bytes, ≥ 512 bytes) · its SHA-256 recorded (and the follow-up's). **Today: 0 / 44 ready; 44 photographs missing; the witness item lacks only its photograph.** The dataset is complete in structure and empty of invented truth.

---

## 14. Validation record (2026-10-05, unloaded)

- Full suite: 1,750 tests · 1,749 pass · 0 fail · 1 pre-existing skip (reputation integration). Benchmark suite BM-1…BM-9: 28 / 28.
- V2 mutation harness: 175 / 175 killed (7 new benchmark mutants B01–B07), both controls behave. Provider harness: 46 / 46, 0 survived.
- Builds with the V2 flag off and on succeed; bundle scan finds no key, no state secret, no allowlist, no V2 environment name, no provider host, no manifest field.
- Dry run of the committed manifest: 44 items, 0 runnable (no photograph), PROFILE A $0.71 est / $1.07 max, PROFILE B $1.28 / $1.86, max runtime 22 min. Replay of the witness capture: zero network calls. `--live` alone is refused.
- Zero paid or live provider calls were made. Production unchanged. Recognition and valuation rules unchanged.
