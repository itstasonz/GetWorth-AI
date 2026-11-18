# GW — Perplexity Search API as an evidence provider (2026-11-18)

Production at start: `ba0c058` (`dpl_8F2RHRjr5qJG7gUshRWpryzzqFZm`). Not deployed by this work. Flag off.

## 1. What existed

`api/_lib/scan/perplexity.js` (2026-11-15) calls the **Agent API** (`POST https://api.perplexity.ai/v1/agent`, a model
reads the search and reports evidence). Flag `CORE_SCAN_PERPLEXITY`. Untouched.

## 2. What was added

`api/_lib/scan/perplexity-search.js` calls the **Search API** (`POST https://api.perplexity.ai/search`) — ranked
results `{title, url, snippet, date, last_updated}`, no model. Flag `CORE_SCAN_PERPLEXITY_SEARCH` (exactly `true`) +
`PERPLEXITY_API_KEY`; tier `PERPLEXITY_SEARCH_TYPE` = `fast` (default) | `web`.

- Two requests per research, in parallel with the OpenAI Israeli search, one 8 s deadline:
  open (`country: IL`, ≤5 queries, denylist `-yad2.co.il -facebook.com -reddit.com …`) and boards
  (allowlist = second-hand boards in `market/sources.js` not marked not_authorized). Only documented parameters.
- Prices are read off snippets deterministically (`content-binding.js pricedNumbers`) and claimed; every claim passes
  `verifyEvidence`/`bindPrice`, source permissions, and then `searchApiKeep` (bound only; one page = one price unless it
  is a known list page). Rules added because the replay produced false evidence without them:
  | case seen in replay | rule |
  |---|---|
  | ~100 untied claims evicted OpenAI's ads from the 20-record pool (8/30 items A→B) | only bound claims join |
  | IKEA crib ₪290 / display cabinet ₪450 bound as exact POÄNG / KALLAX | descriptive items need the model word (either alphabet) |
  | Galaxy S23 **256GB** Zap page as the 128 GB new price | title capacity ≠ item capacity → no claim |
  | Zap Eilat page (no VAT) ₪2,045 as new price | `iseilat` / "אילת" title → no claim |
  | one DoskaTV ad with ₪450 and ₪400 counted as two ads | one non-list page, two prices → neither |
  | Shukshuk guide "how to sell an old iPhone ₪759" as an ad | board editorial paths are not ads |
  | Zap page mixing used/refurbished offers (₪1,149) | shop snippet with used words → no new price |
- `date` → provider publication note (used only for one-listing pages); `last_updated` never used.
- Owner free text reaches a query only if it reads as a configuration (≤24 chars, a digit, no phone-like run).
- Cost recorded on `call.search_provider` (published price × successful requests).

## 3. Terms (read 2026-11-18)

- API Terms (updated 2026-01-23) §2.3.1: customer owns Output — but the **Search Service addendum** (updated
  2025-09-22), Schedule 1: *"Customer does not own, and Perplexity shall not grant it ownership of, the Search API's
  Output"*; output *"sourced from the public internet"*, *"not generated … by … large language models"*; customer must
  verify accuracy. §2.2: Perplexity may retain/use Search Data. §2.3: no Personal Data without written authorization.
- Silent on storage, caching, extraction, combining, redistribution. §2.1 of the API terms: Output displayed solely
  within Customer Applications.
- Reading: transient per-request processing and extracting a price/URL fact is not prohibited; **persisting and
  re-displaying results is unclear** because ownership is expressly withheld. Not a legal opinion; the source sites'
  own terms (Homeless, ad.co.il, zuzz…) still apply as recorded in `market/sources.js`.
- Decision: experimental/transient only; flag stays off; no snippets stored. Enabling needs a founder decision (and
  ideally written confirmation from Perplexity — not contacted).

## 4. Measurement

`scripts/perplexity-search-eval.mjs`: live recording of the Search API for the fixed 20-set + 10-item holdout, then
offline replay through `service.js runPrice` against the OpenAI recordings of 2026-11-15 (`%TEMP%/gw-d20`,
`gw-dhold`; deep stage off as in Production). Recordings `%TEMP%/gw-pplx-fast`, `gw-pplx-web`; reports `*-cmp.json`.

Smoke: HTTP 200, 782 ms, flat `results` list for multi-query; snippets carry prices (most top hits were Yad2 → denied).

| arm (30 items) | A | B | C | D |
|---|---|---|---|---|
| OpenAI only (Production) | 9 | 8 | 4 | 9 |
| Search API only — fast | 0 | 0 | 5 | 25 |
| Search API only — web | 0 | 0 | 4 | 26 |
| OpenAI + Search — fast | 9 | 8 | 5 | 8 |
| OpenAI + Search — web | 9 | 8 | 4 | 9 |

- Per item: ~39 results, 13–36 priced candidates; **exact-model Israeli second-hand ads bound: 1 in 30 items**
  (Galaxy S22 ad.co.il/ad/15186868 ₪2,200, "חדש באריזה" — sealed, set aside; OpenAI-only state unchanged).
- **Additional independent Israeli ads: 0. Additional State A: 0.** Dominant rejection: product not named beside the
  price (1,783 fast / 1,494 web claims), Eilat/instalment prices (86/106), one page two prices (26/33), bundles, parts.
- Only change of state: DualSense D→C (fast): new price ₪300 from zap.co.il/model.aspx?modelid=1102825 (₪256) and
  bug.co.il accessories (₪339). New-price context added on already A/B items: Switch OLED ₪1,015, Marlin 5 ₪3,490,
  Mi Scooter Pro 2 ₪2,072, Dyson ₪2,529 (**"V11 Advanced" — a variant of a generic V11, borderline**), Watch 8 ₪897,
  AirPods Pro 2 ₪699 (web).
- Latency: Search API p50 396 ms / p90 477 ms (fast), 541 / 710 ms (web), run in parallel with OpenAI's local
  search (live p50 18.5 s) → no added wall time. Cost per research: $0.002 (fast) / $0.010 (web).

## 5. Decision

No measurable gain in Israeli second-hand coverage → **leave `CORE_SCAN_PERPLEXITY_SEARCH` off; no Production rollout**.
The snippets show where Israeli second-hand prices are (Yad2), and that source is not permitted. Same conclusion as
2026-11-13/15: the lever is licensed data, not another search index.

Spend: $0.001 smoke + $0.06 fast + $0.30 web = **$0.361**.
