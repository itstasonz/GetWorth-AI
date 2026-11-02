# GW-PERF-CORE-SCAN-001 — Core scan latency: investigation and repair

Date: 2026-11-02 · Branch: `feat/core-scan-001` (worktree `.wt-core`), on top of `ec440b8` · Status: **uncommitted, not deployed**

## A. Executive summary

- **Production does not run the code the investigation brief pointed at.** `get-worth-ai.vercel.app` serves **`ec440b8`** (`feat/core-scan-001`, the "core scan": `api/scan.js` → `api/_lib/scan/*`). It does not serve `b3888a5`, and it does not serve the `scan-engine-v2` / `api/_lib/phaseb/*` pipeline. The dirty `scan-engine-v2` checkout is not on the path a founder scan takes.
- **The confirmed cause of most of the wait is two paid web searches that ran one after the other.** The price step runs an Israeli search (`local`), then waits for it to finish, then often runs a wider search (`expand`). Each search takes about 10 s, and each has a 22 s timeout. Most real items find thin Israeli evidence, so they need both searches. Both live items in this audit needed both.
- **The wider search never needed the first search's results.** It is built from the identity alone. The repair starts it at the same time as the Israeli search. The rule for which evidence sets the price is unchanged.
- **Measured live (n = 2 per mode):** the price step went from **20.9 s → 9.9 s** (mouse) and **21.5 s → 11.8 s** (blender), about 10 s faster per scan.
- **Severity:** high for the user experience. Before the fix, the worst case was about 20 s (identify) + 2.5 s (exchange rates) + 22 s + 22 s (two searches) + about 5 s (database writes), roughly 70 s with no error shown.

## B. Repository baseline (read-only; nothing stashed, reset, switched, committed or pushed)

| Item | State |
|---|---|
| Main checkout | `scan-engine-v2` @ `6643ab3`, 4 commits ahead of `origin/scan-engine-v2` (`fb7b070`). 18 modified + untracked files (phaseb, analyze.js, CameraResultsView, audits). **Not touched.** |
| Worktree `.wt-core` | `feat/core-scan-001` @ `ec440b8` = `origin/feat/core-scan-001`. Clean apart from session-hook helper files. |
| `origin/main` | `b3888a5` |
| Production | `ec440b8`. `scripts/verify-production-baseline.mjs --expect ec440b8` → **VERIFIED** (bundle sha read off the live page). Deployment `dpl_JDwtKmoDG1GSKQaTzCWS421M1qyh`, 21 days old. |
| Rollout | Core scan only for accounts on `SCAN_ENGINE_V2_USER_IDS`. Everyone else gets 503, and the client falls back to V1 `/api/analyze`. |

Why the work landed in `.wt-core`: the brief's premise ("Production runs `b3888a5`") is out of date. Repairing the deployed engine in its own clean worktree leaves the unfinished `scan-engine-v2` work exactly as it was.

## C. Existing work (what applies)

- `api/_lib/scan/config.js` records the only earlier live timing (2026-10-06, 3 photos): identify with `gpt-6.1-sol` takes 6–9 s; one market search with `gpt-6-luna` takes about 10 s.
- The server already logs `[Scan] action=… total_ms provider_ms` and writes `scan_events.core_scan_priced` with `identify_ms`, `market_ms`, `first_search_ms`, `stages` and `client_elapsed_before_price_ms`. The client logs photo→identity and photo→price. **This instrumentation was already enough; nothing new was added.**
- `docs/audits/GW-RC-PERF-003.md` (on `scan-engine-v2`, untracked) measures the **V1 Anthropic `/api/analyze`** pipeline, median about 27 s. That is the fallback path for non-founder accounts, not the core scan.
- Scan Lab (GW-SCAN-LAB-001/002) captures benchmark photos only. It never runs the engine and is not in Production (see the `f4a5dea` notes).

## D. Architecture: what a core scan actually does

