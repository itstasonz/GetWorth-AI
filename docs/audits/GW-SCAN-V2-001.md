# GW-SCAN-V2-001 — Scan Engine V2: forensic audit of build b3888a5 and the recognition + market identity + pricing architecture

**Type:** Forensic audit, then architecture, then implementation record
**Date:** 2026-10-05
**Branch / HEAD at audit:** `scan-engine-v2` @ `b3888a5`
**Witness:** the Ninja Power Blender Duo Pro production scan reported on the phone's V2 diagnostic panel (identity ~3.1s, search ~3.7s, 16 results, 5 price candidates, 0 admitted, `NO_PRICE_EVIDENCE`, ~8.2s total)

**Evidence labels used throughout:** `CODE FACT` (provable from source at HEAD) · `CAPTURE FACT` (from provider output persisted in this repository) · `PROBE FACT` (from two live search calls made for this audit on 2026-10-05, raw output in the session scratchpad, not committed) · `INFERENCE` · `NOT OBSERVABLE`.

---

## 0. The one thing to read first

The raw provider output of the b3888a5 scan **was not persisted anywhere**: V2 writes no database row, the server logs one line of request diagnostics and nothing about results, and the on-screen panel clips every list to twelve rows. So the b3888a5 per-result table cannot be reconstructed from data — only its mechanism can be proven from code. `CODE FACT`.

What *is* persisted is one earlier paid search for the same product, same model, same provider: `tests/fixtures/scan-v2/ninja-witness-search.raw.json` (build 6531b46, 2026-09-30, two search actions, 31 results, 16 in the first action). The engine at HEAD was replayed over that capture, and two further live probes were run. Those three sources agree on one fact that reorders everything else in the ticket:

> **Across 16 + 15 + 18 results for this product, under its printed name and under its market name, the provider returned zero Israeli second-hand listings.** The only used listings it returned at all were on eBay (a *base-only* unit) and craigslist (a complete set, $50). A control probe for the most-traded used item in Israel, iPhone 13, returned zero yad2 listing pages too — only yad2's app-store entry and Wikipedia article. `CAPTURE FACT` + `PROBE FACT`.

No qualification rule, alias resolver or extraction fix could have produced a used-market price from that result set, because there was no used-market evidence in it. The engine's `VERIFIED_MARKET` design (3 listings, 2 sites) is calibrated against a source class the search provider does not reach. The architectural consequences are in §5.

---

## 1. Pipeline trace, photograph to result

Stage by stage at HEAD. Latency figures are the witness's unless marked.

