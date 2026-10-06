// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — THE STORE (the only module that reaches storage)
//
// One private bucket and one table, both reached with the service-role key and
// with nothing else. Neither carries a policy for `anon` or `authenticated`, so
// a browser holding a user's session can read and write NOTHING here directly:
//
//   upload    a one-object token this server signs after it has authorized the
//             account; the bytes go from the phone to storage, never through a
//             function (a function refuses a body over 4.5 MB)
//   download  this server, or a link it signs for 60 seconds
//   metadata  this server only
//
// Every method takes the owner id, and the owner id is always the verified
// session subject. It is never read from a request body.
//
// The local pull script uses this same store from the benchmark machine.
// Nothing under api/v2, api/_lib/v2 or the V1 scan imports it.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { LAB_BUCKET, LAB_TABLE } from './config.js';
import { LabError } from './truth.js';

const KEY = 'owner_id,set_name,item_id';
const clip = (v) => String(v?.message ?? v ?? '').slice(0, 160);

export function createLabStore({ url, serviceKey, fetchImpl = null }) {
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
  const table = () => client.from(LAB_TABLE);
  const bucket = () => client.storage.from(LAB_BUCKET);
  const failed = (what, error) => new LabError(502, 'storage_failed', `${what}: ${clip(error)}`);
  const one = (q, ownerId, setName, itemId) => q.eq('owner_id', ownerId).eq('set_name', setName).eq('item_id', itemId);

  return {
    async listItems(ownerId, setName) {
      const { data, error } = await table().select('*').eq('owner_id', ownerId).eq('set_name', setName);
      if (error) throw failed('list', error);
      return data ?? [];
    },
    async getItem(ownerId, setName, itemId) {
      const { data, error } = await one(table().select('*'), ownerId, setName, itemId).maybeSingle();
      if (error) throw failed('read', error);
      return data ?? null;
    },
    /** Write the given columns of one row; the others keep their value. */
    async putItem(ownerId, setName, itemId, patch) {
      const row = { owner_id: ownerId, set_name: setName, item_id: itemId, ...patch, updated_at: new Date().toISOString() };
      const { data, error } = await table().upsert(row, { onConflict: KEY }).select('*').single();
      if (error) throw failed('write', error);
      return data;
    },
    /**
     * Write the given columns ONLY while the row still expects `captureId`.
     * Resolves to the row, or to null when another request moved it on: the
     * caller's read is stale and nothing was written.
     */
    async putItemIfPending(ownerId, setName, itemId, captureId, patch) {
      const { data, error } = await one(table().update({ ...patch, updated_at: new Date().toISOString() }), ownerId, setName, itemId)
        .eq('pending->>capture_id', captureId).select('*');
      if (error) throw failed('write', error);
      return data?.[0] ?? null;
    },
    async deleteItem(ownerId, setName, itemId) {
      const { error } = await one(table().delete(), ownerId, setName, itemId);
      if (error) throw failed('delete', error);
    },
    /** A token that lets its holder upload exactly one new object at `path`. */
    async signUpload(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data?.token) throw failed('sign upload', error ?? 'no token');
      return { path, token: data.token };
    },
    /**
     * The object's bytes, or null when it is NOT THERE (yet). A storage fault is
     * thrown instead: "could not be read" must never be mistaken for "was never
     * uploaded", or a healthy upload is thrown away and sent again.
     */
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        const status = Number(error.status) || 0;
        if (status >= 400 && status < 500) return null;
        throw failed('download', error);
      }
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    },
    /** Every object path under a prefix (item / capture / file: three levels at most). */
    async listPaths(prefix) {
      const out = [];
      const walk = async (dir, depth) => {
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await bucket().list(dir, { limit: 100, offset });
          if (error) throw failed('list objects', error);
          for (const entry of data ?? []) {
            if (entry.id) out.push(`${dir}/${entry.name}`);
            else if (depth < 3) await walk(`${dir}/${entry.name}`, depth + 1);
          }
          if ((data ?? []).length < 100) break;
        }
      };
      await walk(prefix.replace(/\/+$/, ''), 0);
      return out;
    },
    async signDownload(path, seconds) {
      const { data, error } = await bucket().createSignedUrl(path, seconds);
      if (error || !data?.signedUrl) throw failed('sign download', error ?? 'no link');
      return data.signedUrl;
    },
    async removeObjects(paths) {
      if (!paths.length) return;
      const { error } = await bucket().remove(paths);
      if (error) throw failed('remove', error);
    },
  };
}
