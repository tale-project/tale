'use node';

/**
 * OpenAI-compatible embedding generation service.
 *
 * Constructor-injected configuration — no global state or settings imports.
 * Each service creates its own EmbeddingService instance with its own config.
 */

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  InternalServerError,
  RateLimitError,
} from 'openai';

export const MAX_BATCH_SIZE = 256;
export const MAX_CONCURRENT_REQUESTS = 3;
export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 1000;

export interface EmbeddingUsage {
  promptTokens: number;
  totalTokens: number;
  model: string;
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: EmbeddingUsage;
}

export interface EmbeddingQueryResult {
  embedding: number[];
  usage: EmbeddingUsage;
}

function emptyUsage(model = ''): EmbeddingUsage {
  return { promptTokens: 0, totalTokens: 0, model };
}

function isRetryable(err: unknown): boolean {
  return (
    err instanceof RateLimitError ||
    err instanceof APIConnectionTimeoutError ||
    err instanceof APIConnectionError ||
    err instanceof InternalServerError
  );
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class EmbeddingService {
  protected client: OpenAI;
  private readonly model: string;
  private readonly dims: number;
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    apiKey: string,
    baseUrl: string | null,
    model: string,
    dimensions: number,
  ) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl ?? undefined });
    this.model = model;
    this.dims = dimensions;
  }

  /**
   * Replace the underlying OpenAI client. Intended for tests to inject a stub
   * with a mocked `embeddings.create`; production code never calls this.
   */
  setClient(client: OpenAI): void {
    this.client = client;
  }

  get dimensions(): number {
    return this.dims;
  }

  private zeroVector(): number[] {
    return new Array<number>(this.dims).fill(0.0);
  }

  /** A small concurrency gate mirroring the Python asyncio.Semaphore(3). */
  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_REQUESTS) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }

  private async embedBatchWithUsage(
    batch: string[],
    usage: EmbeddingUsage,
  ): Promise<number[][]> {
    const valid: [number, string][] = [];
    batch.forEach((text, i) => {
      if (text.trim()) {
        valid.push([i, text]);
      }
    });
    if (valid.length === 0) {
      return batch.map(() => this.zeroVector());
    }

    const validIndices = valid.map(([i]) => i);
    const validTexts = valid.map(([, text]) => text);

    await this.acquire();
    try {
      let embeddings: number[][] = [];
      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        try {
          const response = await this.client.embeddings.create({
            model: this.model,
            input: validTexts,
            dimensions: this.dims,
          });
          if (!response.data || response.data.length === 0) {
            console.warn(
              `Embedding returned empty data for batch of ${validTexts.length} texts, ` +
                `filling with zero vectors`,
            );
            return batch.map(() => this.zeroVector());
          }
          embeddings = response.data.map((item) => item.embedding);
          if (response.usage) {
            usage.promptTokens += response.usage.prompt_tokens;
            usage.totalTokens += response.usage.total_tokens;
          }
          break;
        } catch (err) {
          if (!isRetryable(err) || attempt === MAX_RETRIES - 1) {
            throw err;
          }
          const delay =
            RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
          console.warn(
            `Embedding request failed (attempt ${attempt + 1}/${MAX_RETRIES}), ` +
              `retrying in ${(delay / 1000).toFixed(2)}s`,
          );
          await sleep(delay);
        }
      }

      const results: number[][] = batch.map(() => this.zeroVector());
      validIndices.forEach((idx, j) => {
        results[idx] = embeddings[j];
      });
      return results;
    } finally {
      this.release();
    }
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return (await this.embedTextsWithUsage(texts)).embeddings;
  }

  async embedTextsWithUsage(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], usage: emptyUsage() };
    }
    const usage = emptyUsage(this.model);
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      batches.push(texts.slice(i, i + MAX_BATCH_SIZE));
    }
    const results = await Promise.all(
      batches.map((batch) => this.embedBatchWithUsage(batch, usage)),
    );
    return { embeddings: results.flat(), usage };
  }

  async embedQuery(query: string): Promise<number[]> {
    return (await this.embedQueryWithUsage(query)).embedding;
  }

  async embedQueryWithUsage(query: string): Promise<EmbeddingQueryResult> {
    const result = await this.embedTextsWithUsage([query]);
    return {
      embedding:
        result.embeddings.length > 0 ? result.embeddings[0] : this.zeroVector(),
      usage: result.usage,
    };
  }
}
