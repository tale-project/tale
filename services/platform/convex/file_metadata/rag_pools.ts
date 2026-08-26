/**
 * The two workpools that bound file indexing, and the rule for choosing
 * between them.
 *
 * Indexing runs a synchronous extract/chunk/embed inside a Node action against
 * the organization's knowledge-db pool (`KNOWLEDGE_DB_POOL_MAX`, default 10).
 * An unbounded batch of large uploads saturated that pool and pushed single
 * jobs past Convex's 30-minute action ceiling — the root of the "larger files
 * didn't work consistently" report — so the number of concurrent indexing
 * actions has to be capped. `maxParallelism` is that cap.
 *
 * Why two pools rather than one: a single undifferentiated budget let a
 * background source hold every slot. On a live deployment a connector minting
 * one queued row every five minutes occupied the cap of 3 and no member upload
 * indexed for seven days (#2987). Interactive work now draws on a budget that
 * a background backlog cannot enter.
 *
 * The sum stays under the connection budget so RAG search and status polls
 * keep headroom. Raising `KNOWLEDGE_DB_POOL_MAX` without revisiting these two
 * numbers leaves them as the binding constraint.
 */

import { Workpool } from '@convex-dev/workpool';

import { components } from '../_generated/api';

/**
 * Member-facing indexing: a file someone uploaded and is waiting on. Matches
 * the previous per-org cap, so a single member's batch behaves as it did.
 */
export const ragInteractivePool = new Workpool(components.ragInteractivePool, {
  maxParallelism: 3,
  // A file that cannot be indexed fails the same way every attempt — a
  // corrupt PDF, or one too large for the action ceiling. Retry twice for a
  // transient knowledge-db blip, then stop, so an impossible file does not
  // occupy a slot forever.
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2_000,
    base: 2,
  },
});

/**
 * Everything not waited on by a person: connector imports, email attachments,
 * transcripts. A backlog here delays only itself.
 */
export const ragBackgroundPool = new Workpool(components.ragBackgroundPool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 5_000,
    base: 2,
  },
});

/**
 * Sources whose indexing a person is actively waiting for.
 *
 * `source` is an open provenance string, so this is a small allow-list rather
 * than an exhaustive switch: anything unrecognised — a connector slug, a new
 * channel, an unstamped legacy row — is background. That direction is the safe
 * one. A background job mistaken for interactive can starve a member's upload,
 * which is the defect this split exists to fix; the reverse only makes an
 * import wait.
 */
const INTERACTIVE_SOURCES: ReadonlySet<string> = new Set(['user']);

/** The pool a row belongs in, decided from its provenance. */
export function ragPoolFor(source: string | undefined): Workpool {
  return source !== undefined && INTERACTIVE_SOURCES.has(source)
    ? ragInteractivePool
    : ragBackgroundPool;
}
