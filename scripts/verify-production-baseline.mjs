#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION BASELINE VERIFICATION — READ-ONLY
//
// Before anything is deployed, what Production runs NOW is read off Production
// itself — not off memory, a conversation, or a dashboard. The build writes
// its own commit into the bundle (vite.config.js `__BUILD_SHA__`, kept on
// `window.__GW_SHA__` by App.jsx). This script fetches the live page, follows
// its module scripts, reads that literal back, and checks it against git: the
// commit must be one this repository knows, and — when a baseline is expected
// — it must be that one. The result is the rollback target, stated from
// evidence, before a new build goes anywhere.
//
//   node scripts/verify-production-baseline.mjs [--url https://get-worth-ai.vercel.app] [--expect 40d0b2c]
//                                               [--bypass-env NAME_OF_ENV_VAR]
//
// `--bypass-env` names an environment variable holding a Vercel protection
// bypass secret for a protected deployment; it is sent as a header and never
// printed. The script makes GET requests only. It deploys, promotes, writes
// and changes nothing.
//
// Exit 0: the SHA was read, git knows it, and it matches the expectation (or
// none was given). Exit 1: it was read and does NOT match. Exit 2: it could
// not be read, or git does not know it.
// ══════════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_URL = 'https://get-worth-ai.vercel.app';
const MAX_SCRIPTS = 12;
const MAX_BYTES = 6 * 1024 * 1024;

const QUOTE = '[`"\']';
const SHA = '([0-9a-f]{7,40}|local)';
/**
 * The commit literal App.jsx leaves on the window object, as the minified bundle carries it; null when absent.
 * The minifier keeps the define in a variable — `window.__GW_SHA__=Rr` with `Rr=\`40d0b2c\`` declared elsewhere in
 * the same module — so the reference is followed to its declaration; a direct literal is read as it is.
 */
export function findBuildSha(js) {
  const text = String(js ?? '');
  const direct = new RegExp(`__GW_SHA__\\s*=\\s*${QUOTE}${SHA}${QUOTE}`).exec(text);
  if (direct) return direct[1];
  const ref = /__GW_SHA__\s*=\s*([A-Za-z_$][\w$]*)\b/.exec(text);
  if (!ref) return null;
  const name = ref[1].replace(/\$/g, '\\$');
  const decl = new RegExp(`(?:^|[^\\w$.])${name}\\s*=\\s*${QUOTE}${SHA}${QUOTE}`).exec(text);
  return decl ? decl[1] : null;
}

