import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { websitesAfterEmbeddingChange } from '../websites/service.ts';
import { deleteKnowledgeEmbedding, writeKnowledgeEmbedding } from './admin.ts';
import {
  requeueDocumentsWithoutVectors,
  requeueEmbeddingBlockedDocuments,
} from './service.ts';

/**
 * Choosing the organization's embedding model, and what follows a choice:
 * the documents that failed for want of a model go back in the queue, so do
 * the indexed documents that have no vector of the chosen width, and the
 * websites scan again so their pages are embedded too. The data-residency
 * page's door (`routes.ts`) saves through it, and so does every other
 * caller that changes the model, so a change is followed the same way
 * wherever it comes from.
 */

/** The organization a model is chosen for, by id and by the slug its
 * config tree is kept under. */
export interface EmbeddingOrganization {
  readonly organizationId: string;
  readonly orgSlug: string;
}

/**
 * Who may manage the organization's knowledge configuration — its
 * database connection and its embedding model: a role with the
 * org-settings capability, which owners and admins hold.
 */
export function assertKnowledgeAdmin(role: string): void {
  if (defineAbilityFor(role).cannot('write', 'orgSettings')) {
    throw new ConfigurationError(
      'ORG_FORBIDDEN',
      `Role "${role}" cannot manage the knowledge configuration.`,
      403,
    );
  }
}

// The websites follow the model too: their page says whether search can
// reach them, and a saved model is what embeds the pages crawled without
// one. Best-effort — the setting is saved either way; a site a failure
// here skipped is embedded by its next scheduled scan.
async function websitesFollowEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
  change: 'saved' | 'removed',
): Promise<void> {
  try {
    const { queued } = await websitesAfterEmbeddingChange(
      sql,
      org.organizationId,
      change,
    );
    if (queued > 0) {
      console.info(
        `[knowledge] embedding configured for ${org.orgSlug}: queued a scan of ${queued} website(s) to embed their pages`,
      );
    }
  } catch (error) {
    console.warn(
      `[knowledge] embedding ${change} for ${org.orgSlug}: the websites could not follow:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// So do the documents already indexed: vectors are kept per width, so a
// model of another width finds none of theirs, and each would be missing
// from search by meaning until someone indexed it again. Best-effort like
// the websites — the setting is saved either way, and saving it again
// picks up whatever a failure here left.
async function documentsFollowEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
): Promise<number> {
  try {
    const { requeued } = await requeueDocumentsWithoutVectors(sql, {
      organizationId: org.organizationId,
      orgSlug: org.orgSlug,
    });
    if (requeued > 0) {
      console.info(
        `[knowledge] embedding configured for ${org.orgSlug}: re-queued ${requeued} indexed document(s) that have no vector of the model's width`,
      );
    }
    return requeued;
  } catch (error) {
    console.warn(
      `[knowledge] embedding saved for ${org.orgSlug}: the indexed documents could not follow:`,
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

/**
 * Save the organization's embedding model — compare-and-set on the hash a
 * change names, when it names one — and have the corpus follow it.
 * Answers how many documents went back in the queue.
 */
export async function saveKnowledgeEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
  config: unknown,
  expectedHash?: string | null,
): Promise<{ requeued: number }> {
  if (expectedHash === undefined)
    await writeKnowledgeEmbedding(sql, org.orgSlug, config);
  else await writeKnowledgeEmbedding(sql, org.orgSlug, config, expectedHash);
  // Configuring a model is only half the fix: every document that failed
  // while there was none stays `failed` until something re-queues it, and
  // the failure text tells the operator to configure one "then retry
  // indexing" — one document at a time, by hand. Do it for them, and say
  // how many, so the page can report the recovery instead of looking as
  // though nothing happened.
  const { requeued } = await requeueEmbeddingBlockedDocuments(sql, {
    organizationId: org.organizationId,
  });
  if (requeued > 0) {
    console.info(
      `[knowledge] embedding configured for ${org.orgSlug}: re-queued ${requeued} document(s) that had failed on the embedding model`,
    );
  }
  const reembedded = await documentsFollowEmbedding(sql, org);
  await websitesFollowEmbedding(sql, org, 'saved');
  return { requeued: requeued + reembedded };
}

/** Remove the organization's embedding model; the websites follow. */
export async function removeKnowledgeEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
): Promise<void> {
  await deleteKnowledgeEmbedding(sql, org.orgSlug);
  await websitesFollowEmbedding(sql, org, 'removed');
}
