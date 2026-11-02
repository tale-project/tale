import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { readOrgEmbeddingConfig } from '../../core/knowledge/connection.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { websitesAfterEmbeddingChange } from '../websites/service.ts';
import {
  deleteKnowledgeEmbedding,
  writeKnowledgeEmbedding,
  type KnowledgeAuditActor,
} from './admin.ts';
import {
  requeueDocumentsNotEmbeddedByModel,
  requeueEmbeddingBlockedDocuments,
  stampUnrecordedEmbeddingModel,
} from './service.ts';

/**
 * Choosing the organization's embedding model, and what follows a choice:
 * the documents that failed for want of a model go back in the queue, so do
 * the indexed documents the chosen model did not embed — of another width,
 * or of another name at its width — and the websites scan again so their
 * pages are embedded too. The data-residency page's door (`routes.ts`) saves
 * through it, and so does every other caller that changes the model, so a
 * change is followed the same way wherever it comes from.
 */

/** The organization a model is chosen for, by id and by the slug its
 * config tree is kept under. */
export interface EmbeddingOrganization {
  readonly organizationId: string;
  readonly orgSlug: string;
}

/**
 * Whether a role may manage the organization's knowledge configuration —
 * its database connection and its embedding model: a role with the
 * org-settings capability, which owners and admins hold.
 */
export function mayManageKnowledge(role: string): boolean {
  return defineAbilityFor(role).can('write', 'orgSettings');
}

/** Refuse a role that may not manage the knowledge configuration. */
export function assertKnowledgeAdmin(role: string): void {
  if (!mayManageKnowledge(role)) {
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
// model of another width finds none of theirs, and a document records the
// model that embedded it, so another model of the same width finds it is
// not that one's. Each would be missing from search by meaning until
// someone indexed it again. Best-effort like the websites — the setting is
// saved either way, and saving it again picks up whatever a failure here
// left.
async function documentsFollowEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
): Promise<number> {
  try {
    const { requeued } = await requeueDocumentsNotEmbeddedByModel(sql, {
      organizationId: org.organizationId,
      orgSlug: org.orgSlug,
    });
    if (requeued > 0) {
      console.info(
        `[knowledge] embedding configured for ${org.orgSlug}: re-queued ${requeued} indexed document(s) the model has not embedded`,
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

// Before the settings change, the documents indexed before the corpus
// recorded their model are stamped with the model the settings still state:
// the one that embedded them. Afterwards nothing tells which it was, and an
// unstamped document passes for the model saved next with the old one's
// vectors — a loss no later save repairs, as one repairs a failed re-queue.
// So a save that names another model does not go ahead without the stamp:
// the corpus that does not answer refuses it, and the person saves again
// once it does. Any other save keeps the name the documents pass for, and a
// removal leaves none, which the next save stamps as a model no longer
// known; both go ahead when the corpus does not answer.
async function documentsRecordTheirModel(
  org: EmbeddingOrganization,
  change:
    | { readonly kind: 'save'; readonly config: unknown }
    | {
        readonly kind: 'removal';
      },
): Promise<void> {
  try {
    const { stamped } = await stampUnrecordedEmbeddingModel(org.orgSlug);
    if (stamped > 0) {
      console.info(
        `[knowledge] embedding ${change.kind} for ${org.orgSlug}: recorded the model that embedded ${stamped} document(s) indexed before the model was recorded`,
      );
    }
  } catch (error) {
    if (
      change.kind === 'save' &&
      (await namesAnotherModel(org.orgSlug, change.config))
    ) {
      throw error;
    }
    console.warn(
      `[knowledge] embedding ${change.kind} for ${org.orgSlug}: the model that embedded the documents indexed before it was recorded could not be recorded; the next save that names another model records it first:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Whether a save names another model than the one the settings state now.
 * False when none is stated, when the settings do not read, and when the
 * body names no model — the write refuses that one itself. */
async function namesAnotherModel(
  orgSlug: string,
  config: unknown,
): Promise<boolean> {
  const next =
    typeof config === 'object' &&
    config !== null &&
    'model' in config &&
    typeof config.model === 'string'
      ? config.model
      : null;
  if (next === null) return false;
  try {
    const current = await readOrgEmbeddingConfig(orgSlug);
    return current !== null && current.model !== next;
  } catch (error) {
    console.warn(
      `[knowledge] embedding save for ${orgSlug}: the settings it replaces do not read:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Save the organization's embedding model — compare-and-set on the hash a
 * change names, when it names one, and audited under the person who saved
 * it — and have the corpus follow it. Answers how many documents went back
 * in the queue.
 */
export async function saveKnowledgeEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
  config: unknown,
  expectedHash: string | null | undefined,
  actor: KnowledgeAuditActor,
): Promise<{ requeued: number }> {
  await documentsRecordTheirModel(org, { kind: 'save', config });
  await writeKnowledgeEmbedding(sql, org.orgSlug, config, expectedHash, actor);
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

/** Remove the organization's embedding model, audited under the person
 * who removed it; the websites follow. The documents keep their vectors and
 * the record of the model that made them, for the next model saved. */
export async function removeKnowledgeEmbedding(
  sql: Sql,
  org: EmbeddingOrganization,
  actor: KnowledgeAuditActor,
): Promise<void> {
  await documentsRecordTheirModel(org, { kind: 'removal' });
  await deleteKnowledgeEmbedding(sql, org.orgSlug, actor);
  await websitesFollowEmbedding(sql, org, 'removed');
}