| # | Stage | Input → output | Provider | Deterministic logic | Timeout / fallback | Can information be lost? | Can uncertainty propagate wrongly? |
|---|---|---|---|---|---|---|---|
| 1 | Photo capture + preparation (`src/lib/scanV2.js`) | data URL → compressed JPEG ≤1280px, pixel sanity verdict | none | blank/uniform frame detection, size floor | client 20s; named failure codes | No. Facts about the image are reported, never the image. | No |
| 2 | Identify request (`api/v2/identify.js`, `_lib/v2/http.js`) | base64 → admitted request | none | auth, flag, allowlist, magic bytes, 4MB cap | 400/401/413 | No | No |
| 3 | Vision / recognition (`_lib/v2/identity.js`) | image + prompt → strict JSON (category, object_class, visible_text, brand/model/variant {value, confidence, evidence}, candidates, condition, missing_evidence, market_hypotheses) | OpenAI Responses, `reasoning: none`, 700 output tokens, `detail: high` | `normalizeIdentity`: TEXT_READ/LABEL_READ **demoted to SHAPE when the value does not occur in `visible_text`**; UNKNOWN strings → null; confidence clamped | 12s ceiling; failure classified, no retry | Yes — visible text is kept as flat strings, no roles; no model-number field; no configuration (complete / base only / accessory) field | **Yes.** Confidence is the model's raw number. A SHAPE 0.98 and a TEXT_READ 0.98 enter the gate as the same 0.98. The gate partly compensates (read beats seen), but nothing caps a seen value. |
| 4 | Visible text | strings → used only by `occursInText` | — | token containment | — | Yes: BRAND vs MODEL vs FEATURE vs REGULATORY text is not distinguished | No |
| 5 | Identity normalisation / follow-up merge (`followup.js`) | prior + new reading → merged identity | — | read beats seen; condition/class kept from the first photo | — | No | No |
| 6 | Sufficiency (`sufficiency.js`) | identity → SEARCH_NOW / NEED_FOLLOWUP / INSUFFICIENT + level | — | model read off item → PRODUCT; seen model needs 0.75 and a 0.25 lead over rivals; label asked only where model defines value | — | No | Mostly correct. Ninja → `SEARCH_NOW / product / model_read_off_item` (replayed). |
| 7 | Market identity (`market-identity.js`) | identity + **search results** → EXACT / REGIONAL_VARIANT / SIBLING / FAMILY / UNVERIFIED aliases | — | a number is EXACT when two independent single-product pages show brand + read name + number; names borrow exactness from numbers | — | No | No. **Runs after the one search, so a resolved number cannot shape a query.** |
| 8 | Search plan (`search-plan.js`) | identity + market vocabulary → ≤4 queries | — | name+used, name+price, alias+used, alias+price; `sameWords` de-dup | — | **Yes — see §3.1: the plan collapses to 2 queries when the proposed alias restates the read name.** | n/a |
| 9 | Web search (`search.js`) | plan → one `web_search_call`, stopped when the model starts writing | OpenAI web_search, `search_context_size: medium`, IL location, `reasoning: low` | stream stopped at first message / second search | 20s | Yes: the provider returns ~200-word excerpts; **7 of 9 exact-product shop pages in the capture carried no price in their excerpt** | n/a |
| 10 | Provenance (`phaseb/search-provenance.js`) | raw output → results [{url, domain, title, text}], queries, sources | — | only completed calls count | — | **Query→result attribution is not provided by the platform: one call, four queries, one result list.** `NOT OBSERVABLE` which query found which result. | n/a |
| 11 | Extraction (`listing-extraction.js`) | results → observations with role, binding, kind, relation | — | role from label; result-level binding for single-product shop pages; strict sentence binding elsewhere; unmarked numbers refused | — | **Yes — §3.3: locale-obvious shop prices refused for lacking a ₪; "מוכר חיצוני" read as sale intent** | — |
| 12 | Identity matching | entry text → relation via `relationOf` | — | sibling number decides; exact number or brand+name → EXACT | — | — | **Yes — §3.4: a listing naming another model number (CB103) is UNKNOWN, still handed to the gate, and the gate admits it on "Ninja" + "duo".** |
| 13 | Configuration matching | — | — | **absent as a stage.** Only `ACCESSORY_NOUNS` on the subject/listing title in the V1 gate | — | **Yes: eBay "TB301 - BASE ONLY" is an EXACT used listing today.** `PROBE FACT` | yes |
| 14 | Qualification (`market-evidence.js`, V1 gate) | admissible used entries → VERIFIED_MARKET token or reasons | — | screen (price, currency, provenance, title words), identity compatibility (brand 1pt + distinctive tokens), quorum 3 / sites 2 | — | Distinctive vocabulary of "Power Blender Duo Pro" on a blender is **one token, `duo`** (`CODE FACT`, replay) | yes (§3.4) |
| 15 | Retail anchor (`evidence.js`) | new_retail, result-level, EXACT, ILS, not refurbished → one price per shop | — | single-product pages only | — | **Yes: category-page rows that name the exact product are never anchors (V2-33e), and that is where local prices actually appear in excerpts** | — |
| 16 | Valuation (`pricing.js`) | token / admitted / anchor → one of 6 states | — | p25/p50/p85, condition ladder, V1 guard | — | — | **Binary in practice: no used listing admitted → NO_PRICE_EVIDENCE, whatever the anchor.** MARKET_INFORMED_ESTIMATE is reserved and never produced. |
| 17 | Result (`report.js`, `ScanV2View.jsx`) | states → headline, number or explanation, anchor beside it, two confidences, diagnostics | — | — | — | Lists clipped to 12; nothing persisted | — |

**Latency (witness, server):** identity 3.1s · search 3.7s · extraction + qualification < 10ms · total ~8.2s wall-clock. Every provider stage is instrumented (first event, results available, completion). `CODE FACT`.

---

## 2. The witness, reconstructed from the persisted capture

Replay: engine at HEAD, identity exactly as the panel reported it (brand Ninja 0.99 TEXT_READ; model Power Blender Duo Pro 0.98 TEXT_READ; visible text NINJA / BLENDSENSE / POWER BLENDER DUO PRO; aliases proposed "Ninja Power Blender Duo Pro", "Ninja BlendSense Power Blender Duo Pro"; no model number proposed), over the first search action of the capture (16 results). Script: session scratchpad `replay.mjs`.

### 2.1 Ledger — all 16 results

