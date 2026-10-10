/**
 * Entry point of a mock cluster worker (`node:cluster` forks this file).
 * Everything it needs arrives in its environment; see `cluster.ts`.
 */

import { runClusterWorker } from './cluster.ts';

runClusterWorker().catch((error: unknown) => {
  console.error('[mock] worker failed to start:', error);
  process.exit(1);
});
