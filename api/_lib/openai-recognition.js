// ═══════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — experimental OpenAI vision recognition adapter
// ═══════════════════════════════════════════════════════════════════════════
//
// WHAT THIS IS
//   A single OpenAI Responses-API call that answers exactly one question:
//   "what object/product is visible in this image?" — and nothing else.
//
// WHAT THIS IS NOT
//   It is not a pricing authority, not a catalog, and not evidence. Its output
//   is an IDENTITY HYPOTHESIS. Every existing GetWorth trust layer still runs
//   downstream unchanged: calibrateRecognition's silhouette clamp, retrieval's
//   evidence classification (gradeRowEvidence / classifyRowEvidence), the
//   sibling-model protections in rankCandidates, and VAL-001's validateQuote.
//
//   Those layers only work if this file feeds them HONEST INPUTS. Two review
//   findings proved that is the hard part, not the layers themselves: an
//   uncorroborated `model_number` copied into `labels_detected`, and a
//   one-glyph `visible_text` entry, each independently disabled the silhouette
//   clamp AND opened the Stage-2-skipping fast path. Both are fixed and
//   regression-tested below. The lesson is recorded because it will recur:
//   anything this adapter writes into an OCR-shaped field is read downstream
//   as TEXT SOMEONE READ, so it must be text someone actually read.
//
//   CONFIDENCE IS NOT EVIDENCE. `identity_confidence: 0.97` means the model is
//   sure, not that the database agrees. Nothing in this file may promote a
//   model-reported number into an evidence class, an exact-match flag, or a
//   pricing anchor — those are decided by catalog rows, in analyze.js, from
//   text the model did not author.
//
// ── API CONTRACT (verified against current OpenAI docs, not from memory) ────
//   POST https://api.openai.com/v1/responses
//   Authorization: Bearer <OPENAI_API_KEY>
//   body.input[].content[] image part:
//     { type: 'input_image', image_url: 'data:image/jpeg;base64,…', detail }
//   body.text.format = { type: 'json_schema', name, schema, strict: true }
//   body.reasoning.effort — 'none' is supported on the gpt-5.6 family and is
//     what makes this call latency-competitive; the identification task is
//     perceptual, not deductive, so reasoning tokens buy nothing here and are
//     billed as output tokens.
//   body.max_output_tokens caps reasoning + visible output together.
//   Response: output[] items of type 'message' whose content[] carries
//     { type: 'output_text', text } — `output_text` is an SDK convenience and
//     does NOT exist on the raw HTTP body, so it is never read here.
//     A refusal arrives as a content part of type 'refusal'.
//     A truncated response has status 'incomplete' + incomplete_details.reason.
//
// ── SECURITY ────────────────────────────────────────────────────────────────
//   OPENAI_API_KEY is read from process.env inside this server-only module.
//   It is never returned, never attached to an error, and never logged: the
//   key is interpolated into the Authorization header at the call site and
//   nowhere else. scrubKey() is applied to every upstream message that can
//   reach a log line or an Error, because upstream error bodies have been
//   known to echo request headers back.
//
//   `store: false` keeps the user's photograph out of OpenAI-side retention —
//   the parameter defaults to TRUE, so omitting it silently creates a second
//   copy of every scan that no GetWorth deletion can reach. Upstream error
//   text is classified to a stable code before it is persisted or returned,
//   because 4xx bodies have been observed echoing a fragment of the user's
//   own base64 image back at us.
//
//   NOT covered here: image-borne prompt injection. A photograph is fully
//   attacker-controlled and the prompt carries no data-vs-instructions rule.
//   This is PARITY with the current engine, not a regression — Stage 1's
//   prompt has the same gap — so it is documented rather than fixed
//   asymmetrically, which would confound the A/B comparison.
//
//   The model's output is UNTRUSTED TEXT. normalizeOpenAIRecognition() builds
//   its result from a fixed allowlist of fields rather than spreading the
//   parsed object, so no model-authored key can land on the recognition object
//   — in particular the `_`-prefixed internals (`_user_correction`,
//   `_correction_source`, `_val001`, `_pricing_meta`) that downstream stages
//   treat as pipeline-authored facts.
// ═══════════════════════════════════════════════════════════════════════════