Query attribution is not available (§1 row 10); the action ran four queries and returned one list.

| # | domain | title (clipped) | source type | page type | title relation | price in excerpt | extraction | qualification | bucket / reason |
|---|---|---|---|---|---|---|---|---|---|
| 0 | sharkninja.com | Ninja Detect™ Duo® Power Blender … BlendSense™ | MANUFACTURER | category (2 model numbers in text) | UNKNOWN | none | — | — | NO_PRICE_DATA |
| 1 | ivory.co.il | נינג'ה בלנדר ושייקר Ninja Detect 2-in-1 TB301 1200W | LOCAL_RETAIL | single product | EXACT | 55/9/29 fees, 608 incl. delivery | 608 − 9 = **599 ILS**, new_retail | not a used listing | **ADMITTED as RETAIL ANCHOR** |
| 2 | shop.super-pharm.co.il | NINJA - בלנדר ושייקר TB301 | LOCAL_RETAIL | single product | EXACT | none | — | — | NO_PRICE_DATA |
| 3 | officedepot.co.il | בלנדר ושייקר … TB301 NINJA | LOCAL_RETAIL | single product | EXACT | "מחיר כולל מע"מ" with no number | — | — | NO_PRICE_DATA |
| 4 | zap.co.il | בלנדרים Ninja - זאפ השוואת מחירים - עמוד 2 | PRICE_COMPARISON | category | UNKNOWN | none | — | — | NO_PRICE_DATA |
| 5 | ek.ua | Ninja Detect Duo Power Blender Pro TB301 (TB301UK) | INTERNATIONAL_RETAIL | single product | EXACT | none | — | — | NO_PRICE_DATA |
| 6 | zap.co.il | בלנדרים Ninja שייקר - זאפ | PRICE_COMPARISON | category | UNKNOWN | none | — | — | NO_PRICE_DATA |
| 7 | currys.ie | NINJA Detect Duo Power Pro … TB301UK | INTERNATIONAL_RETAIL | single product | REGIONAL_VARIANT | none | — | — | NO_PRICE_DATA |
| 8 | shop.super-pharm.co.il | NINJA מוצרי חשמל למטבח (category) | LOCAL_RETAIL | category | UNKNOWN | **12 unmarked prices** incl. "550 … TB303" | all refused `price_without_currency_marker` | — | REFUSED_AT_EXTRACTION |
| 9 | cwc.co.il | בלנדר ושייקר ninja TB301 | LOCAL_RETAIL | single product | EXACT | none | — | — | NO_PRICE_DATA |
| 10 | tabseeta.com | Ninja Detect Duo TB301 Power Blender Pro | INTERNATIONAL_RETAIL | single product | EXACT | none | — | — | NO_PRICE_DATA |
| 11 | shikolat.ir | TB301 DETECT DUO POWER BLENDER PRO | INTERNATIONAL_RETAIL | single product | EXACT | none | — | — | NO_PRICE_DATA |
| 12 | tehnomax.me | NINJA TB301EU, Blender, Detect Po | INTERNATIONAL_RETAIL | single product | REGIONAL_VARIANT | none | — | — | NO_PRICE_DATA |
| 13 | reddit.com | Differences between CB350UK & TB301UKCP | FORUM | forum | REGIONAL_VARIANT | none | — | — | NO_PRICE_DATA |
| 14 | tomsguide.com | I just tested this … $179 Ninja blender | EDITORIAL | review | UNKNOWN | $179 | 179 USD, kind unknown | foreign, not for sale | QUALIFIER_REJECTED `nothing_says_this_is_for_sale` |
| 15 | tomsguide.com | This is the best blender in the world… | EDITORIAL | review | UNKNOWN | none | — | — | NO_PRICE_DATA |

Accounting: 16 = 0 duplicates + 13 no-price + 3 price candidates (1 refused at extraction, 1 rejected, 1 anchor). Reconciles. `CAPTURE FACT`.

Market identity from these 16 alone: **TB301 EXACT from 9 independent sites** (never proposed), TB301UK/EU/UKCP REGIONAL_VARIANT, TB401/TB303/TB403 SIBLING, both proposed names UNVERIFIED. Valuation: `NO_PRICE_EVIDENCE`, anchor SINGLE_SOURCE ₪599.

### 2.2 The §32 questions, answered

