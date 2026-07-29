import { beforeEach, describe, expect, it, vi } from 'vitest';

// Export the raw handlers so we can drive them with a mocked ctx (same pattern
// as thread_files/queries.test.ts).
vi.mock('../_generated/server', () => ({
  query: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockCanAccessThread = vi.fn();
vi.mock('../lib/rls/auth/can_access_thread', () => ({
  canAccessThread: (...args: unknown[]) => mockCanAccessThread(...args),
}));

const {
  getPendingConnectorApprovalsForThread,
  getWorkflowCreationApprovalsForThread,
  getHumanInputRequestsForThread,
} = await import('./queries');

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

const getConnector =
  getPendingConnectorApprovalsForThread as unknown as Handler;
const getWorkflow = getWorkflowCreationApprovalsForThread as unknown as Handler;
const getHumanInput = getHumanInputRequestsForThread as unknown as Handler;

type Row = Record<string, unknown>;

/** In-memory ctx.db: withIndex → asyncIterator, filtering by the eq() calls. */
function makeCtx(approvals: Row[]) {
  const applyIndex = (cb?: (q: unknown) => unknown): Row[] => {
    if (!cb) return [...approvals];
    const eqs: Array<[string, unknown]> = [];
    const q = {
      eq(field: string, value: unknown) {
        eqs.push([field, value]);
        return q;
      },
    };
    cb(q);
    return approvals.filter((r) => eqs.every(([f, v]) => r[f] === v));
  };
  return {
    db: {
      query: () => ({
        withIndex: (_name: string, cb?: (q: unknown) => unknown) => {
          const rows = applyIndex(cb);
          return {
            [Symbol.asyncIterator]: async function* () {
              yield* rows;
            },
          };
        },
      }),
    },
  };
}

function approvalRow(over: Partial<Row> = {}): Row {
  return {
    _id: 'apr_1',
    threadId: 'thread_1',
    organizationId: 'org_1',
    resourceType: 'connector_operation',
    status: 'pending',
    messageId: undefined,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUserIdentity.mockResolvedValue({ userId: 'u_1' });
  // Default: caller can access the thread, which lives in org_1.
  mockCanAccessThread.mockResolvedValue({
    threadId: 'thread_1',
    organizationId: 'org_1',
  });
});

const cases: Array<{ name: string; handler: Handler; resourceType: string }> = [
  {
    name: 'getPendingConnectorApprovalsForThread',
    handler: getConnector,
    resourceType: 'connector_operation',
  },
  {
    name: 'getWorkflowCreationApprovalsForThread',
    handler: getWorkflow,
    resourceType: 'workflow_creation',
  },
  {
    name: 'getHumanInputRequestsForThread',
    handler: getHumanInput,
    resourceType: 'human_input_request',
  },
];

for (const { name, handler, resourceType } of cases) {
  describe(`${name} — thread RLS`, () => {
    it('returns [] when the user is not authenticated', async () => {
      mockGetAuthUserIdentity.mockResolvedValue(null);
      const ctx = makeCtx([approvalRow({ resourceType })]);
      const out = await handler(ctx, { threadId: 'thread_1' });
      expect(out).toEqual([]);
      // Must not consult the thread / table when unauthenticated.
      expect(mockCanAccessThread).not.toHaveBeenCalled();
    });

    it('returns [] for an out-of-tenant (inaccessible) threadId', async () => {
      mockCanAccessThread.mockResolvedValue(null);
      const ctx = makeCtx([approvalRow({ resourceType })]);
      const out = await handler(ctx, { threadId: 'thread_other_org' });
      expect(out).toEqual([]);
      expect(mockCanAccessThread).toHaveBeenCalledWith(
        ctx,
        'thread_other_org',
        { userId: 'u_1' },
      );
    });

    it('returns matching rows when the caller can access the thread', async () => {
      const ctx = makeCtx([approvalRow({ _id: 'a', resourceType })]);
      const out = (await handler(ctx, { threadId: 'thread_1' })) as Row[];
      expect(out).toHaveLength(1);
      expect(out[0]._id).toBe('a');
    });

    it('drops rows whose org diverges from the thread (defence in depth)', async () => {
      const ctx = makeCtx([
        approvalRow({ _id: 'mine', resourceType, organizationId: 'org_1' }),
        approvalRow({ _id: 'leak', resourceType, organizationId: 'org_2' }),
      ]);
      const out = (await handler(ctx, { threadId: 'thread_1' })) as Row[];
      expect(out.map((r) => r._id)).toEqual(['mine']);
    });

    it('returns matching rows for an accessible org-less thread', async () => {
      // canAccessThread grants the owner access to an org-less thread and
      // returns no organizationId; the divergence check must not drop rows.
      mockCanAccessThread.mockResolvedValue({
        threadId: 'thread_1',
        organizationId: undefined,
      });
      const ctx = makeCtx([
        approvalRow({ _id: 'a', resourceType, organizationId: 'org_1' }),
        approvalRow({ _id: 'b', resourceType, organizationId: 'org_2' }),
      ]);
      const out = (await handler(ctx, { threadId: 'thread_1' })) as Row[];
      expect(out.map((r) => r._id)).toEqual(['a', 'b']);
    });

    it('ignores rows of a different resourceType on the same thread', async () => {
      const ctx = makeCtx([
        approvalRow({ _id: 'keep', resourceType }),
        approvalRow({ _id: 'skip', resourceType: 'something_else' }),
      ]);
      const out = (await handler(ctx, { threadId: 'thread_1' })) as Row[];
      expect(out.map((r) => r._id)).toEqual(['keep']);
    });
  });
}
