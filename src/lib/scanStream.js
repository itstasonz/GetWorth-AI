// A CHAINED SCAN ANSWER (api/scan.js, body.chain): one request, newline-delimited JSON — the identity first, the price second.
// `lineReader(res)` returns `next()`: each call resolves with the next line as an object, or null when the stream ends or a
// line is not JSON. Nothing is guessed from a partial line.
export function lineReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
  return async function next() {
    for (;;) {
      const at = buffer.indexOf('\n');
      if (at >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) return parse(line);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) {
        const line = buffer.trim();
        buffer = '';
        return line ? parse(line) : null;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };
}
