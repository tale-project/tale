import { getFunctionName } from 'convex/server';
import { describe, expect, it } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';
import { documentAction } from './document_action';

// Regression guard for the fileMetadata <- document back-fill. Connector-sync
// flows store the blob (source 'agent', no documentId) in an earlier step, then
// create the document here. Without linkDocumentToFile the row stays orphaned
// (documentId undefined) and the retention sweep can hard-delete it as an agent
// temp file. These tests assert the create op links the blob on BOTH branches.
//
// Convex's generated `internal` api is a proxy that returns a fresh reference on
// every access, so dispatch/assert by getFunctionName(), not `===`.

interface RunMutationCall {
  name: string;
  args: Record<string, unknown>;
}

interface RunQueryCall {
  name: string;
  args: Record<string, unknown>;
}

function createMockCtx(options?: {
  folderOrgById?: Record<string, string | null>;
}) {
  const runMutationCalls: RunMutationCall[] = [];
  const runQueryCalls: RunQueryCall[] = [];
  const folderOrgById = options?.folderOrgById ?? {};
  const ctx = {
    runQuery: (
      fn: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      const name = getFunctionName(fn);
      runQueryCalls.push({ name, args });
      if (name.includes('getByStorageId')) {
        return Promise.resolve({
          fileName: 'Overview.txt',
          contentType: 'text/plain',
          size: 915,
        });
      }
      if (name.includes('getFolderOrganizationId')) {
        const folderId = String(args.folderId);
        return Promise.resolve(
          Object.prototype.hasOwnProperty.call(folderOrgById, folderId)
            ? folderOrgById[folderId]
            : null,
        );
      }
      return Promise.resolve(null);
    },
    runMutation: (
      fn: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      const name = getFunctionName(fn);
      runMutationCalls.push({ name, args });
      if (name.includes('upsertDocumentByExternalId')) {
        return Promise.resolve({
          documentId: 'doc_synced',
          action: 'created',
          contentChanged: true,
        });
      }
      if (name.includes('createDocument')) {
        return Promise.resolve('doc_adhoc');
      }
      if (name.includes('getOrCreateFolderPath')) {
        return Promise.resolve('folder_from_path');
      }
      return Promise.resolve(null);
    },
  };
  return { ctx, runMutationCalls, runQueryCalls };
}

function linkCall(calls: RunMutationCall[]): RunMutationCall | undefined {
  return calls.find((c) => c.name.includes('linkDocumentToFile'));
}

describe('documentAction create — fileMetadata back-fill', () => {
  it('links fileMetadata.documentId after a sync upsert (externalItemId present)', async () => {
    const { ctx, runMutationCalls } = createMockCtx();

    await documentAction.execute(
      ctx as unknown as ActionCtx,
      {
        operation: 'create',
        fileId: 'stor_sync',
        externalItemId: '163939',
        title: 'Overview',
        sourceProvider: 'confluence',
        contentHash: '1',
      },
      { organizationId: 'org_1', userId: 'user_1' },
    );

    const link = linkCall(runMutationCalls);
    expect(link).toBeDefined();
    expect(link?.args).toEqual({
      storageId: 'stor_sync',
      documentId: 'doc_synced',
    });

    // extension is derived from the stored blob's filename ('Overview.txt'),
    // since sync titles are kept clean — and passed to the upsert.
    const upsert = runMutationCalls.find((c) =>
      c.name.includes('upsertDocumentByExternalId'),
    );
    expect(upsert?.args.extension).toBe('txt');
  });

  it('links fileMetadata.documentId after an ad-hoc create (no externalItemId)', async () => {
    const { ctx, runMutationCalls } = createMockCtx();

    await documentAction.execute(
      ctx as unknown as ActionCtx,
      {
        operation: 'create',
        fileId: 'stor_adhoc',
        title: 'Scratch',
        sourceProvider: 'agent',
      },
      { organizationId: 'org_1', userId: 'user_1' },
    );

    const link = linkCall(runMutationCalls);
    expect(link).toBeDefined();
    expect(link?.args).toEqual({
      storageId: 'stor_adhoc',
      documentId: 'doc_adhoc',
    });

    const create = runMutationCalls.find((c) =>
      c.name.includes('createDocument'),
    );
    expect(create?.args.extension).toBe('txt');
  });
});

describe('documentAction create — folderId', () => {
  it('uses folderId directly and skips getOrCreateFolderPath', async () => {
    const { ctx, runMutationCalls } = createMockCtx({
      folderOrgById: { folder_project_q1: 'org_1' },
    });

    await documentAction.execute(
      ctx as unknown as ActionCtx,
      {
        operation: 'create',
        fileId: 'stor_adhoc',
        title: 'Scratch',
        folderId: 'folder_project_q1',
        folderPath: 'Should/Be/Ignored',
        sourceProvider: 'agent',
      },
      { organizationId: 'org_1', userId: 'user_1' },
    );

    expect(
      runMutationCalls.some((c) => c.name.includes('getOrCreateFolderPath')),
    ).toBe(false);

    const create = runMutationCalls.find((c) =>
      c.name.includes('createDocument'),
    );
    expect(create?.args.folderId).toBe('folder_project_q1');
  });

  it('rejects folderId from another organization', async () => {
    const { ctx, runMutationCalls } = createMockCtx({
      folderOrgById: { folder_other: 'org_other' },
    });

    await expect(
      documentAction.execute(
        ctx as unknown as ActionCtx,
        {
          operation: 'create',
          fileId: 'stor_adhoc',
          title: 'Scratch',
          folderId: 'folder_other',
          sourceProvider: 'agent',
        },
        { organizationId: 'org_1', userId: 'user_1' },
      ),
    ).rejects.toThrow(/not found in organization/);

    expect(
      runMutationCalls.some((c) => c.name.includes('createDocument')),
    ).toBe(false);
  });

  it('falls back to folderPath hub create when folderId is omitted', async () => {
    const { ctx, runMutationCalls } = createMockCtx();

    await documentAction.execute(
      ctx as unknown as ActionCtx,
      {
        operation: 'create',
        fileId: 'stor_adhoc',
        title: 'Scratch',
        folderPath: 'Clients/Acme',
        sourceProvider: 'agent',
      },
      { organizationId: 'org_1', userId: 'user_1' },
    );

    const pathCall = runMutationCalls.find((c) =>
      c.name.includes('getOrCreateFolderPath'),
    );
    expect(pathCall?.args.pathSegments).toEqual(['Clients', 'Acme']);

    const create = runMutationCalls.find((c) =>
      c.name.includes('createDocument'),
    );
    expect(create?.args.folderId).toBe('folder_from_path');
  });
});
