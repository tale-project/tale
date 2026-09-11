/**
 * `releaseTurnKey` — the host's settle over the ctx shim, driven through the
 * REAL choreography with the gateway client and the shim replaced. The
 * reviewer's three probes, locked:
 *
 *  - a spend read that throws or answers 5xx books nothing, deletes nothing,
 *    still stamps the op terminal, and schedules the reconcile;
 *  - a failed remote DELETE keeps the spend booked, does NOT mark the token
 *    revoked, and schedules the reconcile;
 *  - a clean settle books the spend with the turn's token totals, revokes,
 *    marks, and schedules nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const gateway = vi.hoisted(() => ({
  readVirtualKeySpend: vi.fn(),
  revokeVirtualKey: vi.fn(),
}));

vi.mock('../node_only/sandbox/llm_gateway_admin', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/llm_gateway_admin')
    >();
  return { ...actual, ...gateway };
});

const { releaseTurnKey } = await import('./agent_host');

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx(op: { spendSettled?: boolean; keyRevoked?: boolean } = {}) {
  const mutations: Call[] = [];
  const scheduled: Call[] = [];
  const ctx = {
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name.endsWith(':claimSessionOpFinalize')) return true;
      if (name.endsWith(':recordSessionOpSpend')) return true;
      return null;
    },
    runQuery: async () => ({
      mintedKeyId: 'vk-1',
      startedAt: 1,
      spendSettled: op.spendSettled ?? false,
      keyRevoked: op.keyRevoked ?? false,
    }),
    runAction: async () => null,
    scheduler: {
      runAfter: async (
        _delay: number,
        ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ name: functionRefName(ref), args });
        return 'job';
      },
      runAt: async () => 'job',
      cancel: async () => undefined,
    },
  };
  return { ctx: ctx as never, mutations, scheduled };
}

const ARGS = {
  organizationId: 'org_A',
  sessionId: 'pa-alice',
  execId: 'exec-A',
  status: 'completed' as const,
};

const names = (calls: Call[]) => calls.map((c) => c.name.split(':').at(-1));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('releaseTurnKey', () => {
  it('books the spend with the token totals, revokes, marks, and schedules nothing', async () => {
    gateway.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 25 });
    gateway.revokeVirtualKey.mockResolvedValue(undefined);
    const { ctx, mutations, scheduled } = makeCtx();

    const result = await releaseTurnKey(ctx, {
      ...ARGS,
      usageTotals: { inputTokens: 900, outputTokens: 120 },
    });

    expect(result).toEqual({ won: true, spentCents: 25 });
    expect(names(mutations)).toEqual([
      'claimSessionOpFinalize',
      'recordSessionOpSpend',
      'markSessionTokenRevokedByKeyId',
      'upsertSessionOp',
    ]);
    expect(mutations[1]?.args).toMatchObject({
      sessionId: 'pa-alice',
      execId: 'exec-A',
      spentCents: 25,
      usage: { inputTokens: 900, outputTokens: 120 },
    });
    expect(gateway.revokeVirtualKey).toHaveBeenCalledWith('vk-1');
    expect(scheduled).toEqual([]);
  });

  it('defers everything when the spend read throws — no booking, no delete, reconcile scheduled', async () => {
    gateway.readVirtualKeySpend.mockRejectedValue(
      new Error('simulated gateway connection reset'),
    );
    const { ctx, mutations, scheduled } = makeCtx();

    const result = await releaseTurnKey(ctx, ARGS);

    expect(result).toEqual({ won: true });
    // The op still goes terminal; the settlement facts stay open.
    expect(names(mutations)).toEqual([
      'claimSessionOpFinalize',
      'upsertSessionOp',
    ]);
    expect(gateway.revokeVirtualKey).not.toHaveBeenCalled();
    expect(scheduled).toEqual([
      {
        name: 'sandbox/gateway_reconcile:reconcileSessionOpKey',
        args: {
          organizationId: 'org_A',
          sessionId: 'pa-alice',
          execId: 'exec-A',
        },
      },
    ]);
  });

  it('defers everything when the gateway answers 5xx on the spend read', async () => {
    gateway.readVirtualKeySpend.mockResolvedValue({ status: 'unavailable' });
    const { ctx, mutations, scheduled } = makeCtx();

    await releaseTurnKey(ctx, ARGS);

    expect(names(mutations)).toEqual([
      'claimSessionOpFinalize',
      'upsertSessionOp',
    ]);
    expect(gateway.revokeVirtualKey).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
  });

  it('keeps the spend booked but the token unrevoked when the delete fails', async () => {
    gateway.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 25 });
    gateway.revokeVirtualKey.mockRejectedValue(
      new Error('llm-gateway revoke key failed (503)'),
    );
    const { ctx, mutations, scheduled } = makeCtx();

    const result = await releaseTurnKey(ctx, ARGS);

    expect(result).toEqual({ won: true, spentCents: 25 });
    expect(names(mutations)).toEqual([
      'claimSessionOpFinalize',
      'recordSessionOpSpend',
      'upsertSessionOp',
    ]);
    expect(scheduled).toHaveLength(1);
  });

  it('resumes from a booked spend: only the revoke runs', async () => {
    gateway.revokeVirtualKey.mockResolvedValue(undefined);
    const { ctx, mutations, scheduled } = makeCtx({ spendSettled: true });

    await releaseTurnKey(ctx, ARGS);

    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
    expect(names(mutations)).toEqual([
      'claimSessionOpFinalize',
      'markSessionTokenRevokedByKeyId',
      'upsertSessionOp',
    ]);
    expect(scheduled).toEqual([]);
  });

  it('does nothing for a loser of the finalize claim', async () => {
    const { ctx, mutations } = makeCtx();
    (ctx as { runMutation: unknown }).runMutation = async () => false;

    await expect(releaseTurnKey(ctx, ARGS)).resolves.toEqual({ won: false });
    expect(mutations).toEqual([]);
    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
  });
});
