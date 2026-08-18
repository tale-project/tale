/**
 * The vocabulary the knowledge core is written in.
 *
 * Everything here is plain data with no dependency on a database, a model
 * provider, or Convex — the retrieval logic is a pure function of these shapes,
 * so it can be exercised in a unit test without a ParadeDB anywhere near it.
 */

/**
 * The two corpora a knowledge database holds. They are separate PostgreSQL
 * schemas of the same database rather than separate stores because they are
 * migrated, pooled, and isolated together: an organization that brings its own
 * database brings BOTH, and nothing in either is shared across organizations.
 *
 *  - `private_knowledge` — documents the organization uploaded, their chunks,
 *    embeddings, and the optional semantic cache.
 *  - `public_web`        — pages fetched from the web on the organization's
 *    behalf, chunked and embedded the same way.
 */
export const PRIVATE_KNOWLEDGE_SCHEMA = 'private_knowledge';
export const PUBLIC_WEB_SCHEMA = 'public_web';

/** Which corpus a search reads. `all` reads both and fuses the results. */
export type KnowledgeCorpus = 'documents' | 'web' | 'all';

/** Every corpus a `KnowledgeCorpus` selector expands to. */
export function corporaFor(
  corpus: KnowledgeCorpus,
): readonly Exclude<KnowledgeCorpus, 'all'>[] {
  return corpus === 'all' ? ['documents', 'web'] : [corpus];
}

/**
 * An embedding model, stated in full.
 *
 * `dimensions` is REQUIRED and never inferred from the model name. A corpus
 * stores one vector column of one width; guessing a width that disagrees with
 * what the provider actually returns corrupts every vector written after the
 * guess, and the damage is silent until retrieval quality collapses. Making the
 * operator write the number means a disagreement is caught at configuration
 * time by {@link KnowledgeEmbeddingConfig}, and again at write time by the
 * corpus's pinned dimensions.
 */
export interface EmbeddingModel {
  /** The provider the credential belongs to, e.g. `openai`. */
  readonly providerSlug: string;
  /** The model tag as the provider spells it. */
  readonly model: string;
  /** Vector width. Declared, never derived. */
  readonly dimensions: number;
  /** OpenAI-compatible base URL, when the provider is not the default one. */
  readonly baseUrl?: string;
}

/** One chunk of one document, as retrieval returns it. */
export interface KnowledgeHit {
  /** Stable row identity within its corpus — the RRF fusion key. */
  readonly id: string;
  /** Which corpus produced it. */
  readonly corpus: Exclude<KnowledgeCorpus, 'all'>;
  /** The chunk text a caller reads, contextual header included. */
  readonly text: string;
  /** The document (or page) the chunk belongs to. */
  readonly source: KnowledgeSource;
  /** Position of the chunk inside its document. */
  readonly chunkIndex: number;
  /**
   * Character position of this passage within the full text `rag_fetch`
   * serves for the same ref — pass it as the fetch offset to read around
   * the match instead of scanning from the start. Absent when the position
   * cannot be established (legacy chunks without `core_content`, or a web
   * chunk whose slice crosses a boilerplate-stripped gap).
   */
  readonly offset?: number;
  /**
   * The leg's own relevance score — a BM25 score or a cosine similarity.
   * Scales differ per leg, which is exactly why fusion ranks rather than adds.
   */
  readonly score: number;
}

/** Where a hit came from, in terms a caller can cite. */
export interface KnowledgeSource {
  /** The organization's own id for the document; a URL for a web page. */
  readonly ref: string;
  readonly title: string | null;
  /** Present for web pages. */
  readonly url?: string | null;
  readonly modifiedAt?: number | null;
  /**
   * The project the document is filed under, from the corpus row's scope
   * stamp. Null for an org-hub document and for a web page. Carried so a
   * caller can tell whether the project is archived without a second read.
   */
  readonly projectId?: string | null;
}

/** A hit after fusion, carrying the rank-based score it was ordered by. */
export interface FusedKnowledgeHit extends KnowledgeHit {
  /** Reciprocal-rank-fusion score. Comparable across legs; the leg scores are
   * not. */
  readonly fusedScore: number;
  /** Set only when a reranker ran and scored this hit. */
  readonly rerankScore?: number;
}

/**
 * What the CALLER may see of the documents corpus — the retrieval side of the
 * document scope rules (`convex/documents/access.ts`).
 *
 * A corpus document row lives in exactly one scope: a project (`project_id`),
 * a team library (`team_ids` — the FULL list a shared document carries, with
 * `team_id` kept as a deprecated first-element mirror), or the org hub
 * (neither — including every row ingested before scoping existed, which
 * therefore keeps today's org-wide visibility until the backfill stamps it).
 * A search with an access scope returns hub rows only when `includeHub` says
 * so, plus rows sharing a team with the caller or whose project is listed.
 *
 * ABSENT means org-wide — for admin-keyed surfaces (the org REST API, the MCP
 * capability lane) whose credential already speaks for the whole organization.
 * It is derived SERVER-SIDE by the caller surface, never accepted from a
 * sandbox or user request.
 */
