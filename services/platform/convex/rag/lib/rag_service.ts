'use node';

/**
 * Main RAG service orchestrator.
 *
 * All public methods take `org_slug` first so the SQL layer scopes by org and
 * the per-org LLM/embedding/vision clients load from THAT org's provider
 * catalog. Per-org client state is built lazily and cached for
 * `CONFIG_CHECK_INTERVAL` seconds, with an LRU bound + per-org build locks.
 *
 * Embedding dimensions are global (one vector column). The first org to
 * initialize pins the value; a disagreeing org raises loudly.
 */

import OpenAI from 'openai';
import type { Sql } from 'postgres';

import {
  getEmbeddingConfig,
  getVisionConfig,
} from '../../lib/knowledge/config/base';
import {
  closeKnowledgePool,
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
  resolveKnowledgeUrlForOrg,
} from '../../lib/knowledge/db/knowledge_db';
import { pinEmbeddingDimensions } from '../../lib/knowledge/db/pin_embedding_dimensions';
import { withRetry } from '../../lib/knowledge/db/retry';
import { EmbeddingService } from '../../lib/knowledge/embedding/service';
import type { EmbeddingUsage } from '../../lib/knowledge/embedding/service';
import { extractText } from '../../lib/knowledge/extraction/router';
import { logger } from '../../lib/knowledge/logger';
import { VisionClient } from '../../lib/knowledge/vision/client';
import { getLlmConfig, type LlmConfig, settings } from './config';
import { computeDiff, type DiffResultDict } from './diff_service';
import { indexDocument } from './indexing_service';
import {
  RagSearchService,
  type MetadataFilterValue,
  type SearchResultRow,
} from './search_service';

const RAG_TOP_K = 30;
const RAG_TEMPERATURE = 0.3;
const RAG_MAX_TOKENS = 2000;
const RAG_MAX_CONTEXT_CHARS = 200_000;
const CONFIG_CHECK_INTERVAL_MS = 15_000;
const ORG_LOCKS_MAX = 256;
const MAX_CHUNK_WINDOW = 200;

const SYSTEM_PROMPT =
  'You are a knowledgeable assistant that provides accurate answers based on the provided context. ' +
  'Instructions:\n' +
  '1. Answer the question using ONLY the information from the context\n' +
  '2. If the context contains specific details (numbers, dates, names), include them\n' +
  "3. If the context doesn't contain relevant information, clearly state that\n" +
  "4. Respond in the same language as the user's question\n" +
  '5. Be concise but thorough';

interface OrgClients {
  llmConfig: LlmConfig;
  embeddingService: EmbeddingService;
  openaiClient: OpenAI;
  visionClient: VisionClient | null;
  searchService: RagSearchService;
  /** The org's resolved knowledge pool (BYO or deployment default). */
  sql: Sql;
  /** The connection string `sql` is bound to — the dimension-pin key. */
  dbUrl: string;
  lastCheck: number;
}

export interface DocumentContentResult {
  file_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
  source_created_at: Date | null;
  source_modified_at: Date | null;
  chunks?: { index: number; content: string }[];
}

export interface DocumentStatusRecord {
  status: string;
  error: string | null;
  progress_phase: string | null;
  progress_detail: string | null;
  source_created_at: Date | null;
  source_modified_at: Date | null;
  ocr_applied: boolean | null;
}

export interface DeleteResult {
  success: boolean;
  message: string;
  deleted_count: number;
  deleted_data_ids: string[];
  processing_time_ms: number;
}

export interface GenerateResult {
  success: boolean;
  response: string;
  sources: SearchResultRow[];
  processing_time_ms: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    model: string;
  };
}

export interface CompareResult extends Partial<DiffResultDict> {
  success?: boolean;
  base_document?: { file_id: string | null; title: string | null };
  comparison_document?: { file_id: string | null; title: string | null };
  error?: string;
  role?: string;
  file_id?: string;
}

/** An ordered map with O(1) move-to-end, mirroring Python's OrderedDict LRU. */
class LruMap<V> {
  private readonly map = new Map<string, V>();

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    this.map.set(key, value);
  }

  moveToEnd(key: string): void {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
  }

  get size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  popOldest(): [string, V] | undefined {
    const first = this.map.entries().next();
    if (first.done) {
      return undefined;
    }
    const [key, value] = first.value;
    this.map.delete(key);
    return [key, value];
  }

  entries(): [string, V][] {
    return [...this.map.entries()];
  }

  clear(): void {
    this.map.clear();
  }
}

