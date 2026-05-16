import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateThread = vi.fn();
const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../_generated/api', () => ({
  components: { agent: { threads: { getThread: 'getThread' } } },
}));

vi.mock('../_generated/server', () => ({
  internalMutation: ({ handler }: { handler: Function }) => handler,
}));

const mockGetThreadMessages = vi.fn();
vi.mock('./get_thread_messages', () => ({
  getThreadMessages: (...args: unknown[]) => mockGetThreadMessages(...args),
}));

const { createBranchThread: createBranchThreadMutation } =
  await import('./create_branch_thread');
const createBranchThread = createBranchThreadMutation as unknown as (
  ctx: unknown,
  args: {
    userId: string;
    organizationId: string;
    sourceThreadId: string;
    rootThreadId: string;
    editedMessageId: string;
    editedMessageOrder: number;
    newMessage: string;
  },
) => Promise<{ branchThreadId: string; forkOrder: number }>;

interface ArtifactRow {
  _id: string;
  organizationId: string;
  threadId: string;
  type: 'code';
  title: string;
  content: string;
  revision: number;
  createdByMessageId: string;
  lastEditedByMessageId?: string;
  createdAt: number;
  updatedAt: number;
}
interface RevisionRow {
  _id: string;
  artifactId: string;
  revision: number;
  content: string;
  editedByMessageId?: string;
  editKind: 'create' | 'patch' | 'rewrite' | 'user' | 'branch';
  createdAt: number;
}

interface Inserted {
  artifacts: Array<Record<string, unknown>>;
  artifactRevisions: Array<Record<string, unknown>>;
  threadMetadata: Array<Record<string, unknown>>;
  threadBranches: Array<Record<string, unknown>>;
}

function makeCtx({
  parentArtifacts,
  parentRevisions,
  sourceMetadata = {
    _id: 'meta_T1',
    threadId: 'T1',
    userId: 'user_1',
    chatType: 'standard',
    title: 'Parent',
  },
}: {
  parentArtifacts: ArtifactRow[];
  parentRevisions: RevisionRow[];
  sourceMetadata?: Record<string, unknown> | null;
}) {
  const inserted: Inserted = {
    artifacts: [],
    artifactRevisions: [],
    threadMetadata: [],
    threadBranches: [],
  };
  let nextId = 1;
  const insert = vi.fn(
    async (table: string, doc: Record<string, unknown>): Promise<string> => {
      const id = `${table}_${nextId++}`;
      const row = { _id: id, ...doc };
      if (table === 'artifacts') inserted.artifacts.push(row);
      else if (table === 'artifactRevisions')
        inserted.artifactRevisions.push(row);
      else if (table === 'threadMetadata') inserted.threadMetadata.push(row);
      else if (table === 'threadBranches') inserted.threadBranches.push(row);
      return id;
    },
  );

  const queryFn = (table: string) => {
    if (table === 'threadMetadata') {
      return {
        withIndex: () => ({
          first: vi.fn().mockResolvedValue(sourceMetadata),
        }),
      };
    }
    if (table === 'threadBranches') {
      // Async iterable returning zero existing branches
      return {
        withIndex: () => ({
          [Symbol.asyncIterator]: async function* () {
            // empty
          },
        }),
      };
    }
    if (table === 'artifacts') {
      return {
        withIndex: () => ({
          collect: vi.fn().mockResolvedValue(parentArtifacts),
        }),
      };
    }
    if (table === 'artifactRevisions') {
      return {
        withIndex: (_name: string, cb: (q: unknown) => unknown) => {
          // Convex's withIndex signature is (indexName, callback).
          // Capture which artifactId the caller filtered on by running the
          // callback against a recording proxy.
          let capturedArtifactId: string | undefined;
          cb({
            eq: (_field: string, value: string) => {
              capturedArtifactId = value;
              return {};
            },
          });
          return {
            order: () => ({
              [Symbol.asyncIterator]: async function* () {
                const rows = parentRevisions.filter(
                  (r) => r.artifactId === capturedArtifactId,
                );
                for (const r of rows) yield r;
              },
            }),
          };
        },
      };
    }
    return {
      withIndex: () => ({
        first: vi.fn().mockResolvedValue(null),
      }),
    };
  };

  return {
    inserted,
    ctx: {
      db: {
        query: (table: string) => queryFn(table),
        insert,
      },
      runQuery: vi.fn().mockResolvedValue({ _creationTime: 100 }),
    },
  };
}