// The identity contract — schema, prompt and taxonomy — lives in its own
// module so a prompt or schema tune shows up as a diff to a small file rather
// than a hunk buried in transport code. Re-exported here so callers have one
// import site for the adapter.
import {
  OPENAI_IDENTITY_SCHEMA,
  buildOpenAIRecognitionPrompt,
} from './openai-recognition-contract.js';
// How the answer is interpreted lives in its own module — the file where the
// "confidence is not evidence" rule is actually enforced, and the one worth
// reading on its own.
import { normalizeOpenAIRecognition } from './openai-recognition-normalize.js';

export { normalizeOpenAIRecognition };

// Re-exported for the test harness, which asserts on the schema and prompt.
export { OPENAI_IDENTITY_SCHEMA, buildOpenAIRecognitionPrompt };

// ── Engine identifiers ──────────────────────────────────────────────────────
export const RECOGNITION_ENGINE_CURRENT = 'current';
export const RECOGNITION_ENGINE_OPENAI  = 'openai';

// Default model. gpt-5.6-luna is the cost/latency-optimised member of the
// current vision-capable family and the only tier whose price makes a
// per-scan recognition call economically neutral against the Sonnet call it
// would replace. OPENAI_RECOGNITION_MODEL overrides it for benchmarking
// against gpt-5.6-terra / gpt-5.6-sol / gpt-6-astra without a code change.
export const OPENAI_MODEL_DEFAULT = 'gpt-5.6-luna';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

// Latency budget for the external call itself. The ticket's failure threshold
// is >10s consistently; 8s is the "acceptable" ceiling, so an attempt that has
// not returned by then has already failed the experiment and is worth more as
// a fast fallback than as a slow success.
export const OPENAI_DEFAULT_TIMEOUT_MS = 8_000;

// Output cap. The schema is small and prose is forbidden, so a complete answer
// is ~300-500 tokens; 1200 leaves headroom for a long visible_text array
// without funding an essay. Counted together with reasoning tokens.
const OPENAI_MAX_OUTPUT_TOKENS = 1_200;

// Values a model returns when it means "I don't know". Treated as ABSENCE, not
// as an identity — the whole point of the uncertainty contract is that an
// empty brand must stay empty rather than becoming a candidate named "Unknown"
// that retrieval then tries to match.
// ═══════════════════════════════════════════════════════
// FEATURE FLAG
// ═══════════════════════════════════════════════════════
// Server-side only. The default is the CURRENT engine and stays that way until
// the benchmark says otherwise — an unset, misspelt or partially configured
// environment must never silently route production traffic to the prototype.
// 'openai' additionally requires the key to be present, so a flag flipped
// without credentials degrades to the current engine instead of failing every
// scan with a 503.
export function resolveRecognitionEngine(env = process.env) {
  const raw = String(env?.RECOGNITION_ENGINE ?? '').trim().toLowerCase();
  if (raw !== RECOGNITION_ENGINE_OPENAI) return RECOGNITION_ENGINE_CURRENT;
  if (!env?.OPENAI_API_KEY) {
    console.warn('[OpenAI] RECOGNITION_ENGINE=openai but OPENAI_API_KEY is absent — falling back to the current engine');
    return RECOGNITION_ENGINE_CURRENT;
  }
  return RECOGNITION_ENGINE_OPENAI;
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

// Defence in depth for logs and Error messages. Upstream 4xx bodies sometimes
// echo the offending header back; this guarantees that even then the key does
// not reach a log sink. Keyless environments are a no-op.
export function scrubKey(text, env = process.env) {
  let out = String(text ?? '');
  const key = env?.OPENAI_API_KEY;
  if (key && key.length >= 4) out = out.split(key).join('[REDACTED]');
  // Catch a key we were not given (rotated mid-request, or a different project's
  // key echoed by the upstream) by shape rather than by value.
  // No : it let `xsk-proj-...` slip past, because  requires a word
  // boundary before `s` and `x` is itself a word character (security L2).
  return out.replace(/sk-[A-Za-z0-9_\-]{12,}/g, '[REDACTED]');
}

// REVIEW FINDING (security reviewer, MEDIUM). Upstream error text used to be
// carried verbatim (300 chars) into the client response, `valuations.
// ai_raw_response` and `scan_events.payload`. Reproduced: an OpenAI 400 that
// echoes the offending `image_url` writes ~150 bytes of the USER'S OWN base64
// image into two telemetry ledgers that have no erasure story — and 4xx/429
// bodies also routinely carry org, project and request identifiers.
//
// The full text still goes to the server log, where it is needed for
// debugging and is not user-facing. Everything that is persisted or returned
// gets this stable code instead, which is all the benchmark and the dashboards
// ever needed: it says WHY the engine fell back, with no third-party content.
export function classifyOpenAIFailure(message) {
  const m = String(message ?? '');
  if (!m) return 'unknown';
  if (/\[Timeout\]/.test(m)) return 'timeout';
  if (/network error/.test(m)) return 'network';
  if (/refused the request/.test(m)) return 'refusal';
  if (/response incomplete/.test(m)) return 'incomplete';
  if (/not valid JSON|no output_text|empty response body/.test(m)) return 'parse';
  if (/no fallback budget/.test(m)) return 'no_fallback_budget';
  if (/OPENAI_API_KEY not configured/.test(m)) return 'not_configured';
  if (/no images supplied/.test(m)) return 'no_images';
  const status = m.match(/\[OpenAI\] API (\d{3})/);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return 'auth';
    if (code === 429) return 'rate_limited';
    if (code >= 500) return 'upstream_5xx';
    return `http_${code}`;
  }
  return 'unknown';
}

