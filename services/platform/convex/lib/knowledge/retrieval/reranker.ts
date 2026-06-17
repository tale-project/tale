'use node';

/**
 * Cross-encoder re-ranking for search results — API-only.
 *
 * The previous Python implementation supported an on-device
 * sentence-transformers path. That path is dropped: only an external rerank API
 * is supported. Constructing a Reranker with `provider === 'local'` fails fast
 * with a clear message telling the operator to set `provider: 'api'`.
 */

import { z } from 'zod';

export type RerankProvider = 'api' | 'local';

export interface RerankerOptions {
  modelName?: string;
  provider?: RerankProvider;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
}

export interface RerankableResult {
  reranking_score?: number;
  content?: string;
  core_content?: string;
  chunk_content?: string;
  [key: string]: unknown;
}

const rerankResponseSchema = z.object({
  results: z
    .array(
      z.object({
        index: z.number(),
        relevance_score: z.number().optional(),
      }),
    )
    .optional(),
});

const DEFAULT_MODEL = 'cross-encoder/ms-marco-MiniLM-L-6-v2';

function documentText(result: RerankableResult): string {
  return result.content || result.core_content || result.chunk_content || '';
}

export class Reranker {
  private readonly modelName: string;
  private readonly apiBaseUrl: string | null;
  private readonly apiKey: string | null;

  constructor(options: RerankerOptions = {}) {
    const provider = options.provider ?? 'api';
    if (provider === 'local') {
      throw new Error(
        'Local reranking (sentence-transformers/torch) is no longer supported. ' +
          "Set provider: 'api' and configure apiBaseUrl/apiKey for an external rerank service.",
      );
    }
    this.modelName = options.modelName ?? DEFAULT_MODEL;
    this.apiBaseUrl = options.apiBaseUrl ?? null;
    this.apiKey = options.apiKey ?? null;
  }

  /**
   * Re-rank results via the external rerank API. Adds a `reranking_score` to
   * each result and returns the top `topK` sorted by descending score. On any
   * API failure (or when no `apiBaseUrl` is configured) the original results
   * are returned unchanged, trimmed to `topK`.
   */
  async rerank<T extends RerankableResult>(
    query: string,
    results: T[],
    topK = 10,
  ): Promise<T[]> {
    if (results.length === 0) {
      return [];
    }
    if (!this.apiBaseUrl) {
      console.warn(
        'API reranking requested but no apiBaseUrl configured, returning original results',
      );
      return results.slice(0, topK);
    }

    try {
      const documents = results.map((r) => documentText(r));
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.apiBaseUrl}/rerank`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.modelName,
          query,
          documents,
          top_n: topK,
        }),
      });
      if (!response.ok) {
        throw new Error(`rerank API returned HTTP ${response.status}`);
      }
      const data = rerankResponseSchema.parse(await response.json());

      const ranked: T[] = [];
      for (const item of data.results ?? []) {
        if (item.index >= 0 && item.index < results.length) {
          ranked.push({
            ...results[item.index],
            reranking_score: item.relevance_score ?? 0,
          });
        }
      }
      ranked.sort(
        (a, b) => (b.reranking_score ?? 0) - (a.reranking_score ?? 0),
      );
      return ranked.slice(0, topK);
    } catch (err) {
      console.warn(
        `API reranking failed, returning original results: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return results.slice(0, topK);
    }
  }
}
