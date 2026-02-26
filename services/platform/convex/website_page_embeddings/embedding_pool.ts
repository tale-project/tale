import { Workpool } from '@convex-dev/workpool';

import { components } from '../_generated/api';

// Serialize embedding generation to avoid overwhelming the embedding API
// and Convex action concurrency. During bulk scans, hundreds of pages may
// need embeddings across multiple batches — without a pool, all embedding
// actions would fire concurrently, causing rate-limit failures and server
// instability.
export const embeddingPool = new Workpool(components.embeddingPool, {
  maxParallelism: 1,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 10_000,
    base: 2,
  },
});
