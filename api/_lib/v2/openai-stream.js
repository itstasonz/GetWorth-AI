// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — ONE STREAMED RESPONSES-API CALL
//
// Both V2 provider calls go through `streamResponse`, and nothing else in the
// V2 tree constructs a request.
//
// STREAMED FOR TWO REASONS. The time inside a request is only visible in a
// stream (first event, first output, completion), and the search call has to be
// STOPPED PART-WAY: the search results are complete seconds before the model
// finishes writing, and V2 reads the results rather than the writing.
//
// The security-critical helpers are the ones api/_lib/openai-recognition.js
// already hardened, imported and not re-implemented.
// ══════════════════════════════════════════════════════════════════════════════
import { scrubKey, classifyOpenAIFailure } from '../openai-recognition.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * Send one streamed request and read it to its end, or to `stop()`.
 *
 * `onEvent(event, { stop, at })` is called for every server-sent event. Calling
 * `stop()` ends the request immediately; what was received until then is
 * returned with `stopped_early: true`.
 *
 * Resolves to { final, items, timings, usage, stopped_early, billed } or throws
 * an Error whose message `classifyOpenAIFailure` understands. Never returns a
 * fabricated result.
 */
export async function streamResponse({
  stage,
  body,
  apiKey = process.env.OPENAI_API_KEY,
  timeoutMs = 20_000,
  onEvent = null,
  // A default parameter, evaluated at CALL time, so a test harness that
  // replaces globalThis.fetch is what runs (see phaseb/openai-client.js).
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('[OpenAI] OPENAI_API_KEY not configured');
  if (!body || typeof body !== 'object') throw new Error('[OpenAI] no request body supplied');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const timings = { headers_ms: null, first_event_ms: null, first_output_ms: null, total_ms: null };
  const items = [];
  let final = null;
  let stopped = false;
  let billed = false;
  const stop = () => { stopped = true; controller.abort(); };
  const timeoutError = () => new Error(`[Timeout] ${stage} exceeded ${timeoutMs}ms`);

  let res;
  try {
    res = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw (timedOut ? timeoutError() : new Error(`[OpenAI] network error: ${scrubKey(err?.message)}`));
  }
  timings.headers_ms = at();

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    clearTimeout(timer);
    throw new Error(`[OpenAI] API ${res.status}: ${scrubKey(text).slice(0, 300)}`);
  }
  // Tokens are generated and charged from here on, whatever happens below.
  billed = true;

  const handle = (event) => {
    const type = String(event?.type ?? '');
    timings.first_event_ms ??= at();
    if (type.endsWith('output_text.delta')) timings.first_output_ms ??= at();
    if (type === 'response.output_item.done' && event.item) items.push(event.item);
    if (event?.response && /^response\.(completed|incomplete|failed)$/.test(type)) final = event.response;
    if (onEvent) onEvent(event, { stop, at });
  };

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1 && !stopped) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!data || data === '[DONE]') continue;
        let event = null;
        try { event = JSON.parse(data); } catch { continue; }
        handle(event);
      }
    }
  } catch (err) {
    // An abort we asked for is the normal end of a stopped request.
    if (!stopped) {
      clearTimeout(timer);
      throw (timedOut ? timeoutError() : new Error(`[OpenAI] stream error: ${scrubKey(err?.message)}`));
    }
  }
  clearTimeout(timer);
  timings.total_ms = at();

  if (!final && !stopped) throw new Error('[OpenAI] no output_text in response (stream ended without a final response)');
  if (final?.status === 'failed') throw new Error(`[OpenAI] API 500: ${scrubKey(final?.error?.message ?? 'response failed').slice(0, 200)}`);

  const usage = final?.usage
    ? {
      input_tokens: final.usage.input_tokens ?? null,
      output_tokens: final.usage.output_tokens ?? null,
      reasoning_tokens: final.usage.output_tokens_details?.reasoning_tokens ?? null,
    }
    : null;
  return {
    final,
    // The completed output items, from the final response when there is one and
    // from the stream when the request was stopped before it.
    items: Array.isArray(final?.output) ? final.output : items,
    timings,
    usage,
    stopped_early: stopped,
    billed,
    model: final?.model ?? body.model ?? null,
  };
}

export { classifyOpenAIFailure };