// validateImages strips a data-URI prefix for its own magic-byte check but
// forwards the UNSTRIPPED string, so a prefixed upload reaches us intact.
// Without stripping here the sniff runs on "data:image/png;base64,iV", atob
// throws on the ':' and ';', and we emit a doubled prefix:
//   data:image/jpeg;base64,data:image/png;base64,iVBOR...
// — wrong MIME and malformed. Parity with the current engine, which has the
// same doubled-prefix bug, but free to fix on this side (security M3).
// The canonical fix is to strip once in analyze.js so `imageList` is
// canonical for BOTH engines; that touches the current engine's path, so it
// is deliberately left for a follow-up rather than done under this ticket.
export function stripDataUriPrefix(v) {
  const str = String(v || '');
  const comma = str.indexOf(',');
  return (comma > -1 && /^data:/i.test(str.slice(0, 5))) ? str.slice(comma + 1) : str;
}

// REVIEW FINDING (security reviewer, M3). Every image was labelled
// `image/jpeg` while validateImages (api/analyze.js) accepts JPEG, PNG, WebP
// and HEIC. The current engine hardcodes the same thing, so it is parity in
// code — but providers need not tolerate a MIME mismatch identically, and a
// rejection here burns the FULL 8s attempt before falling back, roughly
// doubling Stage 1 and silently biasing the benchmark toward JPEG uploads.
//
// Detected from the same magic bytes validateImages already checks, so the
// two cannot disagree about what a file is. HEIC is reported as such rather
// than mislabelled: OpenAI does not accept it, and an honest 400 naming the
// real format is far easier to diagnose than a decode failure on a file we
// told the provider was a JPEG.
export function detectImageMime(b64, fallback = 'image/jpeg') {
  try {
    const head = stripDataUriPrefix(b64).slice(0, 24);
    if (!head) return fallback;
    const bin = atob(head);
    const b = [];
    for (let i = 0; i < bin.length; i++) b.push(bin.charCodeAt(i));
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/heic';
    return fallback;
  } catch {
    return fallback;
  }
}

// ═══════════════════════════════════════════════════════
// RESPONSE PARSING
// ═══════════════════════════════════════════════════════
// Extracts the JSON payload from a raw Responses-API body. Every failure mode
// the API documents is handled explicitly and throws a typed error, because
// the caller's fallback decision depends on telling "OpenAI refused" apart
// from "OpenAI was cut off" apart from "OpenAI returned junk".
export function extractOpenAIJson(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('[OpenAI] empty response body');
  }
  if (body.status === 'incomplete') {
    const reason = body.incomplete_details?.reason || 'unknown';
    throw new Error(`[OpenAI] response incomplete (${reason})`);
  }

  let text = '';
  for (const item of Array.isArray(body.output) ? body.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      // A refusal is a successful HTTP call with no usable identity in it.
      // Surfacing it as a distinct error keeps it out of the "malformed JSON"
      // bucket, where it would look like a bug rather than a policy outcome.
      if (part?.type === 'refusal') {
        throw new Error('[OpenAI] model refused the request');
      }
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        text += part.text;
      }
    }
  }

  if (!text.trim()) throw new Error('[OpenAI] no output_text in response');

  try {
    return JSON.parse(text);
  } catch {
    // Strict structured outputs should make this unreachable. It is handled
    // anyway: "should be unreachable" is not a runtime guarantee, and an
    // unhandled throw here would take down a scan rather than fall back.
    throw new Error('[OpenAI] output was not valid JSON');
  }
}

