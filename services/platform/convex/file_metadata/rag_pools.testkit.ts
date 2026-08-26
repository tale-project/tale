/**
 * Register the indexing workpools on a `convexTest` instance.
 *
 * Any mutation that marks a `fileMetadata` row `'queued'` enqueues onto a pool,
 * and convex-test throws `Component "ragInteractivePool" is not registered` for
 * an unregistered component — so a test that uploads, binds, or replaces a file
 * needs this even when indexing is not what it is testing.
 *
 * Both pools, always: which one a row lands on depends on its `source`, so
 * registering only the expected one turns a routing change into a confusing
 * failure in an unrelated suite.
 */

import workpoolComponent from '@convex-dev/workpool/test';
import type { TestConvex } from 'convex-test';
import type { GenericSchema, SchemaDefinition } from 'convex/server';

export function registerRagPools<
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<Schema>): void {
  workpoolComponent.register(t, 'ragInteractivePool');
  workpoolComponent.register(t, 'ragBackgroundPool');
}