**Why were 11 considered no-price results?** (13 in the replay.) `CAPTURE FACT`: the provider's ~200-word excerpt of a shop's product page is description text; it carried a currency-marked number on 1 of 9 exact-product shop pages (ivory). The prices for TB301 that *were* in the capture sat on category and price-comparison pages as bare numbers ("החל מ- 569 569 NINJA בלנדר ושייקר TB301", second action) and were refused as `price_without_currency_marker`. Nothing was lost by a parser bug; it was lost by (a) the excerpt and (b) a currency rule that treats an Israeli shop's "from 569" as unknown money.

**What were the 5 price candidates?** For b3888a5: `NOT OBSERVABLE` (not persisted). For the capture's first action: the ivory product page (fees + total), the super-pharm category page (12 bare numbers), the tomsguide $179 review. `CODE FACT` on what *can* become a candidate: only a currency-marked number with a label that is not a fee, instalment, discount, old price or add-on.

**What were the 2 local-used observations, and why did they fail?** `NOT OBSERVABLE` for b3888a5. `CODE FACT`: an entry becomes `used_listing` when its block contains the sale lexicon — `למכירה`, the standalone word `מוכר`, "for sale", "selling" — or the page title contains `יד שנייה`. The retail-platform phrase **"מוכר חיצוני" (external seller) on super-pharm and zap matches `מוכר` and reads as sale intent** unless a retail word is in the same block. `INFERENCE`: the two "local used" rows were almost certainly rows of that shape, and they were then rejected by the gate for `no_distinctive_model_token_in_listing` or a qualifier conflict. Whatever they were, they were not second-hand listings: the capture and both probes contain none for this product.

**Why did exact-model remain 0 despite 0.98 recognition?** `CODE FACT`: `by_relation.EXACT` counts extracted *observations*, not pages. An observation is EXACT only when its own text names the brand with every word of "Power Blender Duo Pro", or carries a corroborated model number. Israeli pages call the product "Ninja Detect 2-in-1 TB301"; the read name never appears beside a local price. Only the ivory row reaches EXACT, through TB301. With b3888a5's two-query plan (§3.1) fewer international pages corroborated TB301 and nothing reached EXACT.

**Why were proposed aliases not corroborated?** `CODE FACT` + `CAPTURE FACT`: both proposals restate the read name with the brand ("Ninja Power Blender Duo Pro"); a name is corroborated only when it stands WHOLE in a single-product page title beside an EXACT number, on two sites. No site titles the product by its printed name. The resolver was right not to corroborate them; the model proposed the wrong *kind* of alias (a restatement, no model number), and at 6531b46 the same model had proposed TB301. Hypothesis quality is non-deterministic.

**Was useful evidence present but rejected?** Yes, three kinds. (1) Exact local retail prices as bare numbers on category pages (super-pharm TB301 569 in action 2; zap rows for siblings). (2) The ivory anchor was kept but a single shop is a weak anchor; the second shop was refusable only for the missing ₪. (3) Internationally: craigslist "Complete Set $50" (probe) is a real Tier-B used comparable, and is foreign currency with no conversion. Also rejected *correctly*: eBay "BASE ONLY" (probe) — but for the wrong reason (currency), not configuration.

**Did the search queries have sufficient recall?** No, for two provable reasons. (a) `CODE FACT`: with these aliases, `planV2Search` emits **2 queries, not 4** — `overlapJoin("Ninja", "Ninja Power Blender Duo Pro")` equals the read name and `sameWords` de-dups both alias queries. Half the search budget was spent on nothing. (b) `PROBE FACT`: even four model-number queries return no local listing pages; local used recall through this provider is bounded by what appears in index-page excerpts.

**Did the search result representation prevent verification?** Yes: excerpts without prices (§2.2 first answer) and no query→result attribution. Not fixable server-side except by asking for prices in the way the market writes them (price-comparison and category pages) and by reading bare numbers on local shops as anchor candidates.

**Would canonical market identity / model-number resolution have rescued any evidence?** Replayed: with TB301 proposed, the plan is 4 queries and the second action's super-pharm row and zap rows become readable — **retail** evidence: a second shop for the anchor (569 + 599 → STRONG). For the **used** market: nothing, because none exists in any of the three result sets. Resolution is necessary and already works (9 sites corroborate TB301 unprompted); it is not sufficient.

---

## 3. Defects proven at HEAD

