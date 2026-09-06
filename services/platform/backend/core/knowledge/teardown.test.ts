// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeKnowledgePools, setPoolFactory } from './pool';
import { purgeCorpusForOrg } from './teardown';

/**
 * The corpus is keyed by `org_slug`, so this purge is what makes a deleted
 * organization's slug safe to hand to a new tenant. Proven against a
 * recording pool: every statement runs inside ONE transaction and is bound
 * to the slug (or to the domains that slug held), the website rows are
 * locked before the "nobody else holds it" test, and a domain another
 * organization still holds is left alone. The SQL itself is exercised
 * against real Postgres in `backend/integration-check.ts`
 * (`checkOrganizationLifecycle`).
 */

const DEFAULT_URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';

interface Recorded {
  text: string;
  params: unknown[];
  inTx: boolean;
}

type Answer = { rows?: unknown[]; count?: number };

function recorder(answers: (text: string) => Answer = () => ({})): {
  sql: Sql;
  sent: Recorded[];
  begins: () => number;
} {
  const sent: Recorded[] = [];
  let begins = 0;
  const unsafeFor =
    (inTx: boolean) =>
    (text: string, params: unknown[] = []) => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      sent.push({ text: normalized, params, inTx });
      const { rows = [], count = 0 } = answers(normalized);
      return Promise.resolve(Object.assign([...rows], { count }));
    };
  const sql = {
    unsafe: unsafeFor(false),
    begin: (
      callback: (tx: { unsafe: ReturnType<typeof unsafeFor> }) => unknown,
    ) => {
      begins += 1;
      return callback({ unsafe: unsafeFor(true) });
    },
    end: () => Promise.resolve(),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  } as unknown as Sql;
  return { sql, sent, begins: () => begins };
}

let configRoot: string;
let previousConfigDir: string | undefined;
let previousDatabaseUrl: string | undefined;

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-teardown-'));
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  previousDatabaseUrl = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.KNOWLEDGE_DATABASE_URL = DEFAULT_URL;
});

afterEach(async () => {
  await closeKnowledgePools();
  setPoolFactory(null);
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
  if (previousDatabaseUrl === undefined)
    delete process.env.KNOWLEDGE_DATABASE_URL;
  else process.env.KNOWLEDGE_DATABASE_URL = previousDatabaseUrl;
});

describe('purgeCorpusForOrg', () => {
  it('removes the org documents, chunks and cache in one transaction keyed by the slug', async () => {
    const { sql, sent, begins } = recorder((text) => {
      if (text.startsWith('DELETE FROM private_knowledge.chunks'))
        return { count: 5 };
      if (text.startsWith('DELETE FROM private_knowledge.documents'))
        return { count: 2 };
      return {};
    });
    setPoolFactory(() => sql);

    const purge = await purgeCorpusForOrg('acme');

    expect(purge).toEqual({
      documents: 2,
      chunks: 5,
      websiteMemberships: 0,
      websites: 0,
    });
    expect(begins()).toBe(1);
    expect(sent.every((s) => s.inTx)).toBe(true);
    expect(sent.map((s) => s.text.split(' WHERE')[0])).toEqual([
      'DELETE FROM private_knowledge.chunks',
      'DELETE FROM private_knowledge.documents',
      'DELETE FROM private_knowledge.semantic_cache',
      'SELECT domain FROM public_web.website_org_memberships',
    ]);
    // Tenant binding: every statement names the slug and nothing else.
    for (const statement of sent) {
      expect(statement.text).toContain('org_slug = $1');
      expect(statement.params).toEqual(['acme']);
    }
    // No website was held, so the domain-keyed tables were never touched.
    expect(sent.some((s) => /public_web\.websites/.test(s.text))).toBe(false);
  });

  it('releases the org website memberships and drops only the domains nobody else holds', async () => {
    const { sql, sent } = recorder((text) => {
      if (
        text.startsWith('SELECT domain FROM public_web.website_org_memberships')
      )
        return { rows: [{ domain: 'a.example' }, { domain: 'b.example' }] };
      if (text.startsWith('DELETE FROM public_web.websites'))
        return { count: 1 };
      return {};
    });
    setPoolFactory(() => sql);

    const purge = await purgeCorpusForOrg('acme');

    expect(purge.websiteMemberships).toBe(2);
    expect(purge.websites).toBe(1);
    const texts = sent.map((s) => s.text);
    const lock = texts.findIndex((t) =>
      /SELECT 1 FROM public_web\.websites WHERE domain = ANY\(\$1\) FOR UPDATE/.test(
        t,
      ),
    );
    const memberships = texts.findIndex((t) =>
      t.startsWith('DELETE FROM public_web.website_org_memberships'),
    );
    const websites = texts.findIndex((t) =>
      t.startsWith('DELETE FROM public_web.websites'),
    );
    // Lock the domain rows first (the lock a registration in flight holds
    // from its upsert to its commit), then release, then drop the orphans.
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(memberships);
    expect(memberships).toBeLessThan(websites);
    expect(sent[lock]?.params).toEqual([['a.example', 'b.example']]);
    expect(sent[memberships]?.params).toEqual(['acme']);
    // Only the domains this org held, and only when no membership remains.
    expect(sent[websites]?.params).toEqual([['a.example', 'b.example']]);
    expect(sent[websites]?.text).toMatch(
      /NOT EXISTS \( SELECT 1 FROM public_web\.website_org_memberships m WHERE m\.domain = w\.domain \)/,
    );
  });
});
