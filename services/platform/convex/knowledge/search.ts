'use node';

/**
 * The one entry point into knowledge retrieval.
 *
 * Everything that retrieves — the chat capability `get_knowledge`, the
 * automation node `knowledge.search`, the REST endpoint
 * `POST /api/v1/knowledge/search` — calls {@link searchKnowledge}. Nothing else does,
 * because there is nothing else: knowledge is never injected into a prompt on
 * its own. That was removed deliberately. Automatic injection spent context on
 * every turn whether the question needed knowledge or not, it made an answer
 * depend on a retrieval nobody had asked for, and it left no trace of what had
 * actually been read. As a tool and a node, retrieval is a visible act with a
 * visible result.
 *
 * ## Calling it from the chat capability surface
 *
 * The `get_knowledge` capability's backend is exactly:
 *
 * ```ts
 * import { searchKnowledge } from '../knowledge/search';
 *
 * const result = await searchKnowledge(ctx, {
 *   organizationId,   // the Convex organization id, for the credential
 *   orgSlug,          // the slug, for the corpus
 *   query,            // what the user asked
 *   corpus: 'all',    // or 'documents' / 'web'
 *   limit: 10,
 * });
 * ```
 *
 * It returns hits plus diagnostics; a capability renders the hits and can say
 * "searched without the keyword index" when `diagnostics.bm25` is false rather
 * than silently presenting a degraded search as a complete one.
 *
 * ## What this module assembles
 *
 * Resolving the organization's pool, its embedding model, and its corpus
 * readers, then handing them to the pure retrieval core. Both organization
 * identifiers are required and mean different things — `organizationId`
 * addresses the credential, `orgSlug` addresses the corpus — and neither is
 * derived from the other here, so a caller cannot accidentally search one
 * organization's corpus with another's credential.
 */

import { retrieve, type CorpusReader } from '../../lib/knowledge/retrieve';
import type {
  KnowledgeSearchBackend,
  KnowledgeSearchInput,
} from '../../lib/knowledge/search-node';
import {
  PRIVATE_KNOWLEDGE_SCHEMA,
  corporaFor,
  type KnowledgeQuery,
  type KnowledgeResult,
} from '../../lib/knowledge/types';
import type { KnowledgeEmbeddingConfig } from '../../lib/shared/schemas/knowledge';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { readOrgEmbeddingConfig } from './connection';
import { DocumentCorpusReader, WebCorpusReader } from './corpus';
import { pinDimensions } from './dimensions';
import { embedderForOrg } from './embedding';
import { getKnowledgePoolForOrg, resolveOrgUrl } from './pool';

/** Which organization a search runs for. Both identifiers are required: one
 * addresses the credential, the other addresses the corpus. */
export interface KnowledgeOrg {
  /** The Convex organization id — resolves the embedding credential. */
  readonly organizationId: string;
  /** The organization slug — resolves the corpus and scopes every row. */
  readonly orgSlug: string;
}

export type SearchKnowledgeArgs = KnowledgeOrg & KnowledgeQuery;

/**
 * Search an organization's knowledge.
 *
 * Refuses rather than guesses when the organization has no embedding model
 * configured, and refuses rather than falls back when its own database is
 * configured but unusable.
 */
