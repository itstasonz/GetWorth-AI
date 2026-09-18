// MUTATION FIXTURE — a billable provider in a CommonJS module.
// The round-9 scanner read only `.js` and `.mjs`, so this file would not have
// been opened at all while the discovery comment claimed every production
// module was found. Nothing imports this; it exists to be scanned.
'use strict';

async function priceFromVendor(query) {
  const res = await fetch('https://api.cjs-market-vendor.example/v1/prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

module.exports = { priceFromVendor };
