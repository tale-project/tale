/**
 * The reranking seam — OFF by default, and a seam rather than a model.
 *
 * A reranker reads the query and each candidate together and scores their
 * actual relevance, which fusion cannot do: fusion only knows where each leg
 * put a result, never why. That extra pass is worth real quality on capable
 * models, and it costs a second round trip per search plus a dependency on a
 * cross-encoder endpoint that many deployments do not have.
 *
 * So nothing here names a model, a vendor, or an endpoint. A deployment that
 * wants reranking installs an implementation of {@link KnowledgeReranker}; a
 * deployment that does not gets the fused ranking, which is already the
 * never-worst strategy. Retrieval asks {@link knowledgeReranker} and skips the
 * pass when the answer is `null` — there is no "default reranker" to fall back
 * to and therefore no way for one to be switched on by accident.
 *
 * A reranker that fails is not allowed to fail the search: retrieval logs the
 * failure and returns the fused order, because a slightly worse ranking beats
 * no answer.
 */

/** One candidate handed to a reranker. */
export interface RerankCandidate {
  /** Stable identity, so the implementation can return an order rather than
   * copies of the payload. */
  readonly id: string;
  /** The text to judge against the query — the chunk as a reader sees it,
   * contextual header included. */
  readonly text: string;
}

export interface RerankedCandidate {
  readonly id: string;
  /** Relevance as the reranker scored it. Higher is better; the scale is the
   * implementation's own and is never compared across implementations. */
  readonly score: number;
}

/**
 * What retrieval needs from a reranker.
 *
 * Contract: return at most `topK` entries, ordered best first, each `id` drawn
 * from `candidates`. Retrieval drops ids it does not recognize rather than
 * trusting them — the implementation may be a remote service, and a search must
 * not be able to surface a chunk the corpus query did not authorize.
 */
export interface KnowledgeReranker {
  readonly name: string;
  rerank(args: {
    readonly query: string;
    readonly candidates: readonly RerankCandidate[];
    readonly topK: number;
  }): Promise<readonly RerankedCandidate[]>;
}

let installed: KnowledgeReranker | null = null;

/** Install a reranker for this process. Retrieval starts using it on the next
 * search. */
export function setKnowledgeReranker(reranker: KnowledgeReranker | null): void {
  installed = reranker;
}

/** The installed reranker, or `null` — the default, which means retrieval
 * returns the fused ranking untouched. */
export function knowledgeReranker(): KnowledgeReranker | null {
  return installed;
}