| # | Stage | File / function | External | Seq/par | Ceiling |
|---|---|---|---|---|---|
| 1 | Photo prepare (compress to 1280 px, JPEG 0.82, pixel check) | `src/contexts/AppContext.jsx compressImage`, `src/lib/coreScan.js prepare` | — | seq | — |
| 2 | POST identify | `coreScan.js identify` → `api/scan.js` | Vercel | seq | client 35 s |
| 3 | JWT verify, body bound, rollout list | `api/scan.js createScanHandler` | Supabase auth | seq | — |
| 4 | Quota RPC | `quota.js chargeScan` | Supabase | seq | 6 s, fails closed |
| 5 | Vision identify (streamed, `gpt-6.1-sol`, effort low) | `identify.js identifyItem` | OpenAI | seq | 20 s, no retry |
| 6 | Identity shown. A required question stops here. | client | — | — | — |
| 7 | POST price | `coreScan.js price` → `api/scan.js` | Vercel | seq | client 65 s |
| 8 | Market cache recall (memory, then `scan_events`) | `service.js recall` / `persist.js loadMarketResearch` | Supabase | seq | 1.5 s |
| 9 | Bank of Israel rates (cached 24 h per instance) | `fx.js getFxTable` | BoI | **was seq, now overlapped** | 2.5 s |
| 10 | Israeli search (`web_search`, `gpt-6-luna`, 1 tool call) | `market.js researchMarket('local')` | OpenAI | seq | 22 s |
| 11 | Wider search, used when Israeli evidence is below `LOCAL_STRENGTH.drives` (not for COMPARABLE items) | `researchMarket('expand')` | OpenAI | **was after #10, now alongside it** | 22 s |
| 12 | Verify, bind, price (deterministic) | `valuation.js` / `evidence.js` / `binding.js` | — | seq | ms |
| 13 | Save research | `persist.js saveMarketResearch` | Supabase | seq | 2.5 s |
| 14 | `record_scan` + `scan_events` | `persist.js` | Supabase | parallel | 2.5 s |
| 15 | Render | `ScanView.jsx` | — | — | — |

No step retries, and no step can leave the screen loading forever: every request has a client abort (35 s / 65 s) and a mapped error. Asking a follow-up question or the label photo starts another identify or price round, but those wait for the owner, not the system.

## E. Measurements

| Measurement | Value | Kind |
|---|---|---|
| Identify (vision) | 6–9 s | real, 2026-10-06, from `config.js`; **not re-measured** (no photos in the repo) |
| Price step, sequential, mouse | 20,901 ms (first search event at 7,696 ms) | **real, live, 2026-11-02** |
| Price step, sequential, blender | 21,481 ms (5,169 ms) | **real, live** |
| Price step, parallel, mouse | 9,940 ms (6,476 ms) | **real, live** |
| Price step, parallel, blender | 11,831 ms (4,838 ms) | **real, live** |
| Exchange-rate overlap; parallel ≈ slowest stage, not the sum | PM-1d, PM-1i | controlled (fake provider with delays) |
| Supabase recall / save / record | bounded at 1.5 / 2.5 / 2.5 s; not measured live | source |
| Production logs | Vercel keeps nothing older than the last day; only one GET probe was found. `scan_events` timing rows exist but were **not read**: there is no service key locally, and the Production secret was not pulled. | limitation |

n = 2 per mode, so no median or percentile is claimed. Live web results vary from run to run (evidence counts differed between runs of the same mode). The outcome, `insufficient_evidence`, and the withdrawn reason were the same in both modes.

## F. Root causes

**CONFIRMED.**
1. **Sequential market stages.** In `service.js runPrice`, `expand` waited for `local` even though `buildMarketPrompt` / `buildSearchQueries` for `expand` read only the identity, answer and stage. Measured cost: about 10 s per scan that widens, which was 4 of 4 live runs. Before the fix, worst case was 44 s of searching inside one request.
2. **Exchange rates fetched before the search.** On a cold instance (or with the BoI feed slow), up to 2.5 s sat on the critical path. The rates are only needed to verify foreign prices after a search returns.

**PROBABLE.**
3. **Model latency is the floor.** One `gpt-6-luna` search stage takes 9–12 s, and identify takes 6–9 s. After the fix, a typical scan is about 7 s to the item name and about 17–20 s to the price. A scan that hits the timeouts can still take about 55 s: 20 s identify + 6 s quota + 22 s search + about 6.5 s of database time.
4. **The research save is awaited before the response** (≤ 2.5 s, usually much less). Not changed.

**UNVERIFIED.**
5. How the founder's own 60 s+ scans split between identify and price. The `scan_events.core_scan_priced` rows would show it; `scripts/scan-trace.mjs` reads them with the service key.
6. Whether follow-up rounds (a question answered, the label photo) are what made the scan feel 60 s+, since each one is another full search.

