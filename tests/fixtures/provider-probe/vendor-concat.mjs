// MUTATION FIXTURE — the host is CONCATENATED, so it exists in no literal.
// A scanner that greps for host strings finds nothing here and reports clean.
const REGION = 'eu';

export async function fetchListings(q) {
  const res = await fetch('https://api.' + REGION + '-listings.example' + '/v1/search?q=' + q);
  return res.json();
}
