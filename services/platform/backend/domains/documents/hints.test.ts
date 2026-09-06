// @vitest-environment node

/**
 * A project document's change is ALSO a task change: the task DTO stamps
 * `hasFiles` / `folderExists` from the project's documents, and the Start
 * gate of an automation-owned task reads that stamp. Regression: an upload
 * into a task's bound folder emitted only a `document` hint, so the Files
 * zone showed the six new files while the panel beside it kept the task's
 * pre-upload DTO — "waiting for input files", Start inert — until a reload.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { emitDocumentChangeHints } from './hints.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

const tx = {} as never;

afterEach(() => {
  vi.clearAllMocks();
});

describe('emitDocumentChangeHints', () => {
  it('a project document owes the document hint AND a task hint', async () => {
    await emitDocumentChangeHints(tx, {
      orgId: 'org_1',
      entityId: 'doc-1',
      projectId: 'proj-1',
    });

    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: 'doc-1' },
      { orgId: 'org_1', entity: 'task', entityId: null },
    ]);
  });

  it('a hub document owes only the document hint', async () => {
    await emitDocumentChangeHints(tx, {
      orgId: 'org_1',
      entityId: 'doc-1',
      projectId: null,
    });

    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: 'doc-1' },
    ]);
  });
});