**RULED OUT (source).** Duplicate requests (`startScan` aborts any previous controller; the stage machine sends exactly one identify and one price). Retries (none). An indefinite spinner (client aborts plus mapped errors). Image payload (1280 px JPEG, well under the 4.4 MB body bound). Supabase on the critical path beyond the bounded quota/recall calls.

## G. Repairs (in `.wt-core`, uncommitted)

| File | Change |
|---|---|
| `api/_lib/scan/service.js` | `runPrice`: rates start alongside the recall and are awaited only when a stage is verified. The wider search starts together with the Israeli one when it could be needed at all (not COMPARABLE, and kept evidence does not already decide the price). After the Israeli search, the **same** `widens()` rule decides whether to use it. If not, it is cancelled and its evidence never enters the price. If the Israeli search fails, the wider one is cancelled too. `call.cancelled` records cancelled stages. |
| `api/_lib/scan/config.js` | `CORE_SCAN_MARKET_PARALLEL` (default on; exactly `false` restores the old order), `resolveMarketParallel`. |
| `api/_lib/scan/market.js` | `researchMarket` passes an optional `signal`. |
| `api/_lib/v2/openai-stream.js` | Optional `signal` cancels the request. Callers that pass none are unchanged. |
| `tests/core-scan-parallel-market.test.mjs` | New, PM-1a–i: same price as sequential in both the "Israel answered" and "thin" cases; cancel on Israeli failure; wider failure leaves local standing; kept evidence starts no wider request; COMPARABLE never goes abroad; wall-clock is the slowest stage, not the sum; rates overlap. |
| 5 existing core-scan suites + `package.json` | The suites that assert the old request order pin `CORE_SCAN_MARKET_PARALLEL=false`, so the sequential mode stays fully covered. The new suite is added to `npm test`. |

**Trade-off (founder decision):** when Israel alone is enough, the wider request has already started and gets cancelled. It may already be billed: input tokens plus possibly one web search, at most about one search stage (around $0.014 at the 2026-10-11 measurement). When Israel is thin, which was every live run so far, there is no extra cost. `CORE_SCAN_MARKET_PARALLEL=false` turns this off without a code deploy.

## H. Verification

- `node --test tests/core-scan-*.test.mjs`: 318 pass / 0 fail.
- `npm test`: **1,879 tests, 1,878 pass, 0 fail, 1 pre-existing skip**; contrast and design lint OK.
- `npm run build`: OK (PWA precache generated). `git diff --check`: clean.
- Live A/B: the scratch script drove the real `runPrice` with the local key, a null store, no Supabase and no Production. It made 8 OpenAI market requests, within the approved $0.30 ceiling (about $0.11 at the measured per-stage cost; about 115k input tokens in total).

## I. Before / after (price step, live, same model and network, interleaved order)

| Item | Sequential | Parallel | Δ |
|---|---|---|---|
| Logitech G Pro X Superlight | 20.9 s | 9.9 s | −11.0 s (−52%) |
| Ninja BL610 | 21.5 s | 11.8 s | −9.7 s (−45%) |

Typical end to end, estimated as identify 6–9 s plus price: about 28–30 s → about 17–21 s. Worst case at the timeouts, under the same assumption: about 70 s → about 55 s.

## J. Remaining risks / needs access

- Identify was not re-timed (no photos, and photo scans need the founder).
- The Production `scan_events` timings were not read. The founder can run `scripts/scan-trace.mjs` to split real 60 s scans by stage.
- Cancellation billing has not been measured on OpenAI's side.
- Against the targets: name in 3–5 s is **not reachable** with `gpt-6.1-sol` (6–9 s measured; a faster model was weaker on 2026-10-06). Price within 15–20 s is now reachable for typical scans. The 22 s stage ceiling and the 35 s / 65 s client aborts are unchanged and could be tightened once real timings are read.
- Optional later work: send the price response before the research save finishes; stream a "searching" state.

## K. Deployment readiness

The change is small and covered by tests, and the switch turns it off without a code deploy. It is **ready for a founder-approved preview → Production release**. It is **not committed, pushed or deployed**. The rollback target stays `ec440b8` (`dpl_JDwtKmoDG1GSKQaTzCWS421M1qyh`).
