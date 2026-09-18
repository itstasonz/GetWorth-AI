// MUTATION FIXTURE — a billable provider in a TypeScript module.
// Same hole as the .cjs fixture: not an extension the scanner opened.
export async function searchComps(q: string): Promise<unknown> {
  const res = await fetch('https://api.ts-market-vendor.example/v1/search', {
    method: 'POST',
    body: JSON.stringify({ q }),
  });
  return res.json();
}
