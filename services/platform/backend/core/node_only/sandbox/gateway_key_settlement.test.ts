/**
 * The settlement choreography's contract, one fact at a time: the spend is
 * read and booked BEFORE the key is deleted, an unavailable gateway defers
 * both facts (and deletes nothing — a deleted key's figure is gone), a key
 * the gateway no longer knows closes both facts without a figure, a failed
 * revoke leaves only the revoke fact open, and a resumed attempt starts from
 * the facts already closed.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  type GatewayKeySettlementPort,
  type GatewaySpendReading,
  settleGatewayKey,
  settlementPending,
} from './gateway_key_settlement';

function port(overrides: Partial<GatewayKeySettlementPort> = {}) {
  const calls: string[] = [];
  const p: GatewayKeySettlementPort = {
    readSpend: async () => {
      calls.push('read');
      return { status: 'ok', cents: 25 } satisfies GatewaySpendReading;
    },
    recordSpend: async (cents) => {
      calls.push(`record:${cents === null ? 'none' : cents}`);
    },
    revokeKey: async () => {
      calls.push('revoke');
    },
    markKeyRevoked: async () => {
      calls.push('mark-revoked');
    },
    ...overrides,
  };
  return { port: p, calls };
}

const warn = vi.fn();

describe('settleGatewayKey', () => {
  it('books the spend, then revokes and marks — in that order', async () => {
    const { port: p, calls } = port();

    const outcome = await settleGatewayKey(
      { spendSettled: false, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({
      spendSettled: true,
      keyRevoked: true,
      spentCents: 25,
    });
    expect(calls).toEqual(['read', 'record:25', 'revoke', 'mark-revoked']);
    expect(settlementPending(outcome)).toBe(false);
  });

  it('defers everything — and deletes nothing — when the gateway cannot answer', async () => {
    const { port: p, calls } = port({
      readSpend: async () => ({ status: 'unavailable' }),
    });

    const outcome = await settleGatewayKey(
      { spendSettled: false, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({ spendSettled: false, keyRevoked: false });
    expect(calls).toEqual([]);
    expect(settlementPending(outcome)).toBe(true);
  });

  it('treats a thrown spend read like an unavailable gateway', async () => {
    const { port: p, calls } = port({
      readSpend: async () => {
        throw new Error('connection reset');
      },
    });

    const outcome = await settleGatewayKey(
      { spendSettled: false, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({ spendSettled: false, keyRevoked: false });
    expect(calls).toEqual([]);
  });

  it('closes both facts without a figure for a key the gateway no longer knows', async () => {
    const { port: p, calls } = port({
      readSpend: async () => ({ status: 'gone' }),
    });

    const outcome = await settleGatewayKey(
      { spendSettled: false, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({ spendSettled: true, keyRevoked: true });
    // No DELETE for a key that is already gone; the revoke fact is stamped.
    expect(calls).toEqual(['record:none', 'mark-revoked']);
  });

  it('keeps the spend booked and only the revoke open when the delete fails', async () => {
    const { port: p, calls } = port();
    p.revokeKey = async () => {
      calls.push('revoke');
      throw new Error('llm-gateway revoke key failed (503)');
    };

    const outcome = await settleGatewayKey(
      { spendSettled: false, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({
      spendSettled: true,
      keyRevoked: false,
      spentCents: 25,
    });
    // The token is NOT marked revoked on a failed delete.
    expect(calls).toEqual(['read', 'record:25', 'revoke']);
    expect(settlementPending(outcome)).toBe(true);
  });

  it('resumes from a booked spend: no second read or booking, just the revoke', async () => {
    const { port: p, calls } = port();

    const outcome = await settleGatewayKey(
      { spendSettled: true, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({ spendSettled: true, keyRevoked: true });
    expect(calls).toEqual(['revoke', 'mark-revoked']);
  });

  it('does nothing once both facts are closed', async () => {
    const { port: p, calls } = port();

    const outcome = await settleGatewayKey(
      { spendSettled: true, keyRevoked: true },
      p,
      warn,
    );

    expect(outcome).toEqual({ spendSettled: true, keyRevoked: true });
    expect(calls).toEqual([]);
  });

  it('books an unmetered key as zero rather than deferring forever', async () => {
    const { port: p, calls } = port({
      readSpend: async () => ({ status: 'ok', cents: 0, unmetered: true }),
    });

    const outcome = await settleGatewayKey(
      { spendSettled: false, keyRevoked: false },
      p,
      warn,
    );

    expect(outcome).toEqual({
      spendSettled: true,
      keyRevoked: true,
      spentCents: 0,
    });
    expect(calls).toEqual(['record:0', 'revoke', 'mark-revoked']);
  });
});
