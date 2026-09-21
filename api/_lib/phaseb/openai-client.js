// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — THE ONE PLACE THAT TALKS TO OPENAI
//
// §38 asks that no stage unknowingly calls OpenAI twice, and that provider
// calls be centralised. Every Phase-B stage goes through `callStructured`
// below; nothing else in the Phase-B tree constructs a request.
//
// ── WHAT THIS REUSES, AND WHY IT DOES NOT COPY IT ───────────────────────────
//
// api/_lib/openai-recognition.js already solves the security-critical parts of
// this transport, and every one of them was solved in response to a review
// finding: `scrubKey` (upstream 4xx bodies have echoed request headers),
// `stripDataUriPrefix`/`detectImageMime` (a prefixed upload produced a doubled
// data URI), `extractOpenAIJson` (a refusal is a 200, and `output_text` does
// not exist on the raw HTTP body), and `classifyOpenAIFailure`.
//
// Those are IMPORTED, not re-implemented. This repository has recorded the
// "two implementations of one predicate" defect three times — `/watch/` versus
// `includes('watch')`, two evidence serialisers, two confidence parsers — and
// a second copy of the key scrubber is exactly that defect with a security
// consequence. What is NOT reused is `recognizeWithOpenAI` itself: it is
// hardwired to one prompt and one schema, and Phase B needs several. Wrapping
// it would have meant changing it, and §2 forbids touching the production
// recognition path to make Phase B work.
//
// ── THE CALL LEDGER ─────────────────────────────────────────────────────────
//
// Every attempt is recorded with a stage name and an id before the request is
// sent, so §38's "one stage must not unknowingly call OpenAI twice" is
// observable rather than asserted, and §26's accounting boundary has something
// real to count. The ledger is returned with the candidate in development
// metadata; it contains no prompt bodies and no key.
// ══════════════════════════════════════════════════════════════════════════════
import {
  scrubKey,
  classifyOpenAIFailure,
  stripDataUriPrefix,
  detectImageMime,
  extractOpenAIJson,
} from '../openai-recognition.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** A fresh ledger. One per enrichment request. */
export function createCallLedger() {
  const calls = [];
  return {
    calls,
    /** Record an attempt BEFORE it is sent, so a throw still leaves a trace. */
    begin(stage, model) {
      const entry = {
        id: `${stage}-${calls.length + 1}`,
        stage,
        model,
        started_ms: Date.now(),
        duration_ms: null,
        status: 'attempted',
        billed: false,
        failure_code: null,
        usage: null,
      };
      calls.push(entry);
      return entry;
    },
    /** What §26 asks to be recorded: attempts, billed state, outcomes. */
    summary() {
      return {
        attempts: calls.length,
        billed: calls.filter((c) => c.billed).length,
        by_stage: calls.map((c) => ({
          id: c.id, stage: c.stage, status: c.status,
          duration_ms: c.duration_ms, billed: c.billed, failure_code: c.failure_code,
        })),
      };
    },
  };
}

/**
 * One structured Responses-API call.
 *
 * Returns { data, meta } or throws. Never returns a partial or fabricated
 * result: §5 and §28 both require that a failure be a failure, because a
 * fabricated success is indistinguishable downstream from a real one.
 *
 * `tools` is passed through so the market-research stage can attach a search
 * tool WITHOUT this module knowing what search means (§14). Everything else
 * about the request shape is fixed here.
 */
export async function callStructured({
  stage,
  images = [],
  prompt,
  schema,
  schemaName,
  model,
  apiKey = process.env.OPENAI_API_KEY,
  timeoutMs = 60_000,
  maxOutputTokens = 3_000,
  reasoningEffort = 'low',
  tools = null,
  safetyIdentifier = null,
  ledger = null,
  // A DEFAULT PARAMETER, not a module-scope capture — the pattern
  // api/_lib/openai-recognition.js already uses, and the difference is
  // load-bearing twice over. Assigning globalThis.fetch to a module-scope const
  // is a CAPTURED ENTRYPOINT: the static scanner refuses it by name (H-7), and
  // it binds the real fetch at module-load time, before a test harness can
  // install its dispatcher — which is precisely how five planted adapters once
  // reached the network with `state.unknownHosts` left empty. A default
  // parameter is evaluated at CALL time, so the harness's patched
  // globalThis.fetch is what runs and the call stays observable.
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('[OpenAI] OPENAI_API_KEY not configured');
  if (!prompt) throw new Error('[OpenAI] no prompt supplied');
  if (!schema || !schemaName) throw new Error('[OpenAI] no schema supplied');

  const entry = ledger ? ledger.begin(stage, model) : null;
  const t0 = Date.now();

  const content = [
    ...images.map((raw) => {
      const b64 = stripDataUriPrefix(raw);
      return { type: 'input_image', image_url: `data:${detectImageMime(b64)};base64,${b64}`, detail: 'high' };
    }),
    { type: 'input_text', text: prompt },
  ];

  const body = {
    model,
    input: [{ role: 'user', content }],
    // `store` defaults to TRUE. Without this every scanned photograph becomes
    // a second copy in OpenAI's retention that no GetWorth deletion can reach
    // — the finding a security reviewer raised against the recognition
    // adapter, and it applies identically here.
    store: false,
    ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    // Unlike recognition, Phase B is a REASONING task: disambiguating a
    // variant, matching comparables and reading condition from pixels all
    // benefit from thinking. §37 is explicit that correctness comes first and
    // latency is measured rather than optimised for.
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
    ...(tools ? { tools } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err?.name === 'AbortError'
      ? `[Timeout] ${stage} exceeded ${timeoutMs}ms`
      : `[OpenAI] network error: ${scrubKey(err?.message)}`;
    if (entry) {
      entry.status = 'failed';
      entry.duration_ms = Date.now() - t0;
      entry.failure_code = classifyOpenAIFailure(msg);
    }
    throw new Error(msg);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = `[OpenAI] API ${res.status}: ${scrubKey(text).slice(0, 300)}`;
    if (entry) {
      entry.status = 'failed';
      entry.duration_ms = Date.now() - t0;
      entry.failure_code = classifyOpenAIFailure(msg);
    }
    throw new Error(msg);
  }

  // THE BILLING BOUNDARY. Tokens have been generated and charged by the time
  // OpenAI answers 2xx. Everything below this line can still throw — a body
  // read, a refusal, a truncation, a schema miss — and §26 needs the attempt
  // recorded as BILLED regardless.
  if (entry) entry.billed = true;

  let parsed;
  let raw;
  try {
    raw = await res.json();
    parsed = extractOpenAIJson(raw);
  } catch (err) {
    const msg = scrubKey(err?.message || String(err));
    if (entry) {
      entry.status = 'failed';
      entry.duration_ms = Date.now() - t0;
      entry.failure_code = classifyOpenAIFailure(msg);
    }
    throw new Error(msg);
  }

  const duration = Date.now() - t0;
  if (entry) {
    entry.status = 'ok';
    entry.duration_ms = duration;
    entry.usage = raw?.usage
      ? { input_tokens: raw.usage.input_tokens ?? null, output_tokens: raw.usage.output_tokens ?? null }
      : null;
  }

  return {
    data: parsed,
    meta: {
      stage,
      model: raw?.model ?? model,
      duration_ms: duration,
      usage: entry?.usage ?? null,
      // The raw search results a tool produced, when one ran. Kept so the
      // market adapter can attribute sources (§14) without this module
      // understanding what a source is.
      output: Array.isArray(raw?.output) ? raw.output : [],
    },
  };
}

export { classifyOpenAIFailure };
