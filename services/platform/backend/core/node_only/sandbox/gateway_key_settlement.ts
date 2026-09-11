/**
 * The recoverable settlement of one turn's gateway virtual key — the ONE
 * choreography behind every path that ends a managed turn: the host's own
 * settle, its reconcile job, the sandbox watchdog's sweep, and the session
 * teardowns (deadline failure, TTL expiry, destroy).
 *
 * Two facts are settled, separately and durably: whether the key's
 * cumulative SPEND has been booked, and whether the remote key has actually
 * been REVOKED. Each step is attempted only when its fact is still open, and
 * a step that cannot complete leaves its fact open for the next attempt —
 * never faked. The order matters: the spend is read BEFORE the key is
 * deleted, because a deleted key answers 404 and its figure is gone.
 *
 * Pure over a port so the host (which talks through the ctx shim) and the
 * PG-side reconcile (which talks through `sql`) run byte-identical rules.
 */

/** What the gateway said about a key's cumulative spend. */
export type GatewaySpendReading =
  /** `unmetered`: the gateway holds the key without a budget, so 0 is the
   * absence of a figure rather than a figure — booked as 0, flagged. */
  | { status: 'ok'; cents: number; unmetered?: true }
  /** The gateway no longer knows the key: its spend is unknowable. */
  | { status: 'gone' }
  /** The gateway could not answer (down, 5xx, timeout): try again later. */
  | { status: 'unavailable' };

export interface GatewayKeySettlementState {
  spendSettled: boolean;
  keyRevoked: boolean;
}

export interface GatewayKeySettlementPort {
  readSpend(): Promise<GatewaySpendReading>;
  /** Book the spend and stamp the fact. `null` books no figure (the key was
   * gone before it could be read) but still closes the fact. Idempotent. */
  recordSpend(cents: number | null): Promise<void>;
  /** Delete the remote key. Resolves on success AND on an unknown key
   * (already gone); throws on anything else. */
  revokeKey(): Promise<void>;
  /** Stamp the revoke fact. Idempotent. */
  markKeyRevoked(): Promise<void>;
}

export interface GatewayKeySettlementOutcome extends GatewayKeySettlementState {
  /** The figure booked by THIS attempt, when it read one. */
  spentCents?: number;
}

export async function settleGatewayKey(
  state: GatewayKeySettlementState,
  port: GatewayKeySettlementPort,
  warn: (message: string, error?: unknown) => void,
): Promise<GatewayKeySettlementOutcome> {
  let { spendSettled, keyRevoked } = state;
  let spentCents: number | undefined;

  if (!spendSettled) {
    let reading: GatewaySpendReading;
    try {
      reading = await port.readSpend();
    } catch (error) {
      warn('gateway spend read failed', error);
      reading = { status: 'unavailable' };
    }
    if (reading.status === 'unavailable') {
      // Deleting now would lose the figure for good — keep the key (its
      // process is already over) and let the next attempt read it.
      warn(
        'gateway spend unavailable — settlement deferred, the key stays until its spend is booked',
      );
      return { spendSettled: false, keyRevoked };
    }
    if (reading.status === 'gone') {
      warn(
        'gateway key was already gone before its spend was read — booking no figure',
      );
      await port.recordSpend(null);
      spendSettled = true;
      if (!keyRevoked) {
        await port.markKeyRevoked();
        keyRevoked = true;
      }
      return { spendSettled, keyRevoked };
    }
    await port.recordSpend(reading.cents);
    spentCents = reading.cents;
    spendSettled = true;
  }

  if (!keyRevoked) {
    try {
      await port.revokeKey();
    } catch (error) {
      // The key stays spendable until a later attempt succeeds — say so,
      // and leave the fact open so that attempt happens.
      warn('gateway key revoke failed — revocation deferred', error);
      return {
        spendSettled,
        keyRevoked: false,
        ...(spentCents !== undefined ? { spentCents } : {}),
      };
    }
    await port.markKeyRevoked();
    keyRevoked = true;
  }

  return {
    spendSettled,
    keyRevoked,
    ...(spentCents !== undefined ? { spentCents } : {}),
  };
}

/** Whether an outcome still needs another attempt. */
export function settlementPending(state: GatewayKeySettlementState): boolean {
  return !state.spendSettled || !state.keyRevoked;
}