/** The module scripts a page loads, as absolute URLs, in document order: `<script type="module" src>` first, then modulepreload links. */
export function moduleScripts(html, base) {
  const out = [];
  const add = (src) => { try { const u = new URL(src, base).href; if (!out.includes(u)) out.push(u); } catch { /* not a url */ } };
  const text = String(html ?? '');
  for (const m of text.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["']module["']/gi)) add(m[1]);
  for (const m of text.matchAll(/<link\b[^>]*\brel\s*=\s*["']modulepreload["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  return out.slice(0, MAX_SCRIPTS);
}

/** 'match' | 'mismatch' | 'unknown' — a short expectation matches a long SHA by prefix, as `git log` would. */
export function compareBaseline(found, expected) {
  if (!found) return 'unknown';
  if (!expected) return 'match';
  const a = String(found).toLowerCase();
  const b = String(expected).toLowerCase();
  return a.startsWith(b) || b.startsWith(a) ? 'match' : 'mismatch';
}

/**
 * Read the commit a deployment is serving. Resolves to { sha, source, page_status, scripts }: `sha` is null when it
 * could not be read, and `source` says where it was found. GET requests only.
 */
export async function readDeployedSha({ url = DEFAULT_URL, fetchImpl = fetch, headers = {} } = {}) {
  const get = async (target) => {
    const res = await fetchImpl(target, { headers: { ...headers, 'cache-control': 'no-cache' }, redirect: 'follow' });
    const text = res.ok ? (await res.text()).slice(0, MAX_BYTES) : '';
    return { status: res.status, text };
  };
  const page = await get(new URL('/', url).href);
  if (page.status !== 200) return { sha: null, source: null, page_status: page.status, scripts: [] };
  const inline = findBuildSha(page.text);
  if (inline) return { sha: inline, source: 'page', page_status: 200, scripts: [] };
  const scripts = moduleScripts(page.text, url);
  for (const s of scripts) {
    const js = await get(s);
    const sha = js.status === 200 ? findBuildSha(js.text) : null;
    if (sha) return { sha, source: s, page_status: 200, scripts };
  }
  return { sha: null, source: null, page_status: 200, scripts };
}

/** What git knows about a SHA: its subject, its date, and whether it is an ancestor of HEAD. Never throws. */
export function describeCommit(sha, { cwd = process.cwd() } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    const full = git('rev-parse', '--verify', `${sha}^{commit}`);
    const subject = git('log', '-1', '--format=%s', full);
    const date = git('log', '-1', '--format=%cI', full);
    let onBranch = false;
    try { git('merge-base', '--is-ancestor', full, 'HEAD'); onBranch = true; } catch { onBranch = false; }
    return { known: true, full, subject, date, on_branch: onBranch };
  } catch {
    return { known: false, full: null, subject: null, date: null, on_branch: false };
  }
}

function parseArgs(argv) {
  const out = { url: DEFAULT_URL, expect: null, bypassEnv: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--expect') out.expect = argv[++i];
    else if (a === '--bypass-env') out.bypassEnv = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.help) { log('node scripts/verify-production-baseline.mjs [--url URL] [--expect SHA] [--bypass-env ENV_VAR]'); return 0; }
  const headers = {};
  if (args.bypassEnv) {
    const secret = process.env[args.bypassEnv];
    if (!secret) { log(`[baseline] ${args.bypassEnv} is not set`); return 2; }
    headers['x-vercel-protection-bypass'] = secret;
  }
  const read = await readDeployedSha({ url: args.url, headers });
  log(`[baseline] url          ${args.url}`);
  log(`[baseline] page         HTTP ${read.page_status}`);
  if (!read.sha) {
    log(`[baseline] build sha    NOT FOUND (${read.scripts.length} module scripts read)`);
    log('[baseline] result       UNDETERMINED');
    return 2;
  }
  const commit = describeCommit(read.sha);
  log(`[baseline] build sha    ${read.sha}  (from ${read.source === 'page' ? 'the page' : new URL(read.source).pathname})`);
  log(`[baseline] git          ${commit.known ? `${commit.full.slice(0, 7)}  ${commit.subject}  (${commit.date})` : 'UNKNOWN to this repository: fetch before trusting it'}`);
  log(`[baseline] on HEAD      ${commit.known ? (commit.on_branch ? 'yes: an ancestor of the current branch' : 'NO: not an ancestor of the current branch') : '-'}`);
  // One route, one cheap probe: the API answers at all (GET is refused by design; a 404 would mean no API).
  try {
    const api = await fetch(new URL('/api/scan', args.url).href, { headers, redirect: 'manual' });
    log(`[baseline] /api/scan    HTTP ${api.status} on GET ${api.status === 405 ? '(as designed)' : '(expected 405)'}`);
  } catch (err) {
    log(`[baseline] /api/scan    unreachable: ${err?.message ?? err}`);
  }
  const verdict = compareBaseline(read.sha, args.expect);
  if (args.expect) log(`[baseline] expected     ${args.expect}  →  ${verdict.toUpperCase()}`);
  log(`[baseline] result       ${verdict === 'mismatch' ? 'MISMATCH: Production is not on the expected baseline' : (commit.known ? 'VERIFIED' : 'READ, commit unknown here')}`);
  return verdict === 'mismatch' ? 1 : (commit.known ? 0 : 2);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(`[baseline] ${err?.message ?? err}`); process.exitCode = 2; });
}
