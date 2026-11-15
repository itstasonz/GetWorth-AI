// ══════════════════════════════════════════════════════════════════════════════
// A SECOND SEARCH PROVIDER: PERPLEXITY AGENT API (2026-11-15), off unless configured.
//
// Why this provider: of the web-search APIs reviewed (Google grounding, Vertex AI Search, Brave, Exa, Tavily, Parallel,
// Perplexity — docs/audits/GW-SEARCH-PROVIDERS-2026-11-15.md), Perplexity's API terms (§2.3.1) are the only ones that give
// the customer ownership of the output without a ban on storing or reusing it, and its web search returns each result's
// SNIPPET — the text OpenAI's search never returns, in which a price can be checked against the product it sits beside
// (binding.js). Its answer is the same evidence schema as OpenAI's (market.js MARKET_SCHEMA), and every price it reports
// goes through the same checks: the page must be one the search returned, the snippet must tie the price to the product,
// another model, size, bundle or an old ad is set aside, and one ad seen by both providers is one ad.
//
// Enabled only when CORE_SCAN_PERPLEXITY is exactly 'true' AND PERPLEXITY_API_KEY is set (server-side only). It runs
// alongside the OpenAI Israeli search, never after it; a failure or a timeout leaves the OpenAI evidence standing.
// ══════════════════════════════════════════════════════════════════════════════
import { buildMarketPrompt, MARKET_SCHEMA, marketDate } from './market.js';

export const PERPLEXITY_URL = 'https://api.perplexity.ai/v1/agent';
export const PERPLEXITY_FLAG_ENV = 'CORE_SCAN_PERPLEXITY';
export const PERPLEXITY_KEY_ENV = 'PERPLEXITY_API_KEY';
export const PERPLEXITY_MODEL_ENV = 'PERPLEXITY_MODEL';
export const PERPLEXITY_MODEL_DEFAULT = 'openai/gpt-5.6-sol';
export const PERPLEXITY_TIMEOUT_MS = 20_000;
const MAX_RESULTS = 20;
const MAX_TOKENS_PER_PAGE = 600;

/** { key, model } when switched on and configured; otherwise null. The key never leaves the server. */
export function resolvePerplexity(env = process.env) {
  if (String(env?.[PERPLEXITY_FLAG_ENV] ?? '').trim().toLowerCase() !== 'true') return null;
  const key = String(env?.[PERPLEXITY_KEY_ENV] ?? '').trim();
  if (!key) return null;
  return { key, model: String(env?.[PERPLEXITY_MODEL_ENV] ?? '').trim() || PERPLEXITY_MODEL_DEFAULT };
}

/** The request: the same researcher prompt and evidence schema as the OpenAI Israeli search, searched from Israel. */
export function perplexityRequest({ identity, answer = null, model, now = Date.now() }) {
  return {
    model,
    input: buildMarketPrompt({ identity, answer, today: marketDate(now), stage: 'local' }),
    tools: [{ type: 'web_search', user_location: { country: 'IL' }, max_results: MAX_RESULTS, max_tokens_per_page: MAX_TOKENS_PER_PAGE }],
    response_format: { type: 'json_schema', json_schema: { name: 'getworth_market_evidence', schema: MARKET_SCHEMA } },
  };
}

/**
 * The answer as the price step reads every stage's: `raw` (the model's evidence), `provenance` (the pages the search
 * returned, each with its snippet as the page text) and `meta`. Nothing in the snippet is invented here: a result with no
 * snippet has no text, and binding treats it as it treats any page with no text.
 */
export function parsePerplexity(body) {
  const output = Array.isArray(body?.output) ? body.output : [];
  const results = [];
  const queries = [];
  for (const item of output) {
    if (item?.type !== 'search_results' && item?.type !== 'fetch_url_results') continue;
    for (const q of Array.isArray(item.queries) ? item.queries : []) if (typeof q === 'string' && q.trim()) queries.push(q.trim().slice(0, 300));
    for (const r of [...(Array.isArray(item.results) ? item.results : []), ...(Array.isArray(item.contents) ? item.contents : [])]) {
      if (!r || typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url)) continue;
      const dated = typeof r.date === 'string' && r.date ? `\nDate: ${r.date}` : '';
      results.push({ url: r.url, title: typeof r.title === 'string' ? r.title.slice(0, 300) : null, text: typeof r.snippet === 'string' ? `${r.snippet.slice(0, 4000)}${dated}` : null });
    }
  }
  const message = output.find((o) => o?.type === 'message');
  const text = (Array.isArray(message?.content) ? message.content : []).filter((c) => c?.type === 'output_text').map((c) => c.text).join('');
  let raw = null;
  try { raw = JSON.parse(text); } catch { raw = null; }
  const usage = body?.usage ?? {};
  return {
    raw,
    provenance: { tool: 'perplexity_web_search', search_performed: results.length > 0, queries: [...new Set(queries)], sources: [...new Set(results.map((r) => r.url))], results },
    meta: {
      model: body?.model ?? null,
      usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0, reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0 },
      cost_usd: Number.isFinite(usage?.cost?.total_cost) ? usage.cost.total_cost : null,
      queries_planned: 0,
    },
  };
}

/** One Perplexity research call. Throws on a refusal, a timeout or an unreadable answer, as researchMarket does. */
export async function researchPerplexity({ identity, answer = null, key, model, fetchImpl = fetch, now = Date.now(), timeoutMs = PERPLEXITY_TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(PERPLEXITY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(perplexityRequest({ identity, answer, model, now })),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`perplexity HTTP ${res.status} ${String(body?.error?.message ?? body?.error?.type ?? '').slice(0, 120)}`);
    const parsed = parsePerplexity(body);
    if (!parsed.raw || !Array.isArray(parsed.raw.evidence)) throw new Error('perplexity: unreadable answer');
    return { ...parsed, meta: { ...parsed.meta, ms: Date.now() - t0 } };
  } finally {
    clearTimeout(timer);
  }
}