export interface KnowledgeAccessScope {
  /** Teams whose library documents the caller may read. */
  readonly teamIds: readonly string[];
  /** Projects whose attached documents the caller may read. */
  readonly projectIds: readonly string[];
  /** Whether org-hub documents (no team, no project) are visible. */
  readonly includeHub: boolean;
  /**
   * Which of `projectIds` are archived, for LABELLING only.
   *
   * Retrieval is unchanged by it: an archived project's documents stay
   * searchable and citable, because a retired project is often still the only
   * source on its topic. Consumers use it to mark a result as belonging to a
   * retired project, so an answer can say so. Absent reads as "none known",
   * which under-labels rather than over-filters.
   */
  readonly archivedProjectIds?: readonly string[];
  /**
   * Chat threads whose thread-bound uploads the caller may retrieve — the
   * turn's own thread, derived server-side from the owned-thread check.
   * Consumed ONLY by the Convex-truth re-check
   * (`filterRetrievableRagFileIds`): a chat upload's corpus row carries no
   * scope stamp, so the SQL side already returns it under the hub clause
   * and needs no thread leg (the mirror-encoding rule above is about
   * document scope stamps, which thread uploads never have). Absent means
   * no thread-bound uploads are retrievable — org-wide callers included:
   * a chat upload is private to its thread, never org knowledge.
   */
  readonly threadIds?: readonly string[];
}

/**
 * A document's scope stamp, in either encoding: a corpus row (`team_ids`,
 * `project_id`) or a Convex `documents` row (`teamTags`, `projectId`), plus the
 * deprecated single `teamId`.
 */
export interface DocumentScopeStamp {
  readonly teamId?: string | null;
  readonly teamIds?: readonly string[] | null;
  readonly projectId?: string | null;
}

/**
 * The teams a scope stamp names. Precedence mirrors `hasTeamAccess`
 * (`convex/lib/team_access.ts`), the listing-side truth: the full list wins
 * when present, and the single stamp is the legacy fallback — so a row written
 * before multi-team support still reads as the one team it is restricted to.
 */
export function scopeTeamIds(scope: DocumentScopeStamp): readonly string[] {
  return scope.teamIds ?? (scope.teamId != null ? [scope.teamId] : []);
}

/** Which of the three mutually exclusive scopes a stamp is in. */
export type DocumentScopeKind = 'hub' | 'teams' | 'project';

/**
 * Classify a scope stamp — the one definition of what "organization-wide"
 * means, so a label can never claim something the access rules contradict.
 *
 * A UI that re-derives this gets it wrong: `teamIds.length === 0` looks like
 * "unscoped" but is also true of every project-scoped row, and reading only
 * `teamTags` misses a row carrying the legacy single `teamId`. Both mistakes
 * render a restricted document as organization-wide, on the screen an operator
 * uses to audit exactly that. Anything showing scope to a person must call this
 * rather than test the fields itself.
 */
export function documentScopeKind(
  scope: DocumentScopeStamp,
): DocumentScopeKind {
  if (scope.projectId != null) return 'project';
  if (scopeTeamIds(scope).length > 0) return 'teams';
  return 'hub';
}

/**
 * Whether one document's scope stamp is visible under an access scope — the
 * point-read twin of the search filter (`convex/knowledge/corpus.ts` builds
 * the same disjunction into SQL; the two encodings MUST stay in agreement).
 * Used wherever a fetch already holds the row (a corpus document row, a
 * Convex `documents` row) so a scope check never costs a second read:
 *
 *  - absent access = an org-wide caller (admin-keyed surfaces) — always true;
 *  - a hub row (no teams, no project — including rows stamped before scoping
 *    existed) is visible when `includeHub` says so;
 *  - a team row is visible when the caller shares ANY of its teams —
 *    `teamIds` is the full list (a corpus row's `team_ids`, a Convex row's
 *    `teamTags`); a row carrying only the legacy single `teamId` stamp reads
 *    as a one-team list, mirroring `hasTeamAccess`
 *    (`convex/lib/team_access.ts`), the listing-side truth;
 *  - a project row is visible when its id is listed.
 */
export function knowledgeScopeAllows(
  access: KnowledgeAccessScope | undefined,
  scope: DocumentScopeStamp,
): boolean {
  if (access === undefined) return true;
  const teamIds = scopeTeamIds(scope);
  const isHub = documentScopeKind(scope) === 'hub';
  return (
    (isHub && access.includeHub) ||
    teamIds.some((teamId) => access.teamIds.includes(teamId)) ||
    (scope.projectId != null && access.projectIds.includes(scope.projectId))
  );
}

/** What a caller asks for. */
export interface KnowledgeQuery {
  readonly query: string;
  /** Defaults to `all`. */
  readonly corpus?: KnowledgeCorpus;
  /** Hits to return. */
  readonly limit?: number;
  /** Restrict to these document refs (documents corpus only). */
  readonly refs?: readonly string[];
  /** Restrict to a folder and everything under it (documents corpus only). */
  readonly folder?: string;
  /**
   * The caller's document visibility (documents corpus only; the web corpus
   * is org-level). Absent = org-wide. See {@link KnowledgeAccessScope}.
   */
  readonly access?: KnowledgeAccessScope;
  /** Drop dense hits below this cosine similarity before fusing. */
  readonly minSimilarity?: number;
}

/** What retrieval answers with. */
export interface KnowledgeResult {
  readonly hits: readonly FusedKnowledgeHit[];
  /** How the answer was produced — surfaced so a caller can tell a degraded
   * search from a healthy one instead of guessing from an empty list. */
  readonly diagnostics: KnowledgeDiagnostics;
}

export interface KnowledgeDiagnostics {
  /** False when the corpus has no BM25 index available and the search ran
   * dense-only. */
  readonly bm25: boolean;
  /** True when a reranker reordered the fused list. */
  readonly reranked: boolean;
  /** True when the answer came from the semantic cache. */
  readonly cached: boolean;
  /** Hits each leg contributed before fusion, for the two legs that ran. */
  readonly legs: Readonly<Record<string, number>>;
}
