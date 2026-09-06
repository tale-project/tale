// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The budgets the embedder hands its provider client. The module's own
 * `request()` loop is the ONE retry policy: the SDK's defaults (a ten-minute
 * timeout, two internal retries) stacked under it made one black-holed
 * batch outlive the 15-minute `rag.index_file` job — pg-boss re-ran the job
 * while the first handler was still embedding the same file.
 */

const { constructed, create } = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  create:
    vi.fn<
      (args: {
        input: string[];
      }) => Promise<{ data: { embedding: number[] }[] }>
    >(),
}));

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  class FakeOpenAI extends actual.default {
    constructor(options: Record<string, unknown>) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK's option bag, as the embedder builds it
      super(options as ConstructorParameters<typeof actual.default>[0]);
      constructed.push(options);
      Object.defineProperty(this, 'embeddings', { value: { create } });
    }
  }
  return { ...actual, default: FakeOpenAI };
});

const OpenAI = (await import('openai')).default;
const { Embedder, EMBED_REQUEST_TIMEOUT_MS, MAX_BATCH } =
  await import('./embedding.ts');

const MODEL = {
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 3,
};

afterEach(() => {
  constructed.length = 0;
  create.mockReset();
  vi.useRealTimers();
});

describe('the provider client', () => {
  it('is built with an explicit request budget and no SDK retries', () => {
    const embedder = new Embedder(MODEL, 'sk-test');

    expect(embedder.dimensions).toBe(3);
    expect(constructed[0]).toMatchObject({
      apiKey: 'sk-test',
      timeout: EMBED_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    expect(constructed[0]?.baseURL).toBeUndefined();
    // Three attempts with backoff stay inside the 900 s job budget.
    expect(EMBED_REQUEST_TIMEOUT_MS * 3).toBeLessThan(900_000 / 2);
  });

  it('keeps the configured endpoint', () => {
    const embedder = new Embedder(
      { ...MODEL, baseUrl: 'https://llm.example/v1' },
      'sk-test',
    );

    expect(embedder.model.baseUrl).toBe('https://llm.example/v1');
    expect(constructed[0]).toMatchObject({
      baseURL: 'https://llm.example/v1',
      timeout: EMBED_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
  });
});

describe('the one retry policy', () => {
  it('retries a timed-out request itself, then gives up with the last error', async () => {
    vi.useFakeTimers();
    create.mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
    const embedder = new Embedder(MODEL, 'sk-test');

    const outcome = embedder.embed('hello').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    // Backoff between the three attempts: 1 s and 2 s (+ jitter under 500 ms).
    await vi.advanceTimersByTimeAsync(6_000);

    expect(await outcome).toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('does not retry a failure that is not worth retrying', async () => {
    create.mockRejectedValue(new Error('bad request'));
    const embedder = new Embedder(MODEL, 'sk-test');

    await expect(embedder.embed('hello')).rejects.toThrow('bad request');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('batching', () => {
  it('never sends more texts per request than the tightest shipped cap', async () => {
    // Z.ai's embedding-3 refuses more than 64 inputs (error 1214) before it
    // bills anything; a document with more chunks than that must still index.
    expect(MAX_BATCH).toBeLessThanOrEqual(64);
    create.mockImplementation((args) =>
      Promise.resolve({
        data: args.input.map(() => ({ embedding: [1, 2, 3] })),
      }),
    );
    const embedder = new Embedder(MODEL, 'sk-test');

    const vectors = await embedder.embedAll(
      Array.from({ length: MAX_BATCH + 1 }, (_, i) => `text ${i}`),
    );

    expect(vectors).toHaveLength(MAX_BATCH + 1);
    expect(create.mock.calls.map(([args]) => args.input.length)).toEqual([
      MAX_BATCH,
      1,
    ]);
  });
});
