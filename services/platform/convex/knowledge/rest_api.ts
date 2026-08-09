/**
 * Knowledge retrieval REST API handler.
 *
 * Endpoint:
 *   POST /api/v1/knowledge/search   — Search the organization's knowledge
 *
 * A search is a POST because it carries a body, not because it writes: nothing
 * about it mutates state. Both organization identifiers come from the
 * authenticated key (the id resolves the embedding credential, the slug
 * resolves the corpus), so a caller cannot name a corpus — only their own is
 * reachable.
 *
 * The work runs in `node_only/knowledge/search_action.ts`: retrieval needs a
 * PostgreSQL pool and an embedding client, which only a `'use node'` runtime
 * has. An organization with no embedding model configured is answered 409 with
 * the message that says what to configure, never an empty result — a silent
 * empty answer would read as "nothing is known" instead of "nothing was
 * searched".
 */

import { internal } from '../_generated/api';
import {
  jsonOk,
  optionalEnum,
  optionalNumber,
  readJsonObject,
  requiredString,
  withRestAuth,
} from '../lib/rest/helpers';

/** Bounds mirrored from the node action, so an out-of-range ask is refused
 * before an action is even started. */
const MAX_QUERY = 2000;
const MAX_LIMIT = 50;

export const searchKnowledge = withRestAuth('rest:api', async (rc, request) => {
  const body = await readJsonObject(request);
  const query = requiredString(body, 'query', MAX_QUERY);
  const corpus = optionalEnum(body, 'corpus', [
    'documents',
    'web',
    'all',
  ] as const);
  const limit = optionalNumber(body, 'limit', { min: 1, max: MAX_LIMIT });
  const minSimilarity = optionalNumber(body, 'minSimilarity', {
    min: 0,
    max: 1,
  });

  // Deliberately ORG-WIDE — no team/project access scope: this endpoint is
  // authenticated by an organization API key, a credential that speaks for
  // the whole organization, not for one member's visibility. The scoped
  // surfaces are the chat tools and the sandbox workspace bridge, which
  // derive a caller-specific `access` server-side.
  const result = await rc.ctx.runAction(
    internal.node_only.knowledge.search_action.searchOrgKnowledge,
    {
      organizationId: rc.org.organizationId,
      orgSlug: rc.org.orgSlug,
      query,
      ...(corpus !== undefined && { corpus }),
      ...(limit !== undefined && { limit }),
      ...(minSimilarity !== undefined && { minSimilarity }),
    },
  );
  return jsonOk(result);
});
