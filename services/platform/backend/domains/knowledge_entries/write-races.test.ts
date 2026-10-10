import { randomUUID } from 'node:crypto';

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, string>() }));

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued: vi.fn() }));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('race-fixture'),
}));
vi.mock('../../lib/object-store.ts', () => ({
  resolveObjectStore: vi.fn().mockResolvedValue({ bucket: 'fixture' }),
  buildObjectKey: () => randomUUID(),
  s3PresignPutUrl: (_store: unknown, key: string) =>
    Promise.resolve(`https://store.test/${key}`),
}));

const {
  checkAgentWriteBudget,
  checkConcurrentAgentAndPersonEdits,
  checkConcurrentAgentCreates,
  checkConcurrentEntryCreation,
  checkConcurrentEntryUpdates,
  checkConcurrentEntryRenameAndCreate,
} = await import('./write-races.integration.ts');

const databaseUrl = process.env.TALE_KNOWLEDGE_RACE_DATABASE_URL;

describe.skipIf(!databaseUrl)(
  'knowledge entry writes against real PostgreSQL',
  () => {
    let sql: Sql;
    const writer = {
      organizationId: `race-${randomUUID()}`,
      userId: 'race-writer',
      role: 'admin',
    };

    beforeAll(() => {
      if (!databaseUrl) throw new Error('missing real PostgreSQL fixture URL');
      sql = postgres(databaseUrl, {
        max: 4,
        connection: { application_name: 'tale147-write-races' },
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const key = url.split('/').at(-1);
        if (!key || !(init?.body instanceof Uint8Array))
          throw new Error('unexpected blob upload');
        blobs.set(`s3:${key}`, new TextDecoder().decode(init.body));
        return new Response(null, { status: 200 });
      });
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await sql`DELETE FROM app.knowledge_entries WHERE org_id = ${writer.organizationId}`;
      await sql`DELETE FROM app.audit_logs WHERE org_id = ${writer.organizationId}`;
      await sql`DELETE FROM app.audit_chain_heads WHERE org_id = ${writer.organizationId}`;
      await sql`DELETE FROM app.file_metadata WHERE org_id = ${writer.organizationId}`;
      await sql`DELETE FROM app.documents WHERE org_id = ${writer.organizationId}`;
      await sql.end();
    });

    const readBlob = (ref: string): Promise<string> => {
      const content = blobs.get(ref);
      if (content === undefined) throw new Error(`missing fixture blob ${ref}`);
      return Promise.resolve(content);
    };

    it('arbitrates normalized same-topic creates before materializing documents', async () => {
      await checkConcurrentEntryCreation(sql, writer);
    });

    it('refuses stale concurrent corrections and retains coherent history and bytes', async () => {
      await checkConcurrentEntryUpdates(sql, writer, readBlob);
    });

    it('refuses stale concurrent renames even when their destination topics differ', async () => {
      await checkConcurrentEntryUpdates(sql, writer, readBlob, true);
    });

    it('arbitrates a rename against a create at the same destination topic', async () => {
      await checkConcurrentEntryRenameAndCreate(sql, writer);
    });

    it('lets one of two agents creating a topic at once win, refusing the other with its text [KENTRY-R10]', async () => {
      await checkConcurrentAgentCreates(sql, writer);
    });

    it('refuses whichever of an agent and a person edits a fact second [KENTRY-R12]', async () => {
      await checkConcurrentAgentAndPersonEdits(sql, writer);
    });

    it('answers a spent agent budget with a wait, leaving people’s budget alone [KENTRY-R13]', async () => {
      await checkAgentWriteBudget(sql, writer);
    });
  },
);
