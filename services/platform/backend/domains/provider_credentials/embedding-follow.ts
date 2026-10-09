import type { Sql } from 'postgres';

import { requeueEmbeddingBlockedDocuments } from '../knowledge/service.ts';
import { websitesAfterEmbeddingChange } from '../websites/service.ts';
import {
  credentialDependents,
  type CredentialScope,
  type UpdateCredentialPatch,
} from './service.ts';

/**
 * What follows a change to the credential the embedding model resolves.
 * The AI providers door (`routes.ts`) calls it after every save of a
 * credential, and so does every other caller that adds or edits one, so the
 * documents and websites follow a credential however it was changed.
 */

/** What the credential resolver reads off a row — an edit to any of these
 * can lift a refusal the embedding model failed on. A rename or a model
 * allowlist changes nothing an embedding call resolves. */
const RESOLVED_FIELDS = [
  'status',
  'isDefault',
  'secret',
  'envName',
  'endpointUrl',
] as const satisfies readonly (keyof UpdateCredentialPatch)[];

/** Whether an edit changes something the credential resolver reads. */
export function patchReachesResolver(patch: UpdateCredentialPatch): boolean {
  return RESOLVED_FIELDS.some((field) => patch[field] !== undefined);
}

/**
 * A credential the embedding model resolves was added or repaired: re-queue
 * the documents that failed on the embedding model, as saving the
 * embedding settings does. Their failure told an admin to add or fix the
 * credential, and following it used to leave every document `failed`
 * until someone retried each one by hand. After the credential's own
 * commit, and best-effort: the save stands either way, and a document
 * left behind keeps its Retry.
 *
 * The websites follow the same way: a scan that ended on "the embedding
 * model couldn't process the pages" names this credential too, so the
 * sites whose scan failed or whose pages still lack vectors are scanned
 * again, and the Websites page reads again whether search reaches them.
 */
export async function followEmbeddingCredential(
  sql: Sql,
  scope: CredentialScope,
  credentialId: string,
): Promise<void> {
  let resolvedByEmbedding = false;
  try {
    const { usedBy } = await credentialDependents(sql, scope, credentialId);
    if (!usedBy.includes('embedding')) return;
    resolvedByEmbedding = true;
    const { requeued } = await requeueEmbeddingBlockedDocuments(sql, {
      organizationId: scope.organizationId,
    });
    if (requeued > 0) {
      console.info(
        `[provider-credentials] the embedding model's credential changed: re-queued ${requeued} document(s) that had failed on the embedding model`,
      );
    }
  } catch (error) {
    console.warn(
      '[provider-credentials] could not re-queue the documents that failed on the embedding model:',
      error instanceof Error ? error.message : error,
    );
  }
  // The documents' trouble is not the websites': they follow either way.
  if (!resolvedByEmbedding) return;
  try {
    const { queued } = await websitesAfterEmbeddingChange(
      sql,
      scope.organizationId,
      'saved',
    );
    if (queued > 0) {
      console.info(
        `[provider-credentials] the embedding model's credential changed: queued a scan of ${queued} website(s)`,
      );
    }
  } catch (error) {
    console.warn(
      '[provider-credentials] the websites could not follow the embedding credential:',
      error instanceof Error ? error.message : error,
    );
  }
}