// ═══════════════════════════════════════════════════════
// THE CALL
// ═══════════════════════════════════════════════════════
// Resolves to { recognition, meta } or throws. It never returns a partial or
// fabricated identity: every failure path throws so the caller makes ONE
// explicit fallback decision instead of unknowingly pricing a stub.
//
// `images` are bare base64 strings (no data-URL prefix) — the same shape
// analyze.js already validates and hands to recognize().
export async function recognizeWithOpenAI(images, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_RECOGNITION_MODEL || OPENAI_MODEL_DEFAULT,
  timeoutMs = OPENAI_DEFAULT_TIMEOUT_MS,
  language = 'he',
  detail = 'auto',
  safetyIdentifier = null,
  fetchImpl = fetch,
  env = process.env,
  // BILLING BOUNDARY callback. Invoked the moment OpenAI answers 2xx — tokens
  // have been generated and charged by then, and everything after it (body
  // read, JSON parse, contract validation, refusal/incomplete checks) can
  // throw. A caller that falls back to another provider must still know this
  // attempt was billed. Round-6: a 200 that fails OUR schema is still billed.
  onBilled = null,
} = {}) {
  if (!apiKey) throw new Error('[OpenAI] OPENAI_API_KEY not configured');
  if (!Array.isArray(images) || images.length === 0) throw new Error('[OpenAI] no images supplied');

  const content = [
    ...images.map((raw) => {
      // Strip first, then sniff, then rebuild — so a prefixed upload cannot
      // produce a doubled data-URI (security M3).
      const b64 = stripDataUriPrefix(raw);
      return { type: 'input_image', image_url: `data:${detectImageMime(b64)};base64,${b64}`, detail };
    }),
    {
      type: 'input_text',
      text: images.length > 1
        ? `${buildOpenAIRecognitionPrompt(language)}\n\n[${images.length} images of the SAME item. Cross-reference all of them.]`
        : buildOpenAIRecognitionPrompt(language),
    },
  ];

  const body = {
    model,
    input: [{ role: 'user', content }],
    // REVIEW FINDING (security reviewer, HIGH). `store` defaults to TRUE on
    // the Responses API and stored requests are retained for at least 30 days
    // and browsable in the org's Logs dashboard. Without this line every
    // scanned photograph — personal property, and whatever faces, documents
    // or addresses happen to be in frame — became a second copy we cannot
    // reach or delete, which breaks the erasure story for a GetWorth account
    // deletion. Recognition needs no server-side state, so there is nothing
    // to trade away here.
    store: false,
    // Pseudonymous abuse-attribution handle. Deliberately NOT the user id or
    // email: it is only required to be stable per user, so an opaque
    // per-request value keeps OpenAI-side abuse signals actionable without
    // exporting an internal identifier to a third party. Callers that want
    // true per-user stability pass their own already-hashed value.
    ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    // Perceptual task: reasoning tokens add latency and output-token cost
    // without adding recognition quality, and they are what would push this
    // past the ≤5s target. 'none' is supported on the gpt-5.6 family.
    reasoning: { effort: 'none' },
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: 'json_schema',
        name: 'getworth_identity',
        schema: OPENAI_IDENTITY_SCHEMA,
        strict: true,
      },
    },
  };

  // Single attempt, no retry. A retry cannot fit the latency budget this
  // prototype exists to prove, and the caller already has a fallback that is
  // strictly better than a second slow attempt.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  let res;
  try {
    res = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (err?.name === 'AbortError') {
      throw new Error(`[OpenAI] [Timeout] recognition aborted at ${timeoutMs}ms`);
    }
    throw new Error(`[OpenAI] network error after ${elapsed}ms: ${scrubKey(err?.message, env)}`);
  }

  if (res.ok) onBilled?.('openai', `http_${res.status}`);

  if (!res.ok) {
    // Clear AFTER the body read, not before (security review L1): clearing
    // first leaves a stalled error body un-abortable, so the socket dangles
    // until the caller's outer withTimeout fires. Not a budget breach — that
    // outer bound still holds — but a leak with no reason to exist.
    let detailText = '';
    try {
      detailText = scrubKey(await res.text(), env).slice(0, 300);
    } catch { /* a body we cannot read tells us nothing; the status still does */ }
    clearTimeout(timer);
    throw new Error(`[OpenAI] API ${res.status}: ${detailText || 'no body'}`);
  }

  // MEASUREMENT BOUNDARY — read this before moving either line.
  //
  // `await fetch()` resolves when the response HEADERS arrive; the body is
  // still streaming. Stopping the clock there would report time-to-headers
  // and call it recognition latency. The current engine's own Stage 1 timer
  // (`timed('stage1_vision', …)` around `recognize()`) spans its `res.json()`,
  // so measuring to headers here would hand OpenAI a free head start in the
  // one comparison this whole ticket exists to make.
  //
  // The body read is therefore INSIDE the measured window and the local
  // JSON-shape work (extract + normalize) is outside it. That is the same
  // boundary the current engine uses, which is what makes the two numbers
  // comparable.
  const parsedBody = await res.json().catch(() => null);
  clearTimeout(timer);
  const apiMs = Date.now() - t0;

  const payload = extractOpenAIJson(parsedBody);
  const recognition = normalizeOpenAIRecognition(payload, { language });

  return {
    recognition,
    meta: {
      // The EXTERNAL call only — request sent to response received. Parsing and
      // normalization are excluded deliberately: the question this prototype
      // must answer is how long OpenAI takes, and folding local CPU into that
      // number would flatter or blame the wrong component.
      openai_recognition_ms: apiMs,
      model,
      // Usage field names are read defensively rather than assumed, so a
      // response shape change degrades to null instead of throwing inside a
      // telemetry path.
      input_tokens: parsedBody?.usage?.input_tokens ?? null,
      output_tokens: parsedBody?.usage?.output_tokens ?? null,
      response_id: typeof parsedBody?.id === 'string' ? parsedBody.id : null,
    },
  };
}

