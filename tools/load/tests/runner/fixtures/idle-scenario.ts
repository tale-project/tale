/**
 * A virtual user that only counts itself in and waits for its stop — enough
 * for the orchestrator to collect snapshots, with nothing to talk to.
 */
import type { VirtualUserContext } from '../../../src/scenario/contract.ts';

export async function runVirtualUser(ctx: VirtualUserContext): Promise<void> {
  ctx.metrics.counter('idle.started');
  await new Promise<void>((resolve) => {
    if (ctx.signal.aborted) resolve();
    else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