/** A simple async mutex. */
class AsyncLock {
  private locked = false;
  private readonly waiters: (() => void)[] = [];

  isLocked(): boolean {
    return this.locked;
  }

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.locked = true;
  }

  release(): void {
    this.locked = false;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export class RagService {
  initialized = false;
  private readonly initLock = new AsyncLock();
  /**
   * Pinned embedding dimensions PER connection string, so each knowledge DB
   * (default + every BYO) pins its own single vector column independently.
   */
  private readonly pinnedDimsByUrl = new Map<string, number>();
  private readonly pinDimLocks = new Map<string, AsyncLock>();
  private readonly orgClients = new LruMap<OrgClients>();
  private readonly orgLocks = new LruMap<AsyncLock>();
  private shuttingDown = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.initLock.run(async () => {
      if (this.initialized) {
        return;
      }
      this.shuttingDown = false;
      this.initialized = true;
      logger.info(
        'RagService initialized (per-org DB pools + clients resolved lazily)',
      );
    });
  }

  /**
   * Resolve the `private_knowledge` pool for an org (BYO or deployment default),
   * bootstrapping a fresh BYO schema on first touch. Used by the read/delete
   * paths that don't need the per-org LLM clients.
   */
  private async getSqlForOrg(orgSlug: string): Promise<Sql> {
    if (this.shuttingDown) {
      throw new Error('RagService is shutting down');
    }
    if (!this.initialized) {
      await this.initialize();
    }
    return getKnowledgePoolForOrg(orgSlug);
  }

  private getPinDimLock(dbUrl: string): AsyncLock {
    const existing = this.pinDimLocks.get(dbUrl);
    if (existing) {
      return existing;
    }
    const lock = new AsyncLock();
    this.pinDimLocks.set(dbUrl, lock);
    return lock;
  }

  /**
   * Pin the embedding dimensions for a knowledge DB (keyed by connection
   * string). The first org to initialize a given DB pins its dims; a later org
   * on the SAME DB with different dims raises loudly. Orgs on different DBs pin
   * independently.
   */
  private async pinDimsForUrl(
    dbUrl: string,
    sql: Sql,
    dims: number,
    orgSlug: string,
  ): Promise<void> {
    await this.getPinDimLock(dbUrl).run(async () => {
      const pinned = this.pinnedDimsByUrl.get(dbUrl);
      if (pinned === undefined) {
        await pinEmbeddingDimensions(sql, SCHEMA, dims);
        this.pinnedDimsByUrl.set(dbUrl, dims);
        logger.info(
          `Pinned RAG embedding dimensions to ${dims} for this knowledge DB ` +
            `(set by org '${orgSlug}')`,
        );
      } else if (dims !== pinned) {
        throw new Error(
          `Org '${orgSlug}' embedding dimensions (${dims}) do not match the ` +
            `pinned dimensions (${pinned}) of its knowledge database. All orgs ` +
            `sharing one knowledge database must use the same embedding model ` +
            `dimensions. Reconcile provider configs or give the org its own ` +
            `knowledge database.`,
        );
      }
    });
  }

  private getOrgLock(orgSlug: string): AsyncLock {
    const existing = this.orgLocks.get(orgSlug);
    if (existing) {
      this.orgLocks.moveToEnd(orgSlug);
      return existing;
    }
    if (this.orgLocks.size >= ORG_LOCKS_MAX) {
      for (const key of this.orgLocks.keys()) {
        const candidate = this.orgLocks.get(key);
        if (candidate && !candidate.isLocked()) {
          this.orgLocks.delete(key);
          break;
        }
      }
    }
    const lock = new AsyncLock();
    this.orgLocks.set(orgSlug, lock);
    return lock;
  }

  private async ensureOrgClients(orgSlug: string): Promise<OrgClients> {
    if (this.shuttingDown) {
      throw new Error('RagService is shutting down');
    }
    if (!this.initialized) {
      await this.initialize();
    }

    const cached = this.orgClients.get(orgSlug);
    if (cached) {
      const now = performance.now();
      if (now - cached.lastCheck < CONFIG_CHECK_INTERVAL_MS) {
        this.orgClients.moveToEnd(orgSlug);
        return cached;
      }
    }

    const lock = this.getOrgLock(orgSlug);
    return lock.run(async () => {
      const recheck = this.orgClients.get(orgSlug);
      if (recheck) {
        const now = performance.now();
        if (now - recheck.lastCheck < CONFIG_CHECK_INTERVAL_MS) {
          this.orgClients.moveToEnd(orgSlug);
          return recheck;
        }
      }
      return this.buildOrRefreshOrgClients(orgSlug, recheck ?? null);
    });
  }

  private async buildOrRefreshOrgClients(
    orgSlug: string,
    previous: OrgClients | null,
  ): Promise<OrgClients> {
    const llmConfig = getLlmConfig(settings, orgSlug);
    const dbUrl = await resolveKnowledgeUrlForOrg(orgSlug);
    if (
      previous &&
      previous.dbUrl === dbUrl &&
      configEqual(llmConfig, previous.llmConfig)
    ) {
      previous.lastCheck = performance.now();
      return previous;
    }

    if (!llmConfig.apiKey || !llmConfig.embeddingApiKey) {
      if (previous) {
        logger.warn(
          `Skipping LLM config reload for org '${orgSlug}': empty API key`,
        );
        previous.lastCheck = performance.now();
        return previous;
      }
      throw new Error(
        `Org '${orgSlug}' has empty chat or embedding API key in provider config.`,
      );
    }

    const embeddingModel = getEmbeddingConfig(orgSlug);
    const dims = embeddingModel.dimensions;

    const sql = await getKnowledgePoolForOrg(orgSlug);
    await this.pinDimsForUrl(dbUrl, sql, dims, orgSlug);

    const embeddingService = new EmbeddingService(
      llmConfig.embeddingApiKey,
      llmConfig.embeddingBaseUrl,
      llmConfig.embeddingModel,
      dims,
    );
    const openaiClient = new OpenAI({
      apiKey: llmConfig.apiKey,
      baseURL: llmConfig.baseUrl,
      timeout: 120_000,
    });

    let visionClient: VisionClient | null = null;
    try {
      const vision = getVisionConfig(orgSlug);
      if (vision.apiKey) {
        visionClient = new VisionClient(vision.apiKey, vision.modelId, {
          baseUrl: vision.baseUrl,
          timeout: 120.0,
          requestTimeout: settings.vision_request_timeout,
          maxConcurrentPages: settings.vision_max_concurrent_pages,
          pdfDpi: settings.vision_pdf_dpi,
          ocrPrompt: settings.vision_extraction_prompt ?? undefined,
        });
        logger.info(
          `Vision client initialized for org '${orgSlug}' with model ${vision.modelId}`,
        );
      }
    } catch {
      logger.debug(
        `No vision model configured for org '${orgSlug}', Vision disabled`,
      );
    }

    const searchService = new RagSearchService(sql, embeddingService);

    const newClients: OrgClients = {
      llmConfig,
      embeddingService,
      openaiClient,
      visionClient,
      searchService,
      sql,
      dbUrl,
      lastCheck: performance.now(),
    };
    this.orgClients.set(orgSlug, newClients);
    this.orgClients.moveToEnd(orgSlug);

    while (this.orgClients.size > ORG_LOCKS_MAX) {
      const victim = this.orgClients.popOldest();
      if (!victim) {
        break;
      }
      const [victimKey, victimClients] = victim;
      if (victimKey === orgSlug) {
        this.orgClients.set(victimKey, victimClients);
        break;
      }
    }

    logger.info(
      `RAG clients ${previous ? 'refreshed' : 'initialized'} for org '${orgSlug}': model=${llmConfig.model}`,
    );
    return newClients;
  }

  async addDocument(
    orgSlug: string,
    content: Uint8Array,
    fileId: string,
    filename: string,
    options: {
      sourceCreatedAt?: Date | null;
      sourceModifiedAt?: Date | null;
    } = {},
  ) {
    const clients = await this.ensureOrgClients(orgSlug);
    return indexDocument(clients.sql, orgSlug, fileId, content, filename, {
      embeddingService: clients.embeddingService,
      visionClient: clients.visionClient,
      chunkSize: settings.chunk_size,
      chunkOverlap: settings.chunk_overlap,
      sourceCreatedAt: options.sourceCreatedAt,
      sourceModifiedAt: options.sourceModifiedAt,
    });
  }

  async search(
    orgSlug: string,
    query: string,
    options: {
      topK?: number | null;
      similarityThreshold?: number | null;
      fileIds?: string[] | null;
      folderPath?: string | null;
      metadataFilters?: Record<string, MetadataFilterValue> | null;
    } = {},
  ): Promise<[SearchResultRow[], EmbeddingUsage]> {
    const clients = await this.ensureOrgClients(orgSlug);

    const effectiveTopK = options.topK != null ? options.topK : settings.top_k;
    const threshold =
      options.similarityThreshold != null
        ? options.similarityThreshold
        : settings.similarity_threshold;

    let [results, usage] = await clients.searchService.search(orgSlug, query, {
      fileIds: options.fileIds,
      folderPath: options.folderPath,
      metadataFilters: options.metadataFilters,
      topK: effectiveTopK,
      similarityThreshold: threshold,
    });

    if (results.length === 0 && options.fileIds && options.fileIds.length > 0) {
      const statuses = await this.getDocumentStatuses(orgSlug, options.fileIds);
      const hasProcessing = Object.values(statuses).some(
        (s) => s !== null && s.status === 'processing',
      );
      if (hasProcessing) {
        logger.info('No results and some files still indexing, retrying in 3s');
        await new Promise((resolve) => setTimeout(resolve, 3000));
        [results, usage] = await clients.searchService.search(orgSlug, query, {
          fileIds: options.fileIds,
          folderPath: options.folderPath,
          metadataFilters: options.metadataFilters,
          topK: effectiveTopK,
          similarityThreshold: threshold,
        });
      }
    }

    return [results, usage];
  }

  async generate(
    orgSlug: string,
    query: string,
    fileIds: string[] | null = null,
  ): Promise<GenerateResult> {
    const clients = await this.ensureOrgClients(orgSlug);

    const startTime = performance.now();
    const [searchResults, embeddingUsage] = await this.search(orgSlug, query, {
      topK: RAG_TOP_K,
      fileIds,
    });

    if (searchResults.length === 0) {
      return {
        success: false,
        response:
          'No relevant information found in the knowledge base. ' +
          'Please add documents first using the /api/v1/documents endpoint.',
        sources: [],
        processing_time_ms: 0,
      };
    }

    const contextParts: string[] = [];
    let totalChars = 0;
    let idx = 0;
    for (const result of searchResults) {
      idx += 1;
      const content = result.content || '';
      if (!content) {
        continue;
      }
      const part = `[${idx}] ${content}`;
      if (totalChars + part.length > RAG_MAX_CONTEXT_CHARS) {
        logger.warn(
          `Context truncated at ${totalChars} chars, used ${contextParts.length}/${searchResults.length} chunks`,
        );
        break;
      }
      contextParts.push(part);
      totalChars += part.length + 2;
    }

    const context = contextParts.join('\n\n');
    const userMessage = `Context:\n${context}\n\nQuestion: ${query}`;
    const llmConfig = clients.llmConfig;

    const completion = await clients.openaiClient.chat.completions.create({
      model: llmConfig.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: RAG_TEMPERATURE,
      max_tokens: RAG_MAX_TOKENS,
    });

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('LLM returned empty choices array');
    }
    const response = completion.choices[0].message.content ?? '';

    const processingTime = performance.now() - startTime;
    logger.info(`Generation completed in ${processingTime.toFixed(2)}ms`);

    const embeddingTokens = embeddingUsage ? embeddingUsage.promptTokens : 0;
    const llmInput = completion.usage ? completion.usage.prompt_tokens : 0;
    const llmOutput = completion.usage ? completion.usage.completion_tokens : 0;

    return {
      success: true,
      response,
      sources: searchResults,
      processing_time_ms: processingTime,
      usage: {
        input_tokens: embeddingTokens + llmInput,
        output_tokens: llmOutput,
        total_tokens: embeddingTokens + llmInput + llmOutput,
        model: llmConfig.model,
      },
    };
  }

  async getDocumentContent(
    orgSlug: string,
    fileId: string,
    options: {
      chunkStart?: number;
      chunkEnd?: number | null;
      returnChunks?: boolean;
    } = {},
  ): Promise<DocumentContentResult | null> {
    const sql = await this.getSqlForOrg(orgSlug);

    const chunkStart = options.chunkStart ?? 1;
    const chunkEnd = options.chunkEnd ?? chunkStart + MAX_CHUNK_WINDOW - 1;
    const returnChunks = options.returnChunks ?? false;

    const docRows = await withRetry(() =>
      sql.unsafe<
        {
          id: string;
          file_id: string;
          filename: string;
          chunks_count: number;
          source_created_at: Date | null;
          source_modified_at: Date | null;
        }[]
      >(
        `SELECT id, file_id, filename, chunks_count,
                source_created_at, source_modified_at
         FROM ${SCHEMA}.documents
         WHERE org_slug = $1 AND file_id = $2
         LIMIT 1`,
        [orgSlug, fileId],
      ),
    );
    const doc = docRows[0];
    if (!doc) {
      return null;
    }

    const rows = await withRetry(() =>
      sql.unsafe<
        {
          chunk_index: number;
          chunk_content: string;
          core_content: string | null;
        }[]
      >(
        `SELECT chunk_index, chunk_content, core_content
         FROM ${SCHEMA}.chunks
         WHERE org_slug = $1 AND document_id = $2
           AND chunk_index >= $3 AND chunk_index <= $4
         ORDER BY chunk_index ASC`,
        [orgSlug, doc.id, chunkStart - 1, chunkEnd - 1],
      ),
    );

    if (rows.length === 0) {
      return {
        file_id: fileId,
        title: doc.filename,
        content: '',
        chunk_range: { start: 0, end: 0 },
        total_chunks: doc.chunks_count,
        total_chars: 0,
        source_created_at: doc.source_created_at,
        source_modified_at: doc.source_modified_at,
      };
    }

    const allMigrated = rows.every((row) => Boolean(row.core_content));
    const combined = allMigrated
      ? rows.map((row) => row.core_content ?? '').join('')
      : rows.map((row) => row.chunk_content).join('\n\n');

    const actualStart = rows[0].chunk_index + 1;
    const actualEnd = rows[rows.length - 1].chunk_index + 1;

    const result: DocumentContentResult = {
      file_id: fileId,
      title: doc.filename,
      content: combined,
      chunk_range: { start: actualStart, end: actualEnd },
      total_chunks: doc.chunks_count,
      total_chars: combined.length,
      source_created_at: doc.source_created_at,
      source_modified_at: doc.source_modified_at,
    };

    if (returnChunks) {
      result.chunks = rows.map((row) => ({
        index: row.chunk_index + 1,
        content: allMigrated ? (row.core_content ?? '') : row.chunk_content,
      }));
    }

    return result;
  }

  async getDocumentStatuses(
    orgSlug: string,
    fileIds: string[],
  ): Promise<Record<string, DocumentStatusRecord | null>> {
    const sql = await this.getSqlForOrg(orgSlug);

    const rows = await withRetry(() =>
      sql.unsafe<
        {
          file_id: string;
          status: string;
          error: string | null;
          progress_phase: string | null;
          progress_detail: string | null;
          source_created_at: Date | null;
          source_modified_at: Date | null;
          ocr_applied: boolean | null;
        }[]
      >(
        `SELECT DISTINCT ON (file_id)
            file_id, status, error, progress_phase, progress_detail,
            source_created_at, source_modified_at, ocr_applied
         FROM ${SCHEMA}.documents
         WHERE org_slug = $1 AND file_id = ANY($2)
         ORDER BY file_id,
            CASE status
                WHEN 'processing' THEN 0
                WHEN 'failed' THEN 1
                WHEN 'completed' THEN 2
                ELSE 3
            END,
            updated_at DESC`,
        [orgSlug, fileIds],
      ),
    );

    const found = new Map<string, DocumentStatusRecord>();
    for (const row of rows) {
      found.set(row.file_id, {
        status: row.status,
        error: row.error,
        progress_phase: row.progress_phase,
        progress_detail: row.progress_detail,
        source_created_at: row.source_created_at,
        source_modified_at: row.source_modified_at,
        ocr_applied: row.ocr_applied,
      });
    }

    const result: Record<string, DocumentStatusRecord | null> = {};
    for (const fid of fileIds) {
      result[fid] = found.get(fid) ?? null;
    }
    return result;
  }

  async deleteDocument(orgSlug: string, fileId: string): Promise<DeleteResult> {
    const sql = await this.getSqlForOrg(orgSlug);
    const startTime = performance.now();

    const rows = await withRetry(() =>
      sql.unsafe<{ id: string }[]>(
        `SELECT id FROM ${SCHEMA}.documents WHERE org_slug = $1 AND file_id = $2`,
        [orgSlug, fileId],
      ),
    );

    if (rows.length === 0) {
      return {
        success: true,
        message: `No documents found with ID '${fileId}'`,
        deleted_count: 0,
        deleted_data_ids: [],
        processing_time_ms: performance.now() - startTime,
      };
    }

    const idsToDelete = rows.map((row) => row.id);

    await withRetry(() =>
      sql.begin(async (tx) => {
        await tx.unsafe(
          `DELETE FROM ${SCHEMA}.chunks WHERE org_slug = $1 AND document_id = ANY($2)`,
          [orgSlug, idsToDelete],
        );
        await tx.unsafe(
          `DELETE FROM ${SCHEMA}.documents WHERE org_slug = $1 AND id = ANY($2)`,
          [orgSlug, idsToDelete],
        );
      }),
    );

    return {
      success: true,
      message: `Deleted ${idsToDelete.length} document(s) with ID '${fileId}'`,
      deleted_count: idsToDelete.length,
      deleted_data_ids: idsToDelete,
      processing_time_ms: performance.now() - startTime,
    };
  }

  async compareDocuments(
    orgSlug: string,
    baseFileId: string,
    comparisonFileId: string,
    maxChanges = 500,
  ): Promise<CompareResult | null> {
    const [base, comp] = await Promise.all([
      this.getDocumentContent(orgSlug, baseFileId),
      this.getDocumentContent(orgSlug, comparisonFileId),
    ]);

    if (base === null) {
      return { error: 'not_found', file_id: baseFileId, role: 'base' };
    }
    if (comp === null) {
      return {
        error: 'not_found',
        file_id: comparisonFileId,
        role: 'comparison',
      };
    }

    const diffResult = computeDiff(base.content, comp.content, { maxChanges });
    return {
      ...diffResult,
      success: true,
      base_document: { file_id: baseFileId, title: base.title },
      comparison_document: { file_id: comparisonFileId, title: comp.title },
    };
  }

  async compareFiles(
    orgSlug: string,
    baseBytes: Uint8Array,
    baseFilename: string,
    comparisonBytes: Uint8Array,
    comparisonFilename: string,
    maxChanges = 500,
  ): Promise<CompareResult> {
    const clients = await this.ensureOrgClients(orgSlug);

    const t0 = performance.now();
    const [[baseText], [compText]] = await Promise.all([
      extractText(baseBytes, baseFilename, {
        visionClient: clients.visionClient,
      }),
      extractText(comparisonBytes, comparisonFilename, {
        visionClient: clients.visionClient,
      }),
    ]);

    logger.info(
      `Parallel text extraction completed in ${(performance.now() - t0).toFixed(1)}ms`,
    );

    if (!baseText || !baseText.trim()) {
      throw new ValueError(
        `No text could be extracted from base file: ${baseFilename}`,
      );
    }
    if (!compText || !compText.trim()) {
      throw new ValueError(
        `No text could be extracted from comparison file: ${comparisonFilename}`,
      );
    }

    const diffResult = computeDiff(baseText, compText, { maxChanges });
    return {
      ...diffResult,
      success: true,
      base_document: { file_id: null, title: baseFilename },
      comparison_document: { file_id: null, title: comparisonFilename },
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    for (const [orgSlug, clients] of this.orgClients.entries()) {
      try {
        // EmbeddingService/VisionClient wrap an OpenAI client; there is no
        // explicit close in the JS SDK, so this is a structural no-op kept
        // for parity. Errors are logged, never thrown.
        void clients;
      } catch (err) {
        logger.warn(
          `Failed to close clients for org '${orgSlug}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.orgClients.clear();
    this.pinnedDimsByUrl.clear();
    this.pinDimLocks.clear();

    await closeKnowledgePool();
    this.initialized = false;
  }
}

/** A 422-mapped error for unextractable comparison files. */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

function configEqual(a: LlmConfig, b: LlmConfig): boolean {
  return (
    a.model === b.model &&
    a.embeddingModel === b.embeddingModel &&
    a.apiKey === b.apiKey &&
    a.baseUrl === b.baseUrl &&
    a.embeddingApiKey === b.embeddingApiKey &&
    a.embeddingBaseUrl === b.embeddingBaseUrl &&
    a.maxTokens === b.maxTokens &&
    a.temperature === b.temperature
  );
}

/** Module-level singleton. */
export const ragService = new RagService();