// ═══════════════════════════════════════════════════════
// TELEMETRY SHAPER
// ═══════════════════════════════════════════════════════
// REVIEW FINDING (architecture reviewer, HIGH). api/analyze.js used to reach
// into `recognition._openai.*` with four separate `?? null` chains to build
// its debug payload. That coupled the pipeline to this module's private
// namespace, and the `?? null` guaranteed the failure would be SILENT: rename
// a field here and analyze.js emits nulls forever with no test to catch it.
//
// One shaper, owned by the module that owns the namespace. analyze.js spreads
// the result and knows nothing about the layout.
//
// It carries latencies and provenance, never credentials and never a price.
// `identity_confidence` is included precisely so a reviewer can see how often
// the model was certain while the trust layer disagreed — it is a diagnostic,
// and nothing in the pipeline branches on it.
export function buildOpenAITelemetry({ requested, used, recognition, meta, failureCode } = {}) {
  const o = recognition?._openai ?? null;
  return {
    requested: requested ?? null,
    used: used ?? null,
    // A stable classification, never raw upstream text — see
    // classifyOpenAIFailure for why this is not the provider's message.
    fallback_reason: failureCode ?? null,
    openai_recognition_ms: meta?.openai_recognition_ms ?? null,
    openai_model: meta?.model ?? null,
    openai_input_tokens: meta?.input_tokens ?? null,
    openai_output_tokens: meta?.output_tokens ?? null,
    identity_confidence: o?.identity_confidence ?? null,
    needs_confirmation: o?.needs_confirmation ?? null,
    // Surfaced so the benchmark can split corroboration by packaging-vs-item
    // and MEASURE the accepted box-copy false negative instead of assuming it
    // is small (recognition review).
    is_packaging: o?.is_packaging ?? null,
    // Named to state what they measure, not what a reader might hope they
    // measure: the claim APPEARS in the strings the model returned. When the
    // model echoes its own guess, that is a tautology, not corroboration.
    brand_appears_in_returned_text: o?.brand_appears_in_returned_text ?? null,
    model_appears_in_returned_text: o?.model_appears_in_returned_text ?? null,
  };
}
