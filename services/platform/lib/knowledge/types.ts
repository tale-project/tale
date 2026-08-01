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
}

/** A hit after fusion, carrying the rank-based score it was ordered by. */
export interface FusedKnowledgeHit extends KnowledgeHit {
  /** Reciprocal-rank-fusion score. Comparable across legs; the leg scores are
   * not. */
  readonly fusedScore: number;
  /** Set only when a reranker ran and scored this hit. */
  readonly rerankScore?: number;
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
