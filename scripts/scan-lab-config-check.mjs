#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB CONFIGURATION CHECK — SHAPES, NEVER VALUES
//
//   node --env-file=<a file holding the environment to check> scripts/scan-lab-config-check.mjs
//
// Answers one question before a release: would Scan Lab run in THIS environment,
// and if not, which part is missing? It reads the same variables the endpoint
// reads, through the endpoint's own resolvers, and prints yes/no lines.
//
// IT NEVER PRINTS, LOGS OR WRITES A VALUE. Not a key, not a prefix, not a
// length, not a user id. It makes no network request and touches no file.
//
// Exit code 0 when Scan Lab would be available, 1 when it would not.
// ══════════════════════════════════════════════════════════════════════════════
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveLabMode, resolveLabStorage, isServiceRoleKey, LAB_MODE, LAB_FLAG, LAB_ALLOWLIST_ENV, LAB_SERVICE_KEY_ENV, LAB_URL_ENVS,
} from '../api/_lib/scan-lab/config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const yn = (b) => (b ? 'yes' : 'NO');

/** What kind of credential a value looks like, without revealing anything else about it. */
function shapeOf(value) {
  const k = String(value ?? '').trim();
  if (!k) return 'absent';
  if (k.startsWith('sb_secret_')) return 'service-role';
  if (k.startsWith('sb_publishable_')) return 'publishable (anon)';
  const parts = k.split('.');
  if (parts.length !== 3) return 'unrecognised';
  try {
    const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role;
    return role === 'service_role' ? 'service-role' : (role === 'anon' ? 'anon' : 'unrecognised');
  } catch { return 'unrecognised'; }
}

/** The report as lines, and whether the lab would be available. Pure: takes an environment, returns text. */
export function checkLabConfig(env = process.env) {
  const ids = String(env[LAB_ALLOWLIST_ENV] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const serviceKey = env[LAB_SERVICE_KEY_ENV];
  const mode = resolveLabMode(env);
  const lines = [
    `${LAB_FLAG} is exactly 'true':            ${yn(String(env[LAB_FLAG] ?? '').trim().toLowerCase() === 'true')}`,
    `${LAB_ALLOWLIST_ENV}: ${ids.length} id(s), all UUID-shaped: ${yn(ids.length > 0 && ids.every((i) => UUID_RE.test(i)))}${ids.length > 1 ? '   (more than one: this release is founder-only)' : ''}`,
    `project URL (${LAB_URL_ENVS.join(' or ')}) present, https:  ${yn(LAB_URL_ENVS.some((n) => /^https:\/\//.test(String(env[n] ?? ''))))}`,
    `${LAB_SERVICE_KEY_ENV} present:                 ${yn(!!String(serviceKey ?? '').trim())}`,
    `${LAB_SERVICE_KEY_ENV} shape:                   ${shapeOf(serviceKey)}`,
    `${LAB_SERVICE_KEY_ENV} accepted by Scan Lab:    ${yn(isServiceRoleKey(serviceKey, env))}`,
    `SUPABASE_KEY shape (NOT read by Scan Lab):    ${shapeOf(env.SUPABASE_KEY)}`,
    `storage resolved:                             ${yn(!!resolveLabStorage(env))}`,
    `VITE_SCAN_LAB_ENABLED is exactly 'true':      ${yn(env.VITE_SCAN_LAB_ENABLED === 'true')}   (build time: decides whether the screen is in the bundle)`,
    `Scan Lab mode in this environment:            ${mode}`,
  ];
  if (shapeOf(serviceKey) !== 'service-role' && shapeOf(env.SUPABASE_KEY) === 'service-role') {
    lines.push(`NOTE: a service-role key is present under SUPABASE_KEY but not under ${LAB_SERVICE_KEY_ENV}. Scan Lab does not fall back: add it under ${LAB_SERVICE_KEY_ENV}.`);
  }
  return { ok: mode === LAB_MODE.ENABLED && ids.length > 0, lines };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, lines } = checkLabConfig(process.env);
  process.stdout.write(`${lines.join('\n')}\n${ok ? 'RESULT: Scan Lab would be available to the listed account(s).' : 'RESULT: Scan Lab would NOT be available. It fails closed: every action is refused.'}\n`);
  process.exit(ok ? 0 : 1);
}
