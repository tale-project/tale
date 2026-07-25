/**
 * The knowledge core: chunking, retrieval, and the seams around them.
 *
 * Everything exported here is free of Node built-ins, Convex, and Postgres, so
 * the same modules run in a Convex V8 function, a Convex node action, and a
 * plain unit test. The parts that need a database live in
 * `convex/knowledge/`, which implements this module's seams —
 * {@link CorpusReader}, {@link QueryEmbedder}, {@link KnowledgeReranker},
 * {@link KnowledgeCache}, {@link KnowledgeSearchBackend} — and never the other
 * way round.
 *
 * Retrieval is reachable exactly two ways: the `knowledge.search` automation node
 * registered here, and the chat capability that calls
 * `convex/knowledge/search.ts`. Nothing injects knowledge into a prompt on its
 * own.
 */

export {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  chunkDocument,
  HEADER_SEPARATOR,
  reassemble,
  type ChunkOptions,
  type ContextualChunk,
} from './chunking';
export {
  KNOWLEDGE_CONFIG_DOMAIN,
  KNOWLEDGE_CONNECTION_KEY,
  KNOWLEDGE_EMBEDDING_KEY,
  knowledgeConnectionSchema,
  knowledgeConnectionSecretsSchema,
  knowledgeEmbeddingSchema,
  type KnowledgeConnection,
  type KnowledgeConnectionSecrets,
  type KnowledgeEmbeddingConfig,
} from './config';
export { fuseByRank, RRF_K, type FuseOptions, type FusedItem } from './fusion';
export {
  planIngest,
  sliceToStore,
  type IngestPlan,
  type IngestPlanInput,
  type StoredDocumentState,
} from './ingest-plan';
export { logger } from './logger';
export {
  knowledgeCache,
  setKnowledgeCache,
  type CacheKey,
  type KnowledgeCache,
} from './cache';
export {
  knowledgeReranker,
  setKnowledgeReranker,
  type KnowledgeReranker,
  type RerankCandidate,
  type RerankedCandidate,
} from './rerank';
export {
  CANDIDATE_FACTOR,
  clampLimit,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  retrieve,
  type CorpusLegQuery,
  type CorpusReader,
  type QueryEmbedder,
  type RetrieveDeps,
} from './retrieve';
export {
  entropyPerChar,
  isPlaceholder,
  scanForSecrets,
  type SecretScanResult,
} from './secret-scan';
export {
  KNOWLEDGE_SEARCH_NODE_TYPE,
  knowledgeSearchBackend,
  mockKnowledgeSearch,
  registerKnowledgeSearchNode,
  setKnowledgeSearchBackend,
  toNodeOutput,
  type KnowledgeSearchBackend,
  type KnowledgeSearchHit,
  type KnowledgeSearchInput,
  type KnowledgeSearchOutput,
} from './search-node';
export {
  corporaFor,
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
  type EmbeddingModel,
  type FusedKnowledgeHit,
  type KnowledgeCorpus,
  type KnowledgeDiagnostics,
  type KnowledgeHit,
  type KnowledgeQuery,
  type KnowledgeResult,
  type KnowledgeSource,
} from './types';
