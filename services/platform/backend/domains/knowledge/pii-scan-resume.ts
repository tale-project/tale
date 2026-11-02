import type { Sql } from 'postgres';

import {
  parsePiiConfig,
  scrubberForPolicy,
} from '../../core/knowledge/pii_gate.ts';
import { readGovernancePolicy } from '../../lib/org-config.ts';
import { requeuePiiScanFailedDocuments } from './service.ts';

/** The most documents one pass queues for one organization: an organization
 * with a long backlog does not take the whole pass, and the rest of its
 * backlog waits for the next one. */
const MAX_REQUEUE_PER_ORGANIZATION = 250;

/** The most documents one pass queues in all, as the usage-limit resume: the
 * documents it queues must be indexed within the RAG watchdog's patience, or
 * the watchdog fails them without the code that finds them again. */
const MAX_REQUEUE_PER_PASS = 1_000;

/**
 * Queue again the documents the PII policy refused because its protection
 * could not start (`PII_SCAN_FAILED_REASONS.unavailable`: the scrubber could
 * not be built, typically on an image without the PII data tree), once this
 * process can build it. Run when a worker whose boot probe loaded the data
 * tree starts, so a redeploy that fixed the image heals what the old one
 * refused, and hourly after that.
 *
 * The documents are found with the policy save's own selection
 * (`requeuePiiScanFailedDocuments`), for that cause alone: a part that could
 * not be scanned whole (`incomplete`) fails again for the same text and
 * policy, so it stays with the policy save and Retry indexing. Each
 * organization's policy is read as indexing reads it, and its documents are
 * queued only when that policy is enabled and its scrubber builds here: a
 * disabled policy's save already queued them, a policy that cannot be read
 * is not taken for a disabled one, and a scrubber that still fails would
 * refuse them again.
 *
 * Bounded per organization and per pass, files first. Running it again
 * queues nothing twice: a queued file is no longer failed, and an email
 * body whose job still waits or runs is left out. One organization that
 * fails is logged and the pass goes on; it stops between organizations once
 * its job is aborted.
 */
export async function requeuePiiUnavailableDocuments(
  sql: Sql,
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const organizations = await sql<{ id: string; slug: string }[]>`
    SELECT "id", "slug" FROM "organization"
    WHERE "slug" IS NOT NULL
    ORDER BY "id"
  `;
  let total = 0;
  for (const organization of organizations) {
    if (options.signal?.aborted === true) break;
    const limit = Math.min(
      MAX_REQUEUE_PER_ORGANIZATION,
      MAX_REQUEUE_PER_PASS - total,
    );
    if (limit <= 0) break;
    try {
      const config = parsePiiConfig(
        await readGovernancePolicy(organization.slug, 'pii_config'),
      );
      if (config === null) continue;
      const scrubber = scrubberForPolicy(config);
      if (scrubber === null || scrubber === 'unavailable') continue;
      const { requeued } = await requeuePiiScanFailedDocuments(
        sql,
        { organizationId: organization.id, orgSlug: organization.slug },
        { cause: 'unavailable', limit, skipQueuedBodies: true },
      );
      total += requeued;
    } catch (error) {
      console.warn(
        '[knowledge] could not resume the PII scans of an organization',
        { organizationId: organization.id },
        error,
      );
    }
  }
  return total;
}
