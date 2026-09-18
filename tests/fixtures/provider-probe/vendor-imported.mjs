// MUTATION FIXTURE — consumes an imported host constant, plus a template whose
// authority is interpolated. Two shapes, neither statically resolvable HERE.
import { MARKET_HOST } from './host-constant.mjs';

const VENDOR = process.env.MARKET_VENDOR || 'default';

export async function a(q) {
  return fetch(MARKET_HOST + '/v1/search?q=' + q);
}

export async function b(q) {
  return fetch(`https://${VENDOR}.market.example/v1/search?q=${q}`);
}
