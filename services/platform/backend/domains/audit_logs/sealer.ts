import type { Sql } from 'postgres';

import { listUnsealedOrgIds, sealAuditChain } from './service.ts';

/**
 * The worker's audit sealer: every `intervalMs` it seals what each
 * organization has waiting (`sealAuditChain`), a few organizations at a
 * time, until a pass finds nothing left or the round's budget is spent.
 * Every worker runs one; the chain key a pass seals under keeps two of them
 * off the same organization, and the one that lost tries again next round.
 */

/** Pause between rounds; a row waits about this long to be sealed. */
const DEFAULT_INTERVAL_MS = 250;
/** Organizations sealed at once. */
const ORG_CONCURRENCY = 4;
/** Batches one organization gets per round, so a burst in one cannot hold
 * the others' rows unsealed. */
const BATCHES_PER_ORG = 8;

export interface AuditSealer {
  /** Stop after the round in flight; resolves once it has finished. */
  stop(): Promise<void>;
}

/** One round over every organization with unsealed rows. */
export async function sealPendingAuditChains(
  sql: Sql,
): Promise<{ sealed: number; organizations: number }> {
  const orgIds = await listUnsealedOrgIds(sql);
  let sealed = 0;
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const orgId = orgIds[next];
      next += 1;
      if (orgId === undefined) return;
      for (let round = 0; round < BATCHES_PER_ORG; round += 1) {
        const count = await sealAuditChain(sql, orgId);
        sealed += count;
        if (count === 0) break;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ORG_CONCURRENCY, orgIds.length) }, lane),
  );
  return { sealed, organizations: orgIds.length };
}

export function startAuditSealer(
  sql: Sql,
  options: { intervalMs?: number } = {},
): AuditSealer {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let wake: (() => void) | null = null;
  const loop = (async () => {
    while (!stopped) {
      try {
        await sealPendingAuditChains(sql);
      } catch (error) {
        console.error('[audit-sealer] round failed; retrying:', error);
      }
      if (stopped) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  })();
  return {
    async stop() {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
