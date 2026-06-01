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

function createMockCtx() {
  const runMutationCalls: RunMutationCall[] = [];
  const ctx = {
    runQuery: (fn: Parameters<typeof getFunctionName>[0]) => {
      if (getFunctionName(fn).includes('getByStorageId')) {
        return Promise.resolve({
          fileName: 'Overview.txt',
          contentType: 'text/plain',
          size: 915,
        });
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
      return Promise.resolve(null);
    },
  };
  return { ctx, runMutationCalls };
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
  });
});
