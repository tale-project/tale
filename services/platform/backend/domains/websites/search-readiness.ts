import type { Sql } from 'postgres';

import { resolveOrgSlug } from '../../lib/org-config.ts';
import { readKnowledgeEmbeddingView } from '../knowledge/admin.ts';
import { isCredentialSelectionResolvable } from '../provider_credentials/service.ts';

/**
 * Whether chat and knowledge search can reach this organization's crawled
 * pages. Every search embeds its query before any leg runs, so without an
 * embedding model that resolves, a site can read Active with every page
 * indexed and still be invisible to the assistant — which the Websites page
 * has to say, because nothing else on it does.
 */
export async function websiteSearchReady(
  sql: Sql,
  organizationId: string,
): Promise<boolean> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (!orgSlug) return false;
  const view = await readKnowledgeEmbeddingView(orgSlug);
  if (!view.configured || view.providerSlug === undefined) return false;
  return isCredentialSelectionResolvable(sql, organizationId, {
    providerSlug: view.providerSlug,
    ...(view.credentialId !== undefined
      ? { credentialId: view.credentialId }
      : {}),
  });
}
