import type OpenAI from 'openai';
import { APIConnectionError } from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddingService, MAX_BATCH_SIZE } from './service';

interface EmbeddingItem {
  embedding: number[];
}
interface EmbeddingsResponse {
  data: EmbeddingItem[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

/**
 * Build a minimal OpenAI stub exposing only `embeddings.create`. The real
 * `OpenAI` type is large and unconstructable for a unit test; the service only
 * touches `embeddings.create`, so a structural stub stands in.
 */
function stubClient(
  create: (args: { input: string[] }) => Promise<EmbeddingsResponse>,
): OpenAI {
  const stub = { embeddings: { create } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structural test stub for the large third-party OpenAI client; only embeddings.create is exercised
  return stub as unknown as OpenAI;
}

function makeService(): EmbeddingService {
  return new EmbeddingService(
    'test-key',
    'http://localhost:8080',
    'text-embedding-3-small',
    1536,
  );
}

describe('EmbeddingService', () => {
  it('exposes the dimensions', () => {
    expect(makeService().dimensions).toBe(1536);
  });

  it('returns empty for no texts', async () => {
    expect(await makeService().embedTexts([])).toEqual([]);
  });

  it('embeds a single batch', async () => {
    const svc = makeService();
    svc.setClient(
      stubClient(async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.1, 0.2, 0.3] }],
      })),
    );
    const result = await svc.embedTexts(['hello', 'world']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
  });

  it('embeds a query', async () => {
    const svc = makeService();
    svc.setClient(
      stubClient(async () => ({ data: [{ embedding: [0.5, 0.6] }] })),
    );
    expect(await svc.embedQuery('test query')).toEqual([0.5, 0.6]);
  });

  it('splits into multiple batches', async () => {
    const svc = makeService();
    let callCount = 0;
    svc.setClient(
      stubClient(async ({ input }) => {
        callCount += 1;
        const value = callCount;
        return { data: input.map(() => ({ embedding: [value] })) };
      }),
    );
    const texts = Array.from(
      { length: MAX_BATCH_SIZE + 10 },
      (_, i) => `text-${i}`,
    );
    const result = await svc.embedTexts(texts);
    expect(result).toHaveLength(MAX_BATCH_SIZE + 10);
    expect(callCount).toBe(2);
  });

  it('retries on a transient failure', async () => {
    vi.useFakeTimers();
    try {
      const svc = makeService();
      const create = vi
        .fn<(args: { input: string[] }) => Promise<EmbeddingsResponse>>()
        .mockRejectedValueOnce(new APIConnectionError({ message: 'boom' }))
        .mockResolvedValueOnce({ data: [{ embedding: [1.0] }] });
      svc.setClient(stubClient(create));
      const promise = svc.embedTexts(['test']);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toEqual([[1.0]]);
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a non-retryable error', async () => {
    const svc = makeService();
    svc.setClient(
      stubClient(() => {
        throw new Error('bad input');
      }),
    );
    await expect(svc.embedTexts(['test'])).rejects.toThrow('bad input');
  });

  it('fills missing/empty inputs with zero vectors', async () => {
    const svc = makeService();
    svc.setClient(stubClient(async () => ({ data: [{ embedding: [9, 9] }] })));
    const result = await svc.embedTexts(['', 'real']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(new Array<number>(1536).fill(0));
    expect(result[1]).toEqual([9, 9]);
  });
});
