// CONTROL — a module with no outbound request and no host literal.
// If this ever reports a finding, the scanner is producing noise and its other
// verdicts mean less. The comment below must be dropped, not read as a call:
//   https://api.anthropic.com/v1/messages
/* and a block comment: https://api.openai.com/v1/responses */
export function pure(a, b) {
  const label = 'a prompt line that merely says the word fetch(';
  return { a, b, n: label.length };
}
