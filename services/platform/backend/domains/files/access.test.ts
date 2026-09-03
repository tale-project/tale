// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  decideFileRead,
  type FileAccessProbes,
  type FileBindingFields,
  type FileViewer,
} from './access.ts';

const viewer: FileViewer = {
  organizationId: 'org-a',
  userId: 'user-reader',
  role: 'member',
  teamIds: [],
};

function row(overrides: Partial<FileBindingFields> = {}): FileBindingFields {
  return {
    organizationId: 'org-a',
    storageRef: 's3:tale/org-a/blob-1',
    uploadedBy: 'user-uploader',
    documentId: null,
    threadId: null,
    conversationId: null,
    ...overrides,
  };
}

/** Probes answering fixed verdicts, recording which were consulted. */
function probes(
  verdicts: Partial<Record<keyof FileAccessProbes, boolean>> = {},
): FileAccessProbes & { calls: string[] } {
  const calls: string[] = [];
  const answer =
    (name: keyof FileAccessProbes) => async (): Promise<boolean> => {
      calls.push(name);
      return verdicts[name] ?? false;
    };
  return {
    calls,
    documentReadable: answer('documentReadable'),
    threadReadable: answer('threadReadable'),
    conversationReadable: answer('conversationReadable'),
    taskReadable: answer('taskReadable'),
  };
}

describe('decideFileRead — the files domain read gate', () => {
  it('denies a row from another organization, even to its uploader', async () => {
    const p = probes({
      documentReadable: true,
      threadReadable: true,
      taskReadable: true,
    });
    await expect(
      decideFileRead(
        viewer,
        row({ organizationId: 'org-b', uploadedBy: viewer.userId }),
        p,
      ),
    ).resolves.toBe(false);
    expect(p.calls).toEqual([]);
  });

  it('lets the uploader read their own (still unbound) upload without consulting any parent', async () => {
    const p = probes();
    await expect(
      decideFileRead(viewer, row({ uploadedBy: viewer.userId }), p),
    ).resolves.toBe(true);
    expect(p.calls).toEqual([]);
  });

  it('denies a bare ref: an unbound row someone else uploaded grants nothing', async () => {
    const p = probes();
    await expect(decideFileRead(viewer, row(), p)).resolves.toBe(false);
    // Only the task binding is a possible grant for an unbound row.
    expect(p.calls).toEqual(['taskReadable']);
  });

  it('answers a document-bound row with the document ACL alone', async () => {
    const granted = probes({ documentReadable: true, threadReadable: true });
    await expect(
      decideFileRead(
        viewer,
        row({ documentId: 'doc-1', threadId: 'thread-1' }),
        granted,
      ),
    ).resolves.toBe(true);
    expect(granted.calls).toEqual(['documentReadable']);

    // A thread or task naming the same blob must not widen the document's
    // audience.
    const refused = probes({
      documentReadable: false,
      threadReadable: true,
      taskReadable: true,
    });
    await expect(
      decideFileRead(
        viewer,
        row({ documentId: 'doc-1', threadId: 'thread-1' }),
        refused,
      ),
    ).resolves.toBe(false);
    expect(refused.calls).toEqual(['documentReadable']);
  });

  it('grants a thread-bound row through the thread, else falls through to the other bindings', async () => {
    const viaThread = probes({ threadReadable: true });
    await expect(
      decideFileRead(viewer, row({ threadId: 'thread-1' }), viaThread),
    ).resolves.toBe(true);
    expect(viaThread.calls).toEqual(['threadReadable']);

    const viaTask = probes({ threadReadable: false, taskReadable: true });
    await expect(
      decideFileRead(viewer, row({ threadId: 'thread-1' }), viaTask),
    ).resolves.toBe(true);
    expect(viaTask.calls).toEqual(['threadReadable', 'taskReadable']);
  });

  it('grants a conversation-bound mail attachment through the inbox predicate', async () => {
    const p = probes({ conversationReadable: true });
    await expect(
      decideFileRead(viewer, row({ conversationId: 'conv-1' }), p),
    ).resolves.toBe(true);
    expect(p.calls).toEqual(['conversationReadable']);
  });

  it('grants a task deliverable to a reader of a task that lists it', async () => {
    const p = probes({ taskReadable: true });
    await expect(
      decideFileRead(viewer, row({ uploadedBy: null }), p),
    ).resolves.toBe(true);
    expect(p.calls).toEqual(['taskReadable']);
  });

  it('propagates a probe failure instead of failing open', async () => {
    const p = probes();
    p.taskReadable = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(decideFileRead(viewer, row(), p)).rejects.toThrow('db down');
  });
});
