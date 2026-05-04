import { describe, expect, it } from 'vitest';

import type { MutationCtx } from '../../_generated/server';
import { upsertDocumentByExternalId } from '../upsert_document_by_external_id';

interface MockDoc {
  _id: string;
  organizationId: string;
  externalItemId?: string;
  folderPath?: string;
  contentHash?: string;
  title?: string;
  fileId?: string;
}

function createMockCtx(initial: MockDoc[]) {
  const docs = new Map<string, MockDoc>();
  for (const doc of initial) docs.set(doc._id, doc);
  let counter = initial.length;
  const inserts: MockDoc[] = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: () => ({
        withIndex: (
          _idx: string,
          cb: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          let orgFilter: string | undefined;
          let externalFilter: string | undefined;
          const qb = {
            eq: (field: string, value: unknown) => {
              if (field === 'organizationId') orgFilter = value as string;
              if (field === 'externalItemId') externalFilter = value as string;
              return qb;
            },
          };
          cb(qb);
          const matched: MockDoc[] = [];
          for (const doc of docs.values()) {
            if (
              doc.organizationId === orgFilter &&
              doc.externalItemId === externalFilter
            ) {
              matched.push(doc);
            }
          }
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const m of matched) yield m;
            },
          };
        },
      }),
      insert: (_table: string, doc: Record<string, unknown>) => {
        const id = `doc_${++counter}`;
        const stored: MockDoc = {
          _id: id,
          organizationId: doc.organizationId as string,
          externalItemId: doc.externalItemId as string | undefined,
          folderPath: doc.folderPath as string | undefined,
          contentHash: doc.contentHash as string | undefined,
          title: doc.title as string | undefined,
          fileId: doc.fileId as string | undefined,
        };
        docs.set(id, stored);
        inserts.push(stored);
        return Promise.resolve(id);
      },
      patch: (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const existing = docs.get(id);
        if (existing) {
          docs.set(id, { ...existing, ...patch });
        }
        return Promise.resolve(undefined);
      },
      get: () => Promise.resolve(null),
    },
  };

  return { ctx, docs, inserts, patches };
}

const ORG = 'org1';
const PROVIDER = 'google_drive';

describe('upsertDocumentByExternalId', () => {
  it('inserts a new document when none exists', async () => {
    const { ctx, inserts } = createMockCtx([]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        sourceProvider: PROVIDER,
        contentHash: 'h1',
      },
    );
    expect(result.action).toBe('created');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].externalItemId).toBe('gd-1');
  });

  it('returns "skipped" when the existing doc has the same contentHash', async () => {
    const { ctx, inserts, patches } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('skipped');
    expect(result.documentId).toBe('d1');
    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(0);
  });

  it('updates the existing doc when contentHash differs', async () => {
    const { ctx, inserts, patches } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h2',
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('updated');
    expect(result.documentId).toBe('d1');
    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(1);
    expect(patches[0].patch.contentHash).toBe('h2');
  });

  it('finds an existing doc anywhere under the prefix subtree (cross-folder move)', async () => {
    const { ctx, patches } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync/A',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h2',
        // The doc moved from Sync/A → Sync/B inside the same sync subtree.
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('updated');
    expect(result.documentId).toBe('d1');
    expect(patches).toHaveLength(1);
  });

  it('does NOT match docs outside the prefix subtree (two independent syncs)', async () => {
    const { ctx, inserts } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'SyncA/files',
      },
    ]);
    // Second sync targets SyncB; should NOT pick up the doc in SyncA.
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderPathPrefix: 'SyncB',
      },
    );
    expect(result.action).toBe('created');
    expect(inserts).toHaveLength(1);
  });

  it('does not consider "Sync 2/x" as a child of "Sync"', async () => {
    const { ctx, inserts } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync 2/x',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderPathPrefix: 'Sync',
      },
    );
    // No match → new row inserted. The 'Sync 2/x' doc is left alone.
    expect(result.action).toBe('created');
    expect(inserts).toHaveLength(1);
  });
});