export async function searchKnowledge(
  ctx: ActionCtx,
  args: SearchKnowledgeArgs,
): Promise<KnowledgeResult> {
  const config = await readOrgEmbeddingConfig(args.orgSlug);
  const { readers, embedder } = await bindOrg(ctx, args, config);
  const result = await retrieve(
    { readers, embedder, orgSlug: args.orgSlug },
    {
      query: args.query,
      ...(args.corpus !== undefined && { corpus: args.corpus }),
      ...(args.limit !== undefined && { limit: args.limit }),
      ...(args.refs !== undefined && { refs: args.refs }),
      ...(args.folder !== undefined && { folder: args.folder }),
      // The caller surface derives this server-side (never from a sandbox or
      // user request); absent means org-wide — the admin-keyed surfaces.
      ...(args.access !== undefined && { access: args.access }),
      ...(args.minSimilarity !== undefined && {
        minSimilarity: args.minSimilarity,
      }),
    },
  );
  const documentRefs = [
    ...new Set(
      result.hits
        .filter((hit) => hit.corpus === 'documents')
        .map((hit) => hit.source.ref),
    ),
  ];
  if (documentRefs.length === 0) return result;

  // The SQL row is a projection. Re-check the current Convex document/file,
  // completion, lifecycle, scope, and folder before returning any private hit.
  // This also filters semantic-cache hits, which can outlive a replacement.
  const retrievable = await ctx.runQuery(
    internal.documents.internal_queries.filterRetrievableRagFileIds,
    {
      organizationId: args.organizationId,
      fileIds: documentRefs,
      ...(args.access?.userId !== undefined
        ? { userId: args.access.userId }
        : {}),
      ...(args.access !== undefined
        ? {
            access: {
              teamIds: [...args.access.teamIds],
              projectIds: [...args.access.projectIds],
              includeHub: args.access.includeHub,
              ...(args.access.includeConversationScoped !== undefined
                ? {
                    includeConversationScoped:
                      args.access.includeConversationScoped,
                  }
                : {}),
              ...(args.access.threadIds !== undefined
                ? { threadIds: [...args.access.threadIds] }
                : {}),
            },
          }
        : {}),
      ...(args.folder !== undefined ? { folder: args.folder } : {}),
    },
  );
  const allowed = new Set(retrievable);
  return {
    ...result,
    hits: result.hits.filter(
      (hit) => hit.corpus !== 'documents' || allowed.has(hit.source.ref),
    ),
  };
}

/**
 * A `knowledge.search` backend bound to one organization.
 *
 * An automation host installs this for the run it is executing, which is why
 * the node's own input has no organization field: the run decides whose
 * knowledge is searched, never the automation document.
 */
export function knowledgeSearchBackendFor(
  ctx: ActionCtx,
  org: KnowledgeOrg,
): KnowledgeSearchBackend {
  return {
    search: (input: KnowledgeSearchInput) =>
      searchKnowledge(ctx, { ...org, ...input }),
  };
}

/**
 * Resolve everything a search for one organization needs: its corpus pool, its
 * embedding model, and a reader per corpus.
 *
 * The pool is resolved through the per-organization chokepoint, so this is also
 * where a misconfigured bring-your-own database surfaces — as an error, never
 * as a quiet fallback to the shared corpus.
 */
async function bindOrg(
  ctx: ActionCtx,
  org: KnowledgeOrg & { readonly corpus?: KnowledgeQuery['corpus'] },
  config: KnowledgeEmbeddingConfig | null,
): Promise<{
  readers: CorpusReader[];
  embedder: Awaited<ReturnType<typeof embedderForOrg>>;
}> {
  const [sql, dbUrl, embedder] = await Promise.all([
    getKnowledgePoolForOrg(org.orgSlug),
    resolveOrgUrl(org.orgSlug),
    embedderForOrg(ctx, {
      organizationId: org.organizationId,
      orgSlug: org.orgSlug,
      config,
    }),
  ]);

  // The corpus must already store vectors of this width, or the query vector
  // would be compared against embeddings from a different model.
  await pinDimensions({
    sql,
    dbUrl,
    schema: PRIVATE_KNOWLEDGE_SCHEMA,
    dimensions: embedder.dimensions,
    context: `organization "${org.orgSlug}"`,
  });

  const wanted = new Set<string>(corporaFor(org.corpus ?? 'all'));
  const readers: CorpusReader[] = [];
  if (wanted.has('documents')) {
    readers.push(new DocumentCorpusReader(sql, org.orgSlug));
  }
  if (wanted.has('web')) readers.push(new WebCorpusReader(sql, org.orgSlug));
  return { readers, embedder };
}
