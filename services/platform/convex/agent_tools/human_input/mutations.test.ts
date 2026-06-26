import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

/**
 * #2056 regression: the human-input submit/edit guards must reject with a
 * structured `ConvexError({ code })` so the request card can map the failure
 * to a localized message instead of the prod-redacted "Server Error".
 *
 * Each guard throws before any scheduler / streaming / workflow / budget call,
 * so those heavy deps are stubbed only to keep the module import clean.
 */

vi.mock('@convex-dev/agent', () => ({ saveMessage: vi.fn() }));

vi.mock('convex/server', () => ({
  createFunctionHandle: vi.fn(),
  makeFunctionReference: () => 'mock-ref',
}));

vi.mock('../../_generated/api', () => ({
  components: { agent: {} },
  internal: {},
}));

vi.mock('../../_generated/server', () => ({
  internalMutation: ({ handler }: { handler: unknown }) => handler,
}));

vi.mock('../../governance/budget_enforcement', () => ({
  checkBudget: vi.fn(),
}));
vi.mock('../../governance/resolve_budget_context', () => ({
  resolveBudgetContext: vi.fn(),
}));
vi.mock('../../streaming/helpers', () => ({
  persistentStreaming: { createStream: vi.fn() },
}));
vi.mock('../../workflow_engine/engine', () => ({ workflowManagers: [] }));
vi.mock('../../workflow_engine/helpers/engine/shard', () => ({
  safeShardIndex: () => 0,
}));

const { submitHumanInputResponseInternal, editHumanInputResponseInternal } =
  await import('./mutations');

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;
const submit = submitHumanInputResponseInternal as unknown as Handler;
const edit = editHumanInputResponseInternal as unknown as Handler;

function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  const data: unknown = (err as { data: unknown }).data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const candidate: unknown = (data as { code: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

function ctxWith(approval: unknown) {
  return { db: { get: async () => approval } };
}

const BASE_ARGS = {
  approvalId: 'a1',
  response: 'yes',
  respondedBy: 'user@example.com',
  approvedBy: 'user_1',
};

async function catchCode(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return codeOf(err);
  }
  return undefined;
}

describe('human-input submit/edit error codes (#2056)', () => {
  it('submit throws NOT_FOUND when the approval is missing', async () => {
    const code = await catchCode(() => submit(ctxWith(null), BASE_ARGS));
    expect(code).toBe('NOT_FOUND');
  });

  it('submit throws ALREADY_RESPONDED when the request is no longer pending', async () => {
    const code = await catchCode(() =>
      submit(
        ctxWith({
          status: 'completed',
          resourceType: 'human_input_request',
          threadId: 't1',
        }),
        BASE_ARGS,
      ),
    );
    expect(code).toBe('ALREADY_RESPONDED');
  });

  it('submit throws INVALID_TYPE when the approval is not a human-input request', async () => {
    const code = await catchCode(() =>
      submit(
        ctxWith({ status: 'pending', resourceType: 'integration_operation' }),
        BASE_ARGS,
      ),
    );
    expect(code).toBe('INVALID_TYPE');
  });

  it('submit throws NO_THREAD when the request has no associated thread', async () => {
    const code = await catchCode(() =>
      submit(
        ctxWith({
          status: 'pending',
          resourceType: 'human_input_request',
          threadId: undefined,
        }),
        BASE_ARGS,
      ),
    );
    expect(code).toBe('NO_THREAD');
  });

  it('edit throws NOT_EDITABLE when the response is not yet completed', async () => {
    const code = await catchCode(() =>
      edit(
        ctxWith({ status: 'pending', resourceType: 'human_input_request' }),
        BASE_ARGS,
      ),
    );
    expect(code).toBe('NOT_EDITABLE');
  });

  it('edit throws WORKFLOW_NOT_EDITABLE for a workflow-context response', async () => {
    const code = await catchCode(() =>
      edit(
        ctxWith({
          status: 'completed',
          resourceType: 'human_input_request',
          wfExecutionId: 'wf1',
          threadId: 't1',
        }),
        BASE_ARGS,
      ),
    );
    expect(code).toBe('WORKFLOW_NOT_EDITABLE');
  });
});
