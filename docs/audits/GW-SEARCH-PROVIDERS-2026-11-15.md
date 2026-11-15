# Web-search providers for Israeli price discovery — terms review (2026-11-15)

What GetWorth needs from a provider: commercial use inside the app; extracting prices from results; combining them with
OpenAI's evidence; storing the extracted facts and source URLs (research cache, market index, the evidence behind each
stored valuation); reusing them across scans; showing them to users with links. Read from each provider's own terms and
documentation on 2026-11-15. Not legal advice; open questions are listed.

| Provider | Who owns results | Store / cache / reuse | Extract & combine | Snippet text | Verdict |
|---|---|---|---|---|---|
| Google — Grounding with Google Search (Vertex) | Generated Output, but §20(k)(i) | Forbidden: no cache, store (narrow exceptions), "analyze", "learn from" | Forbidden: no extracting components "for another purpose", no modifying or interspersing | — | **Not usable** |
| Google — Vertex AI Search | Customer data | — | Only "web domains that it owns or is authorized to utilize" (§21) | yes | **Not usable** (third-party boards) |
| Google — Custom Search JSON API | — | — | — | yes | **Closed to new customers**, ends 2027-01-01 |
| Brave Search API (standard) | Brave (§9(a)(ii)) | Forbidden: "store, cache, or create a database of Search Results, in whole or in part" except transient (§3(b)(i)); storage rights only on a custom plan via sales | No derivative works of Search Results (§3(b)(ii)) | yes (+5 extra snippets), `age` | **Not usable on standard terms**; possible on a custom storage plan (needs a sales conversation → founder approval) |
| Exa (standard ToS) | not assigned; Exa takes a perpetual licence to inputs and outputs (§1.2(c)) | Forbidden: no copying, derivative works or offering for sale information obtained through the Services, except browser cache (§4.2(a)) | No extracting/collecting data through the Services (§4.2(j)) | yes (text, highlights) | **Not usable on standard terms** |
| Tavily | not assigned (§1.6/1.7) | not addressed | "internal business purposes" only (§2); no data-mining/extraction methods through the Services (§3.2(viii)) | yes | **Unclear → not relied on** |
| Parallel | Customer (§4(b)) | Forbidden: no caching/storing a significant portion, no reusing past outputs (§2(b), §2(c)(xi)), no databases (§2(c)(vi)) | derivative works allowed (§2(b)) | yes | **Not usable** (no storage / reuse) |
| Perplexity — raw Search API (`/search`) | **Not** the customer's ("Customer does not own… the Search API's Output", Schedule 1) | not addressed; Perplexity may retain and use search data (§2.2) | not addressed | yes | Weaker than the Agent API |
| **Perplexity — Agent API (Sonar/agentic research)** | **Customer owns all Output (§2.3.1)**; no training on customer content (§2.3.3) | **not restricted** in the API terms or the AUP | not restricted; AUP requires "all necessary rights" to compiled material (as with any source) | **yes — `search_results[].snippet`, `date`, `last_updated`** | **Selected** |
| OpenAI web search (current) | Customer owns Output | not restricted | not restricted | **no** (titles only) | In use |

## Why Perplexity's Agent API
- The only reviewed provider whose terms give the customer the output without forbidding storage or reuse — the same
  position as the OpenAI search GetWorth already uses.
- It returns each result's **snippet and date**: the text OpenAI never returns, in which GetWorth's binding check can confirm
  that a price sits beside this product (a list-page price becomes checkable instead of the model's word alone).
- Search from Israel (`user_location.country = "IL"`), up to 20 domain filters, recency/date filters, JSON-schema output,
  and the exact cost of every call in `usage.cost`.
- Price (docs, 2026-11-15): web search $2.50 per 1,000 invocations, plus model tokens (per model).

## Open questions
- The source boards' own terms (Homeless, ad.co.il) apply to their content whichever search engine shows it — unchanged from
  today's OpenAI-based search.
- Exact token price of the chosen Agent API model; measured per call from `usage.cost` during the test.
- Sonar chat-completions is described as legacy; the integration uses the Agent API (`POST /v1/agent`).

## Implementation (2730f30 → this release)
`api/_lib/scan/perplexity.js`: a separate provider, run in parallel with the OpenAI Israeli search, off unless
`CORE_SCAN_PERPLEXITY=true` and `PERPLEXITY_API_KEY` are set (server-side only). Every price goes through the existing checks
(reached page, snippet binding, model/size/bundle/age rules, independent-ad counting across providers); a failure or timeout
(20 s) leaves the OpenAI answer unchanged. Tests: `tests/perplexity-provider.test.mjs`.