| ID | Where | Defect | Proof |
|---|---|---|---|
| D1 | `search-plan.js` | Alias queries that restate the read name de-dup to nothing; plan runs 2 of 4 queries | replay: `plan queries (2)` with the witness's aliases |
| D2 | `identity.js` | Model-number hypotheses are memory-based and non-deterministic (TB301 at 6531b46, none at b3888a5); no field for a number READ off the item | capture vs panel |
| D3 | `listing-extraction.js` | Bare numbers on a local shop's page, in the market's own price form ("החל מ- 569 569 … TB301"), are refused as unknown currency | capture action 2 |
| D4 | `listing-extraction.js` | "מוכר חיצוני" / "נמכר ע״י" (platform seller phrases) match the sale lexicon → retail rows read as second-hand | `LEXICON.sale` regex |
| D5 | `evidence.js` | A category-page row that names the exact product is never a retail anchor (test V2-33e asserts this) | code + test |
| D6 | `market-identity.js` + gate | A listing naming ANOTHER model number (CB103 Power Nutri Duo) is relation UNKNOWN, handed to the gate under the read name, and admitted on brand + "duo" | `subjectVocabulary` distinctive = ["duo"]; `relationOf` returns UNKNOWN |
| D7 | everywhere | No configuration stage: "BASE ONLY", "case only", "box only", "replacement cup" are matched as the product | probe: eBay TB301 BASE ONLY → EXACT |
| D8 | `evidence.js` | Source class is decided by currency: an il.ebay.com row showing eBay's converted "ILS 622" is LOCAL_USED | probe iPhone: `ILS 622.13 Used` |
| D9 | `pricing.js` | No state between "verified used market" and "no price": a VERY_HIGH identity with an exact retail anchor collapses to NO_PRICE_EVIDENCE | code |
| D10 | diagnostics | Nothing about results is persisted or logged; a witness cannot be reconstructed | this audit |
| D11 | `identity.js` | Raw model confidence flows into thresholds; no evidence-tier cap | code |

The gate itself (`market-evidence.js`) was not weakened and is not the failure: it never saw a used listing.

---

## 4. Recognition audit across categories

What holds: the vision call is one request, strict JSON, `reasoning: none`, 3.1s; "read" claims are verified against the text read; a seen model needs a margin over rivals; the follow-up is one specific label; condition is visible-only. The Ninja, PS5, Dior, Jordan and iPhone fixtures all reach SEARCH_NOW without a second photograph; the Logitech-with-four-candidates asks for the underside label. That matches §8 of the order.

Where it can still fail:

- **Confidence is uncalibrated** (D11). A silhouette match at 0.98 is treated as 0.98.
- **No model-number field.** A label reading "M/N: MR0089" lands in `visible_text` and is only matched by the identifier regex later; the plan cannot search it as identity.
- **No configuration field.** A photograph of an AirPods *case* with no buds identifies as "AirPods Pro"; the only protection is the gate's accessory-noun rule on `object_class`, which depends on the model choosing "charging case" as the class.
- **Visible text has no roles.** BRAND / MODEL / FEATURE / CAPACITY / REGULATORY are not distinguished, so "BLENDSENSE" and "1200W" are flat strings.
- **Multi-signal agreement is implicit.** `identity_evidence` lists kinds, but agreement (logo + text + shape) does not raise, and conflict does not lower, any number.
- **Tools and Beauty** rely on `variant` dimensions (100ml, kit) reaching the gate's dimension rule; bare-tool vs kit is not a configuration.

---

## 5. Architecture

### A. Current failure, in one sentence
The search provider does not reach Israeli second-hand listing pages; the plan halved its own recall; the extraction refused the local retail prices that were in the excerpts; and the valuation has no honest state for "identified, priced new, no used market observed".

### B. Recognition (identity.js)
Add to the strict schema: `model_number` (a field like brand/model, value kept only when TEXT_READ/LABEL_READ and present in `visible_text`) and `configuration` (`COMPLETE | BASE_ONLY | ACCESSORY_ONLY | BOX_ONLY | REPLACEMENT_PART | UNKNOWN`: what the *photograph* shows). Add a deterministic calibration layer: each field's `calibrated_confidence = min(raw, cap[evidence])` with caps TEXT_READ/LABEL_READ 1.0, PACKAGING 0.9, LOGO 0.9 for brand and 0.6 for model, SHAPE 0.8, NONE 0; the gate reads the calibrated number. Classify visible text deterministically into roles (brand, model, identifier, capacity, regulatory, other) for diagnostics; no extra model tokens.

### C. Market identity resolver (market-identity.js)
Already generic and effective (TB301 from 9 sites with no proposal). Keep it. Add: a read model number is an exact root (identity); an identifier in a listing that is neither exact nor a regional variant marks the listing `OTHER_PRODUCT` (D6); relations are reported with the pages that produced them.

