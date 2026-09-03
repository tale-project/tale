import type { CacheItem, CacheProvider } from '@node-saml/node-saml';
import type { Sql } from 'postgres';

/**
 * PG-backed node-saml CacheProvider over `app.saml_request_ids` — the store
 * of AuthnRequest IDs this deployment issued, consulted (and consumed) when a
 * SAMLResponse carries an InResponseTo. The library's default provider is
 * in-memory and per-process; api + worker containers (or scaled replicas)
 * must share the store or a response landing on a different instance than
 * the one that built the request would always be refused.
 *
 * Semantics mirror node-saml's InMemoryCacheProvider: `saveAsync` is
 * insert-if-absent (null when the key already exists), `getAsync` answers
 * null for unknown or expired keys, `removeAsync` is the one-time-use
 * consumption — atomic here (DELETE .. RETURNING), so a replayed response
 * cannot find the ID again. Expiry is the library's 8-hour
 * requestIdExpirationPeriodMs default; expired rows are pruned lazily on the
 * next save (indexed by created_at_ms), never by a cron.
 */

const REQUEST_ID_EXPIRATION_MS = 8 * 60 * 60 * 1000;

export function createSamlRequestCache(sql: Sql): CacheProvider {
  const expiryCutoff = (): number => Date.now() - REQUEST_ID_EXPIRATION_MS;
  return {
    async saveAsync(key: string, value: string): Promise<CacheItem | null> {
      await sql`
        DELETE FROM app.saml_request_ids WHERE created_at_ms < ${expiryCutoff()}
      `;
      const now = Date.now();
      const inserted = await sql<{ value: string }[]>`
        INSERT INTO app.saml_request_ids (id, value, created_at_ms)
        VALUES (${key}, ${value}, ${now})
        ON CONFLICT (id) DO NOTHING
        RETURNING value
      `;
      const row = inserted[0];
      return row === undefined ? null : { value: row.value, createdAt: now };
    },

    async getAsync(key: string): Promise<string | null> {
      const rows = await sql<{ value: string }[]>`
        SELECT value FROM app.saml_request_ids
        WHERE id = ${key} AND created_at_ms >= ${expiryCutoff()}
        LIMIT 1
      `;
      return rows[0]?.value ?? null;
    },

    async removeAsync(key: string | null): Promise<string | null> {
      if (key === null) return null;
      const rows = await sql<{ id: string }[]>`
        DELETE FROM app.saml_request_ids WHERE id = ${key} RETURNING id
      `;
      return rows[0] === undefined ? null : key;
    },
  };
}
