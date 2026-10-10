// @vitest-environment node

/**
 * The worker's sealer round: every organization with rows waiting gets its
 * turn, a burst in one gets a bounded number of batches per round, and a
 * stopped sealer finishes the round it is in.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUnsealedOrgIds, sealAuditChain } = vi.hoisted(() => ({
  listUnsealedOrgIds: vi.fn(),
  sealAuditChain: vi.fn(),
}));

vi.mock('./service.ts', () => ({ listUnsealedOrgIds, sealAuditChain }));

import { sealPendingAuditChains, startAuditSealer } from './sealer.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the round only hands the pool on
const sql = {} as unknown as Sql;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sealPendingAuditChains', () => {
  it('seals every organization with rows waiting until each has none left', async () => {
    listUnsealedOrgIds.mockResolvedValue(['o1', 'o2']);
    const left = new Map([
      ['o1', [500, 120]],
      ['o2', [3]],
    ]);
    sealAuditChain.mockImplementation((_sql: Sql, orgId: string) =>
      Promise.resolve(left.get(orgId)?.shift() ?? 0),
    );
    await expect(sealPendingAuditChains(sql)).resolves.toEqual({
      sealed: 623,
      organizations: 2,
    });
  });

  it('gives a burst in one organization a bounded share of the round', async () => {
    listUnsealedOrgIds.mockResolvedValue(['busy', 'quiet']);
    sealAuditChain.mockImplementation((_sql: Sql, orgId: string) =>
      Promise.resolve(orgId === 'busy' ? 500 : 1),
    );
    await sealPendingAuditChains(sql);
    const busyCalls = sealAuditChain.mock.calls.filter(
      ([, orgId]) => orgId === 'busy',
    );
    expect(busyCalls).toHaveLength(8);
    expect(sealAuditChain).toHaveBeenCalledWith(sql, 'quiet');
  });
});

describe('startAuditSealer', () => {
  it('runs rounds until stopped, and stop waits for the round in flight', async () => {
    listUnsealedOrgIds.mockResolvedValue([]);
    const sealer = startAuditSealer(sql, { intervalMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await sealer.stop();
    const rounds = listUnsealedOrgIds.mock.calls.length;
    expect(rounds).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listUnsealedOrgIds.mock.calls.length).toBe(rounds);
  });

  it('keeps sealing after a round that failed', async () => {
    listUnsealedOrgIds
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue([]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sealer = startAuditSealer(sql, { intervalMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await sealer.stop();
    expect(errors).toHaveBeenCalled();
    expect(listUnsealedOrgIds.mock.calls.length).toBeGreaterThan(1);
    errors.mockRestore();
  });
});