### D. Search (search-plan.js, phaseb/config.js)
Always four queries, one action. Slots: read name + second-hand, read name + price, then the two best of: a corroborated/read model number + second-hand, model number + price, **a model-number-eliciting query** (read name + the market's word for "model", `דגם`, which pulls spec and shop pages that print the number), read name + for-sale. A hypothesis that restates the read name is dropped before it can de-dup a slot. The market supplies every word; nothing names a site. "יד2" as a query term is avoided: the probe shows it pulls yad2's app-store and Wikipedia pages.

### E. Configuration matching (new `configuration.js`)
A lexicon in both languages: `<accessory noun> only` / `בלבד` → ACCESSORY_ONLY; `base|motor base|unit only`, `ללא קנקן` → BASE_ONLY; `box only|empty box|אריזה בלבד|קופסה בלבד|empty bottle|בקבוק ריק` → BOX_ONLY; `replacement|spare|compatible with|fits|מתאים ל|חלק חילוף` → REPLACEMENT_PART; `for parts|not working|לחלקים|תקול|שבור` → PARTS; `complete set|full set|סט מלא` → COMPLETE; else UNKNOWN (priced as complete, reported as unknown). Applied to every extracted entry; anything but COMPLETE/UNKNOWN is excluded from pricing and from the anchor, kept for corroboration, and counted. When the subject's own configuration is not complete, only listings of the same configuration count.

### F. Evidence tiers (new `source-type.js`, evidence.js)
Source type from domain and page signals: market TLD → LOCAL, else INTERNATIONAL; a closed list of *kinds* of site (international used marketplaces: ebay, craigslist, swappa, mercari, vinted, depop, olx, opensooq; social: facebook, instagram; forums: reddit, `/forums/`) with every unknown domain classified by lexicon (price comparison, retail, editorial) — a vocabulary, not an allowlist. Tiers: **A** local used exact complete · **B** international used exact complete (context until an FX source exists) · **C** exact local retail anchor · **D** regional variant · **E** sibling/family. Class is decided by source locale, never by the currency shown (D8).

### G. Sparse-market strategy (pricing.js)
Three claims, never merged: `VERIFIED_USED_MARKET` (token), `MARKET_INFORMED_ESTIMATE`, `INSUFFICIENT_EVIDENCE`, exposed as `evidence_state` beside the finer state. MARKET_INFORMED_ESTIMATE is produced only when: product-level identity at HIGH or VERY_HIGH, an exact local retail anchor, fewer admitted used listings than the quorum, and a **measured** resale factor for the (category, product class, condition) group in `api/_lib/v2/resale-factors.data.js`. The file ships with no measured group: the state cannot be produced yet, and the result says so (`limitation: no_calibrated_resale_factor`), beside the anchor and whatever below-quorum listings exist. The factor table is written by `scripts/valuation-calibration.mjs`, which already refuses to emit a factor from thin data. No universal percentage exists anywhere in the engine.

### H. Confidence
Identity confidence (VERY_HIGH … LOW, from evidence kind and calibrated number) and pricing confidence (VERIFIED / BELOW_QUORUM / COMPARABLE / MARKET_INFORMED / NONE, plus anchor strength) remain separate fields; neither is computed from the other.

### I. Performance
No new provider call. Identity stays one call; search stays one action of four queries; extraction, configuration, source typing and tiering are deterministic and sub-10ms. Expected Ninja total is unchanged (~8s). A conditional second search action (model-number-specific, when the first finds no used listing) would add ~3.5s on the thin-market path and is **not implemented**: it crosses the 8s rule and, on the probe evidence, would not have found a local listing for this product. It is recorded in §7.

### J. Tests
New suites for the plan, extraction, configuration, source type, other-product exclusion, tiers, the estimate gate and the limitation; the matrix gains accessory-only, box-only, base-only, other-product and foreign-marketplace-in-ILS cases; mutants for each new rule.

### K. Migration
V2 tree only: `search-plan.js`, `listing-extraction.js`, `evidence.js`, `pricing.js`, `report.js`, `identity.js`, `sufficiency.js` (reads calibrated confidence), new `configuration.js`, `source-type.js`, `resale-factors.data.js`; `phaseb/config.js` gains two data fields on the market (a word for "model", the market's site suffixes) that V1 does not read; `ScanV2View.jsx` copy for the new state and limitation; `api/v2/price.js` logs a bounded ledger line. V1 (`api/analyze.js`, `api/enrich.js`) untouched.

### L. Risks
Reading bare numbers on local shops as anchor candidates infers a currency from site locale; it is confined to retail anchors (never used-market evidence), to rows naming the exact product, to the market's own price forms, and is labelled `currency_basis: site_locale`. Marking foreign-identifier listings OTHER_PRODUCT costs a true listing when its number is not yet corroborated; that is the fail-closed direction. Category-row anchors reverse V2-33e; they require the row to name an exact model number or the whole read name and are shown as row-bound.

### M. Expected Ninja result
Filled in §6 from the implemented engine replayed over the capture.

---

## 6. Implementation record and measured result

### 6.1 What changed (V2 tree only; V1 untouched)

| File | Change |
|---|---|
| `api/_lib/phaseb/config.js` | two data fields on the IL market: `terms.model_number` ("דגם") and `site_suffixes` (['.il']). V1 reads neither. |
| `api/_lib/v2/search-plan.js` | a proposal that restates the read name takes no slot; a read model number is searched as identity; MODEL_NUMBER and FOR_SALE fill the remaining slots. Always four queries, one action. |
| `api/_lib/v2/configuration.js` (new) | COMPLETE / BASE_ONLY / ACCESSORY_ONLY / BOX_ONLY / REPLACEMENT_PART / BUNDLE / PARTS / UNKNOWN from a bilingual lexicon; `configurationCompatible`. |
| `api/_lib/v2/source-type.js` (new) | source type and locale from the host and page, never from the currency. |
| `api/_lib/v2/locale-price.js` (new) | a local shop's bare price in the market's own form, beside this product, as a retail-anchor candidate labelled `currency_basis: site_locale`; the higher of a promotion pair refused as the old price. |
| `api/_lib/v2/listing-extraction.js` | platform-seller phrases are retail; marketplaces abroad are second-hand pages; category rows naming the product are row-bound anchor candidates; every entry carries configuration, source type, locale, currency basis. |
| `api/_lib/v2/market-identity.js` | `OTHER_PRODUCT` relation once the product's number is known; a read model number is an exact root. |
| `api/_lib/v2/evidence.js` | sibling / other-product / wrong-configuration / abroad listings never reach the gate; anchors require local, compatible, product-page or row-bound; tiers A–E; class by locale; new counts. |
| `api/_lib/v2/calibration.js` (new) | evidence caps on confidence; visible-text roles. |
| `api/_lib/v2/identity.js`, `sufficiency.js`, `followup.js` | `model_number` (kept only when read) and `configuration` in the strict schema and prompt; calibrated confidence on every field; the gate reads it. |
| `api/_lib/v2/resale-factors.js` + `.json` (new) | the measured-factor table; shipped with no measured group. |
| `api/_lib/v2/pricing.js` | `MARKET_INFORMED_ESTIMATE` behind a measured factor; `evidence_state`; `limitation`; blending with below-quorum listings; must sit below the new price. |
| `api/_lib/v2/report.js`, `api/v2/price.js` | tiers, configuration, source type, currency basis in the diagnostics; one bounded ledger line per priced scan in the server log. |
| `src/views/ScanV2View.jsx` | headline and basis for the estimate, a sentence per limitation, the evidence state, new diagnostic rows. |
| tests | `tests/scan-v2-resolution.test.mjs` (33 tests), five matrix cases (N–R), 27 mutants, six expectations updated deliberately (V2-9e, V2-21a, V2-30f/g, V2-33e, V2-35b, V2-37j, V2-38d). |

Two expectations were reversed on purpose: a category row that names the exact product now yields a row-bound anchor (V2-33e), and a used value may be derived from a shop price — only through a factor the calibration harness measured (V2-9e).

### 6.2 The witness, replayed at the new HEAD

Same identity as the panel reported, same persisted capture.

| | b3888a5 | now |
|---|---|---|
| plan | 2 queries (two alias slots de-duplicated away) | 4: name + second-hand, name + price, name + "דגם", name + for-sale |
| market identity | TB301 EXACT (9 sites), siblings TB303/TB401/TB403 | same; `OTHER_PRODUCT` available for any foreign number |
| retail anchor, first action (16) | ₪599, one shop | ₪599, one shop (the second shop's row is in action 2) |
| retail anchor, both actions (31) | ₪599, one shop | **STRONG: ₪569–₪599, two shops** (super-pharm row, currency inferred from host, row-bound) |
| accounting (31) | 6 dup + 20 no-price + 1 refused + 3 rejected + 1 admitted | 6 + 20 + 0 + 3 + **2** (reconciles) |
| tiers | — | C ×2 (anchors), E ×2 (TB303 rows), A/B 0 |
| used-market state | NO_PRICE_EVIDENCE | NO_PRICE_EVIDENCE · `evidence_state: INSUFFICIENT_EVIDENCE` · `limitation: no_calibrated_resale_factor (home:blender:Good)` |
| identity confidence | VERY_HIGH | VERY_HIGH (brand 0.99 / 0.99 calibrated, model 0.98 / 0.98 calibrated, read off item) |
| provider calls | 1 identity + 1 search | unchanged; extraction + qualification < 10 ms |

What the user now sees for this scan: "Ninja Power Blender Duo Pro", condition, "No second-hand price found", then the sentence *"We found what it costs new, but we have not yet measured how this kind of item resells, so no second-hand estimate is shown."*, the "Price new ₪569–₪599, from 2 shops" card, identification *very high*, second-hand price evidence *none*, evidence *insufficient*.

With a measured factor for `home:blender:Good` the same scan produces `MARKET_INFORMED_ESTIMATE` (test V2-46b): anchor × factor, blended with any admitted listing, refused if it does not sit below the new price.

### 6.3 Validation (2026-10-05, after the last code change, machine unloaded)

| Run | Result |
|---|---|
| `npm test` (full suite incl. reputation integration, contrast check, design-lint ratchet) | 1,682 tests · 1,681 pass · 0 fail · 1 skipped (reputation integration, pre-existing skip). Baseline before this work: 1,647 / 1,646 / 0 / 1. |
| the nine V2 suites (gate, evidence, pipeline, endpoints, client, market, alias, anchor, **resolution**) | 277 tests, 277 pass (243 before) |
| `tests/scan-v2-resolution.test.mjs` (new) | 35 tests |
| V2 mutation harness (`tests/mutations/v2-run.mjs`) | 145 / 145 killed (100%); both controls behaved. 27 new mutants; 4 proposed mutants were dropped because the rule they guarded was shown redundant, and the redundant code was removed with them. |
| guard harness (`run.mjs`) | 109 / 109 scored killed (3 equivalent excluded) |
| UI harness | 108 / 108 killed |
| sanitizer harness | 69 / 69 killed |
| provider harness | 46 / 46 killed, 0 misattributed |
| provider-discovery + round5 provider controls | pass (the factor table is a module, not a file read, so the scanner sees it) |
| `npm run build` (V2 flag unset, the production default) | ok |
| `VITE_SCAN_ENGINE_V2_ENABLED=true npm run build` | ok |
| bundle secret scan (keys, state secret, allowlist, service role) | none |
| changed-file secret scan | only test-fixture strings |
| deterministic half on the witness (31 results), 30 runs | extraction + qualification median 8.6 ms, max 10.2 ms (budget 100 ms) |

One transient failure was observed and explained: V2-30h (the 100 ms budget) read 106.8 ms once while three mutation harnesses saturated the CPU; it passes in isolation and on the final unloaded run.

### 6.4 Not committed

Nothing was committed, pushed or deployed. The working tree on `scan-engine-v2` also carries unrelated, older V1 / Phase-B edits (`api/analyze.js`, `api/_lib/phaseb/*` except the two data fields in `config.js`, `api/_lib/valuation-guard.js`, `src/views/CameraResultsView.jsx`, `scripts/*`, `src/lib/pricingEvidence.js`, `tests/pricing-evidence.test.mjs`, `tests/identity-*.test.mjs`, `tests/mutations/mutants.mjs`, `tests/mutations/run.mjs`, `api/_lib/phaseb/query-planner.js`) that are **not** part of this work and must be staged separately.

Two billed provider calls were made for this audit (the recall probes of §0), through the existing OpenAI web-search tool and the engine's own search function; their raw output is in the session scratchpad and was not committed.

---

## 7. Not done, and why

- **Second search action on the thin-market path.** Latency rule (§34); probe shows no local listing would be found for this product.
- **FX source for Tier B.** A rate source is a new dependency; without it international used comparables are context, disclosed as such.
- **Identity cache / learning from confirmed scans.** Needs a store with provenance and versioning (schema change → approval). Design: cache key = brand + read name + category; value = corroborated exact roots, siblings, regional variants, source pages, confidence, `established_by` (sites), `scope` (global | user), `version`; prices are never cached; entries expire by version of the resolver.
- **Local used recall.** Bounded by the provider. Options needing a decision: a marketplace data source, or a calibration sampling programme to earn the resale factors.
