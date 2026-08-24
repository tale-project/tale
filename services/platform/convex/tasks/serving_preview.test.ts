/**
 * Wiring tests for the task-lane unpinned-serving preview: the caller must be
 * an org member, the TASK resolver is asked WITHOUT a pin (the direct-only
 * legacy walk — deliberately not the automation lane's two-pass), and a
 * resolution failure comes back as a result the dialog can render.
 * Direct-handler pattern: the codegen surface is mocked so `action(config)`
 * returns the config, and the resolver is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

const mockResolve = vi.fn();
vi.mock('./task_serving', () => ({
  resolveTaskServing: (...args: unknown[]) => mockResolve(...args),
}));

const { previewUnpinnedTaskServing } = await import('./serving_preview');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const handler = (previewUnpinnedTaskServing as unknown as ActionConfig).handler;

const ARGS = {
  organizationId: 'org-1',
  model: 'claude-fable-5',
  harness: 'claude-code',
} as never;

beforeEach(() => {
  mockRequireOrgMembershipById.mockReset().mockResolvedValue({});
  mockResolve.mockReset();
});

describe('previewUnpinnedTaskServing', () => {
  it('asks the task resolver with NO pin and passes its answer through', async () => {
    mockResolve.mockResolvedValue({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
    });

    const result = await handler({} as never, ARGS);

    expect(mockRequireOrgMembershipById).toHaveBeenCalledWith({}, 'org-1');
    // No `modelProvider` in the resolver call — the preview must take the
    // exact unpinned path a pinless agent's run takes.
    expect(mockResolve).toHaveBeenCalledWith(
      {},
      {
        organizationId: 'org-1',
        model: 'claude-fable-5',
        harness: 'claude-code',
      },
    );
    expect(result).toEqual({
      ok: true,
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
      lane: 'gateway',
    });
  });

  it('returns the resolver’s refusal as a result, not a thrown error', async () => {
    mockResolve.mockRejectedValue(
      new Error('no provider is configured to serve model claude-fable-5'),
    );

    const result = await handler({} as never, ARGS);
    expect(result).toEqual({
      ok: false,
      reason: 'no provider is configured to serve model claude-fable-5',
    });
  });

  it('refuses before resolving when the caller is not a member', async () => {
    mockRequireOrgMembershipById.mockRejectedValue(new Error('ORG_FORBIDDEN'));

    await expect(handler({} as never, ARGS)).rejects.toThrow('ORG_FORBIDDEN');
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