const PARENT_MESSAGES = [
  { _id: 'M1', _creationTime: 100, role: 'user', content: 'hi' },
  { _id: 'M2', _creationTime: 200, role: 'assistant', content: 'hello' },
  { _id: 'M3', _creationTime: 300, role: 'user', content: 'edit me' },
  { _id: 'M4', _creationTime: 400, role: 'assistant', content: 'reply' },
];
const FORK_AT = 'M3';

describe('createBranchThread — artifact snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateThread.mockResolvedValue('T2');
    let i = 0;
    mockSaveMessage.mockImplementation(() => {
      i += 1;
      return Promise.resolve({
        messageId: `branch_msg_${i}`,
        message: { order: i },
      });
    });
    mockGetThreadMessages.mockResolvedValue({ messages: PARENT_MESSAGES });
  });

  it('clones an in-scope artifact with mapped createdBy / lastEditedBy', async () => {
    const artifact: ArtifactRow = {
      _id: 'A1',
      organizationId: 'org_1',
      threadId: 'T1',
      type: 'code',
      title: 'Hello',
      content: 'rev2 content',
      revision: 2,
      createdByMessageId: 'M2',
      lastEditedByMessageId: 'M2',
      createdAt: 200,
      updatedAt: 250,
    };
    const revisions: RevisionRow[] = [
      {
        _id: 'r1',
        artifactId: 'A1',
        revision: 1,
        content: 'rev1 content',
        editedByMessageId: 'M2',
        editKind: 'create',
        createdAt: 200,
      },
      {
        _id: 'r2',
        artifactId: 'A1',
        revision: 2,
        content: 'rev2 content',
        editedByMessageId: 'M2',
        editKind: 'patch',
        createdAt: 250,
      },
    ];

    const { ctx, inserted } = makeCtx({
      parentArtifacts: [artifact],
      parentRevisions: revisions,
    });

    await createBranchThread(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      sourceThreadId: 'T1',
      rootThreadId: 'T1',
      editedMessageId: FORK_AT,
      editedMessageOrder: 3,
      newMessage: 'edited prompt',
    });

    expect(inserted.artifacts).toHaveLength(1);
    const cloned = inserted.artifacts[0];
    expect(cloned).toMatchObject({
      organizationId: 'org_1',
      threadId: 'T2',
      type: 'code',
      title: 'Hello',
      content: 'rev2 content',
      revision: 2,
      // saveMessage was called for M1 → branch_msg_1, M2 → branch_msg_2,
      // then the edited M3 → branch_msg_3.
      createdByMessageId: 'branch_msg_2',
      lastEditedByMessageId: 'branch_msg_2',
    });
    // Streaming fields must not be carried over.
    expect(cloned.streamingContent).toBeUndefined();
    expect(cloned.streamingPatches).toBeUndefined();
    expect(cloned.liveStreamMode).toBeUndefined();

    // One revision row written with editKind 'branch' at the snapshot revision.
    expect(inserted.artifactRevisions).toHaveLength(1);
    expect(inserted.artifactRevisions[0]).toMatchObject({
      revision: 2,
      content: 'rev2 content',
      editKind: 'branch',
      editedByMessageId: 'branch_msg_2',
    });
  });

  it('skips an out-of-scope artifact (createdByMessageId not in copied range)', async () => {
    const artifact: ArtifactRow = {
      _id: 'A2',
      organizationId: 'org_1',
      threadId: 'T1',
      type: 'code',
      title: 'Out',
      content: 'late',
      revision: 1,
      createdByMessageId: 'M4', // post-fork (M4 happens after FORK_AT=M3)
      createdAt: 400,
      updatedAt: 400,
    };

    const { ctx, inserted } = makeCtx({
      parentArtifacts: [artifact],
      parentRevisions: [
        {
          _id: 'r1',
          artifactId: 'A2',
          revision: 1,
          content: 'late',
          editedByMessageId: 'M4',
          editKind: 'create',
          createdAt: 400,
        },
      ],
    });

    await createBranchThread(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      sourceThreadId: 'T1',
      rootThreadId: 'T1',
      editedMessageId: FORK_AT,
      editedMessageOrder: 3,
      newMessage: 'edited',
    });

    expect(inserted.artifacts).toHaveLength(0);
    expect(inserted.artifactRevisions).toHaveLength(0);
  });

  it('snapshots at the latest in-scope revision when later edits are out of scope', async () => {
    const artifact: ArtifactRow = {
      _id: 'A1',
      organizationId: 'org_1',
      threadId: 'T1',
      type: 'code',
      title: 'Hello',
      // The artifact's *current* state reflects rev3 — but rev3 was edited by
      // M4, which is post-fork. The branch should NOT see rev3's content.
      content: 'rev3 content',
      revision: 3,
      createdByMessageId: 'M2',
      lastEditedByMessageId: 'M4',
      createdAt: 200,
      updatedAt: 400,
    };
    const revisions: RevisionRow[] = [
      {
        _id: 'r1',
        artifactId: 'A1',
        revision: 1,
        content: 'rev1 content',
        editedByMessageId: 'M2',
        editKind: 'create',
        createdAt: 200,
      },
      {
        _id: 'r2',
        artifactId: 'A1',
        revision: 2,
        content: 'rev2 content',
        editedByMessageId: 'M2',
        editKind: 'patch',
        createdAt: 250,
      },
      {
        _id: 'r3',
        artifactId: 'A1',
        revision: 3,
        content: 'rev3 content',
        editedByMessageId: 'M4',
        editKind: 'patch',
        createdAt: 400,
      },
    ];

    const { ctx, inserted } = makeCtx({
      parentArtifacts: [artifact],
      parentRevisions: revisions,
    });

    await createBranchThread(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      sourceThreadId: 'T1',
      rootThreadId: 'T1',
      editedMessageId: FORK_AT,
      editedMessageOrder: 3,
      newMessage: 'edited',
    });

    expect(inserted.artifacts).toHaveLength(1);
    expect(inserted.artifacts[0]).toMatchObject({
      content: 'rev2 content',
      revision: 2,
      lastEditedByMessageId: 'branch_msg_2',
    });
    expect(inserted.artifactRevisions[0]).toMatchObject({
      revision: 2,
      content: 'rev2 content',
      editKind: 'branch',
    });
  });

  it('treats user-kind revisions (no messageId) as in-scope by revision-order monotonicity', async () => {
    const artifact: ArtifactRow = {
      _id: 'A1',
      organizationId: 'org_1',
      threadId: 'T1',
      type: 'code',
      title: 'Hello',
      content: 'rev2 content',
      revision: 2,
      createdByMessageId: 'M2',
      createdAt: 200,
      updatedAt: 220,
    };
    const revisions: RevisionRow[] = [
      {
        _id: 'r1',
        artifactId: 'A1',
        revision: 1,
        content: 'rev1 content',
        editedByMessageId: 'M2',
        editKind: 'create',
        createdAt: 200,
      },
      {
        // User edited via Canvas pane after M2 — no messageId attribution.
        _id: 'r2',
        artifactId: 'A1',
        revision: 2,
        content: 'rev2 content',
        editKind: 'user',
        createdAt: 220,
      },
    ];

    const { ctx, inserted } = makeCtx({
      parentArtifacts: [artifact],
      parentRevisions: revisions,
    });

    await createBranchThread(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      sourceThreadId: 'T1',
      rootThreadId: 'T1',
      editedMessageId: FORK_AT,
      editedMessageOrder: 3,
      newMessage: 'edited',
    });

    expect(inserted.artifacts).toHaveLength(1);
    expect(inserted.artifacts[0]).toMatchObject({
      content: 'rev2 content',
      revision: 2,
      // No mappable lastEditedByMessageId because rev2 was a user edit.
      lastEditedByMessageId: undefined,
    });
  });

  it('produces no clone when the parent has no artifacts', async () => {
    const { ctx, inserted } = makeCtx({
      parentArtifacts: [],
      parentRevisions: [],
    });

    await createBranchThread(ctx, {
      userId: 'user_1',
      organizationId: 'org_1',
      sourceThreadId: 'T1',
      rootThreadId: 'T1',
      editedMessageId: FORK_AT,
      editedMessageOrder: 3,
      newMessage: 'edited',
    });

    expect(inserted.artifacts).toHaveLength(0);
    expect(inserted.artifactRevisions).toHaveLength(0);
    // But messages were still copied (M1, M2 + edited M3).
    expect(mockSaveMessage).toHaveBeenCalledTimes(3);
  });
});
