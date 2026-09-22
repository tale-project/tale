// @vitest-environment node

import { getEventListeners } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The budgets the embedder hands its provider client. The module's own
 * `request()` loop is the ONE retry policy: the SDK's defaults (a ten-minute
 * timeout, two internal retries) stacked under it made one black-holed
 * batch outlive the 15-minute `rag.index_file` job — pg-boss re-ran the job
 * while the first handler was still embedding the same file.
 */

interface RequestOptions {
  timeout?: number;
  signal?: AbortSignal;
}

const { constructed, create } = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  create: vi.fn<
    (
      args: {
        model: string;
        input: string[];
        dimensions: number;
        encoding_format?: string;
      },
      options?: RequestOptions,
    ) => Promise<{ data: { embedding: number[] }[] }>
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
const {
  classifyEmbeddingFailure,
  Embedder,
  EMBED_QUERY_TIMEOUT_MAX_MS,
  EMBED_REQUEST_TIMEOUT_MAX_MS,
  EMBED_REQUEST_TIMEOUT_MIN_MS,
  embeddingRequestTimeoutMs,
  estimateEmbeddingTokens,
  MAX_BATCH,
} = await import('./embedding.ts');
const { TASK_QUEUE_OPTIONS } = await import('../../jobs/tasks.ts');

const MODEL = {
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 3,
};

const vectorsFor = (texts: readonly string[]) => ({
  data: texts.map(() => ({ embedding: [1, 2, 3] })),
});

/** Microtasks and the limiter's hand-over settle before the next check. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

interface ParkedCall {
  readonly text: string;
  readonly options: RequestOptions | undefined;
  answer(): void;
  fail(error: unknown): void;
}

/**
 * Every provider call waits until the test answers it — the test decides
 * when a request "finishes", so what is in flight at any moment is exact.
 * A call whose signal aborts rejects the way the SDK does.
 */
function parkCalls(): { calls: ParkedCall[]; peak: () => number } {
  const calls: ParkedCall[] = [];
  let open = 0;
  let peak = 0;
  create.mockImplementation(
    (args, options) =>
      new Promise((resolve, reject) => {
        open++;
        peak = Math.max(peak, open);
        const done = () => {
          open--;
        };
        calls.push({
          text: args.input[0] ?? '',
          options,
          answer: () => {
            done();
            resolve(vectorsFor(args.input));
          },
          fail: (error) => {
            done();
            reject(error);
          },
        });
        options?.signal?.addEventListener(
          'abort',
          () => {
            done();
            reject(new OpenAI.APIUserAbortError());
          },
          { once: true },
        );
      }),
  );
  return { calls, peak: () => peak };
}

const started = (calls: readonly ParkedCall[]) =>
  calls.map((call) => call.text);

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
      timeout: EMBED_REQUEST_TIMEOUT_MAX_MS,
      maxRetries: 0,
    });
    expect(constructed[0]?.baseURL).toBeUndefined();
  });

  it('never gives one request longer than an indexing job may run', () => {
    const budget = TASK_QUEUE_OPTIONS['rag.index_file'].expireInSeconds;
    expect(budget).toBeDefined();
    expect(EMBED_REQUEST_TIMEOUT_MAX_MS).toBeLessThanOrEqual(
      (budget ?? 0) * 1000,
    );
  });

  it('keeps the configured endpoint', () => {
    const embedder = new Embedder(
      { ...MODEL, baseUrl: 'https://llm.example/v1' },
      'sk-test',
    );

    expect(embedder.model.baseUrl).toBe('https://llm.example/v1');
    expect(constructed[0]).toMatchObject({
      baseURL: 'https://llm.example/v1',
      timeout: EMBED_REQUEST_TIMEOUT_MAX_MS,
      maxRetries: 0,
    });
  });
});

/**
 * Retries must not pile work onto a busy server. A request that timed out
 * was in the server's hands the whole time — working or stuck — so sending
 * it again at once only lengthens the queue it was waiting in; the caller's
 * own, slower retry (the indexing job's backoff) decides when to try again.
 */
describe('the one retry policy', () => {
  const busy = (headers: Record<string, string>) =>
    OpenAI.APIError.generate(
      429,
      { error: { message: 'Too many requests' } },
      undefined,
      new Headers(headers),
    );

  it('does not send a timed-out request again: the server had it all along', async () => {
    create.mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
    const embedder = new Embedder(MODEL, 'sk-test');

    await expect(embedder.embed('hello')).rejects.toBeInstanceOf(
      OpenAI.APIConnectionTimeoutError,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries a request the server never took, pausing longer each time, then gives up', async () => {
    vi.useFakeTimers();
    create.mockRejectedValue(new OpenAI.APIConnectionError({}));
    const embedder = new Embedder(MODEL, 'sk-test');

    const outcome = embedder.embed('hello').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    // Backoff between the three attempts: 1 s and 2 s (+ jitter under 500 ms).
    await vi.advanceTimersByTimeAsync(900);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);

    expect(await outcome).toBeInstanceOf(OpenAI.APIConnectionError);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['Retry-After in seconds', { 'retry-after': '20' }, 20_000],
    ['retry-after-ms', { 'retry-after-ms': '12000' }, 12_000],
  ])(
    'waits as long as a busy server asks (%s) before retrying',
    async (_label, headers, asked) => {
      vi.useFakeTimers();
      create
        .mockRejectedValueOnce(busy(headers))
        .mockImplementation((args) => Promise.resolve(vectorsFor(args.input)));
      const embedder = new Embedder(MODEL, 'sk-test');

      const outcome = embedder.embed('hello');
      await vi.advanceTimersByTimeAsync(asked - 1_000);
      expect(create).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(create).toHaveBeenCalledTimes(2);
      await expect(outcome).resolves.toEqual([1, 2, 3]);
    },
  );

  it('leaves a server alone that asks for a longer pause than a request may wait', async () => {
    vi.useFakeTimers();
    create.mockRejectedValue(busy({ 'retry-after': '300' }));
    const embedder = new Embedder(MODEL, 'sk-test');

    const outcome = embedder.embed('hello').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await outcome).toBeInstanceOf(OpenAI.RateLimitError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failure that is not worth retrying', async () => {
    create.mockRejectedValue(new Error('bad request'));
    const embedder = new Embedder(MODEL, 'sk-test');

    await expect(embedder.embed('hello')).rejects.toThrow('bad request');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('account refusals from the provider', () => {
  // Z.ai answers account problems as HTTP 429 — 1113 for a spent balance,
  // 1311 for a model the subscription plan excludes. The SDK classes both
  // as RateLimitError, but waiting fixes neither and every retry re-bills
  // the same refusal.
  const providerError = (code: string, message: string) =>
    OpenAI.APIError.generate(
      429,
      { error: { code, message } },
      undefined,
      new Headers(),
    );

  it('does not retry a balance refusal', async () => {
    create.mockRejectedValue(
      providerError(
        '1113',
        'Insufficient balance or no resource package. Please recharge.',
      ),
    );
    const embedder = new Embedder(MODEL, 'sk-test');

    await expect(embedder.embed('hello')).rejects.toThrow(
      'Insufficient balance',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['1113', 'Insufficient balance or no resource package. Please recharge.'],
    [
      '1311',
      'Your current subscription plan does not yet include access to GLM-5V-Turbo',
    ],
    // The message alone identifies the refusal when the code is unfamiliar.
    ['9999', 'This model is not included in your plan.'],
  ])('classifies the %s account refusal as credit', (code, message) => {
    expect(classifyEmbeddingFailure(providerError(code, message))).toBe(
      'credit',
    );
  });

  it('classifies any other provider failure as upstream', () => {
    expect(
      classifyEmbeddingFailure(
        OpenAI.APIError.generate(
          429,
          {
            error: {
              code: 'rate_limit_exceeded',
              message: 'Too many requests',
            },
          },
          undefined,
          new Headers(),
        ),
      ),
    ).toBe('upstream');
    expect(
      classifyEmbeddingFailure(new OpenAI.APIConnectionTimeoutError()),
    ).toBe('upstream');
  });

  it('leaves non-provider errors unclassified', () => {
    expect(classifyEmbeddingFailure(new Error('a programming error'))).toBe(
      null,
    );
  });
});

describe('batching', () => {
  // DashScope's compatible mode refuses a batch over its per-model cap (10
  // or 25 texts) with a 400 naming the number; a document with more chunks
  // than that could never index, every retry re-sending the same batch.
  describe('a provider that caps the batch', () => {
    const tooLarge = OpenAI.APIError.generate(
      400,
      {
        error: {
          message:
            'InternalError.Algo.InvalidParameter: Value error, batch size is invalid, it should not be larger than 25.: input.contents',
        },
      },
      undefined,
      new Headers(),
    );
    const cappedAt = (cap: number) =>
      create.mockImplementation((args) =>
        args.input.length > cap
          ? Promise.reject(tooLarge)
          : Promise.resolve({
              data: args.input.map(() => ({ embedding: [1, 2, 3] })),
            }),
      );

    it('learns the cap from the refusal and sends the batch again in parts', async () => {
      cappedAt(25);
      const embedder = new Embedder(
        { ...MODEL, model: 'capped-25' },
        'sk-test',
      );

      const vectors = await embedder.embedAll(
        Array.from({ length: MAX_BATCH + 1 }, (_, i) => `text ${i}`),
      );

      expect(vectors).toHaveLength(MAX_BATCH + 1);
      const sizes = create.mock.calls.map(([args]) => args.input.length);
      // The full batch is refused once, then goes out in parts of the cap;
      // the sibling batch of one was never over it.
      expect(sizes[0]).toBe(MAX_BATCH);
      expect(sizes.filter((size) => size > 25)).toEqual([MAX_BATCH]);
      expect(sizes.slice(1).reduce((sum, size) => sum + size, 0)).toBe(
        MAX_BATCH + 1,
      );
    });

    it('starts the next call below the cap it learned for the lane', async () => {
      cappedAt(25);
      const embedder = new Embedder(
        { ...MODEL, model: 'capped-25' },
        'sk-test',
      );
      await embedder.embedAll(
        Array.from({ length: MAX_BATCH + 1 }, (_, i) => `text ${i}`),
      );
      create.mockClear();

      await embedder.embedAll(
        Array.from({ length: 60 }, (_, i) => `later ${i}`),
      );

      const sizes = create.mock.calls.map(([args]) => args.input.length);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(25);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(60);
    });

    it('halves the batch when the refusal names no number', async () => {
      const unnumbered = OpenAI.APIError.generate(
        400,
        { error: { message: 'batch size is invalid' } },
        undefined,
        new Headers(),
      );
      create.mockImplementation((args) =>
        args.input.length > 8
          ? Promise.reject(unnumbered)
          : Promise.resolve({
              data: args.input.map(() => ({ embedding: [1, 2, 3] })),
            }),
      );
      const embedder = new Embedder(
        { ...MODEL, model: 'capped-unnumbered' },
        'sk-test',
      );

      const vectors = await embedder.embedAll(
        Array.from({ length: 16 }, (_, i) => `text ${i}`),
      );

      expect(vectors).toHaveLength(16);
      expect(create.mock.calls.map(([args]) => args.input.length)).toEqual([
        16, 8, 8,
      ]);
    });

    it('leaves every other 400 to fail the call', async () => {
      create.mockRejectedValue(
        OpenAI.APIError.generate(
          400,
          { error: { message: 'input must not be empty' } },
          undefined,
          new Headers(),
        ),
      );
      const embedder = new Embedder(
        { ...MODEL, model: 'other-400' },
        'sk-test',
      );

      await expect(embedder.embedAll(['a', 'b'])).rejects.toBeInstanceOf(
        OpenAI.APIError,
      );
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

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

describe('the request shape', () => {
  it('asks for float vectors explicitly, never the SDK base64 default', async () => {
    // Left unspecified, the SDK requests base64 and decodes the answer as
    // base64 without checking that it is a string. A provider that ignores
    // the parameter (Z.ai) returns floats, which that decoder turns into a
    // short vector of zeros — 256 for a 1024-wide request.
    create.mockImplementation((args) =>
      Promise.resolve({
        data: args.input.map(() => ({ embedding: [1, 2, 3] })),
      }),
    );
    const embedder = new Embedder(MODEL, 'sk-test');

    await expect(embedder.embed('hello')).resolves.toEqual([1, 2, 3]);
    // Without a throughput floor Tale cannot size the queue, so a request
    // may take its ceiling — a search query's own, shorter one here.
    expect(create).toHaveBeenCalledWith(
      {
        model: 'text-embedding-3-small',
        input: ['hello'],
        dimensions: 3,
        encoding_format: 'float',
      },
      { timeout: EMBED_QUERY_TIMEOUT_MAX_MS, signal: expect.any(AbortSignal) },
    );
  });
});

/**
 * One bound per organization and model, whichever embedder asks. Every
 * indexing job and every search builds its own embedder; a bound kept per
 * embedder let five jobs put fifteen requests on a server sized for three.
 */
describe('the in-flight bound is shared across embedders', () => {
  it('holds the stated bound across two embedders and admits waiters in arrival order', async () => {
    const { calls, peak } = parkCalls();
    const model = { ...MODEL, model: 'lane-shared', maxConcurrentRequests: 2 };
    const first = new Embedder(model, 'sk-test', { organizationId: 'org-a' });
    const second = new Embedder(model, 'sk-test', { organizationId: 'org-a' });

    const results = ['a', 'b', 'c', 'd', 'e'].map((text, i) =>
      (i % 2 === 0 ? first : second).embed(text),
    );
    await settle();
    expect(started(calls)).toEqual(['a', 'b']);

    calls[1]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c']);

    calls[0]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c', 'd']);

    calls[2]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c', 'd', 'e']);
    calls[3]?.answer();
    calls[4]?.answer();

    await expect(Promise.all(results)).resolves.toHaveLength(5);
    expect(peak()).toBe(2);
  });

  it('keeps the bound of three when the file states none', async () => {
    const { calls, peak } = parkCalls();
    const model = { ...MODEL, model: 'lane-default' };
    const first = new Embedder(model, 'sk-test', { organizationId: 'org-a' });
    const second = new Embedder(model, 'sk-test', { organizationId: 'org-a' });

    const results = ['a', 'b', 'c', 'd'].map((text, i) =>
      (i < 2 ? first : second).embed(text),
    );
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c']);
    calls[0]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c', 'd']);
    for (const call of calls.slice(1)) call.answer();

    await expect(Promise.all(results)).resolves.toHaveLength(4);
    expect(peak()).toBe(3);
  });

  it('gives every organization, endpoint and model a lane of its own', async () => {
    const { calls } = parkCalls();
    const model = { ...MODEL, model: 'lane-split', maxConcurrentRequests: 1 };
    const embedders = [
      new Embedder(model, 'sk-test', { organizationId: 'org-a' }),
      new Embedder(model, 'sk-test', { organizationId: 'org-b' }),
      new Embedder({ ...model, baseUrl: 'https://other.example/v1' }, 'sk', {
        organizationId: 'org-a',
      }),
      new Embedder({ ...model, model: 'lane-split-2' }, 'sk-test', {
        organizationId: 'org-a',
      }),
    ];

    const results = embedders.map((embedder, i) => embedder.embed(`t${i}`));
    await settle();
    expect(started(calls)).toEqual(['t0', 't1', 't2', 't3']);
    for (const call of calls) call.answer();
    await expect(Promise.all(results)).resolves.toHaveLength(4);
  });

  it('applies a lowered bound at once, even while older embedders still send', async () => {
    // An operator lowers the bound because the server is overloaded; a scan
    // or an indexing run that began earlier must not keep raising it back.
    const { calls, peak } = parkCalls();
    const model = { ...MODEL, model: 'lane-lowered', maxConcurrentRequests: 3 };
    const older = new Embedder(model, 'sk-test', { organizationId: 'org-a' });
    const newer = new Embedder({ ...model, maxConcurrentRequests: 1 }, 'sk', {
      organizationId: 'org-a',
    });

    const first = older.embedAll(['a']);
    await settle();
    const results = [newer.embedAll(['b']), older.embedAll(['c'])];
    await settle();
    expect(started(calls)).toEqual(['a']);

    calls[0]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'b']);
    calls[1]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c']);
    calls[2]?.answer();

    await expect(Promise.all([first, ...results])).resolves.toHaveLength(3);
    expect(peak()).toBe(1);
  });

  it('applies a raised bound once no request made under the lower one is left', async () => {
    const { calls } = parkCalls();
    const model = { ...MODEL, model: 'lane-raised', maxConcurrentRequests: 1 };
    const older = new Embedder(model, 'sk-test', { organizationId: 'org-a' });
    const newer = new Embedder({ ...model, maxConcurrentRequests: 2 }, 'sk', {
      organizationId: 'org-a',
    });

    const results = [older.embedAll(['a']), newer.embedAll(['b'])];
    await settle();
    expect(started(calls)).toEqual(['a']);

    calls[0]?.answer();
    await settle();
    results.push(newer.embedAll(['c']));
    await settle();
    expect(started(calls)).toEqual(['a', 'b', 'c']);
    for (const call of calls.slice(1)) call.answer();
    await expect(Promise.all(results)).resolves.toHaveLength(3);
  });

  it('lets a search query take the next free slot ahead of queued batches', async () => {
    // A person is waiting on the query; a batch is a backlog. The query does
    // not interrupt the batch in flight, and batches keep their own order.
    const { calls } = parkCalls();
    const model = { ...MODEL, model: 'lane-query', maxConcurrentRequests: 1 };
    const indexing = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });
    const search = new Embedder(model, 'sk-test', { organizationId: 'org-a' });

    const batches = [
      indexing.embedAll(['batch-1']),
      indexing.embedAll(['batch-2']),
      indexing.embedAll(['batch-3']),
    ];
    await settle();
    const query = search.embed('query');
    await settle();
    expect(started(calls)).toEqual(['batch-1']);

    calls[0]?.answer();
    await settle();
    expect(started(calls)).toEqual(['batch-1', 'query']);
    calls[1]?.answer();
    await expect(query).resolves.toEqual([1, 2, 3]);
    await settle();
    expect(started(calls)).toEqual(['batch-1', 'query', 'batch-2']);
    calls[2]?.answer();
    await settle();
    calls[3]?.answer();
    await expect(Promise.all(batches)).resolves.toHaveLength(3);
    expect(started(calls)).toEqual(['batch-1', 'query', 'batch-2', 'batch-3']);
  });
});

describe('a request always gives its slot back', () => {
  it('frees the slot when the request fails', async () => {
    const { calls } = parkCalls();
    const parked = create.getMockImplementation();
    create.mockImplementation((args, options) =>
      args.input[0] === 'a'
        ? Promise.reject(new Error('bad request'))
        : (parked?.(args, options) ?? Promise.reject(new Error('unreachable'))),
    );
    const model = { ...MODEL, model: 'lane-failure', maxConcurrentRequests: 1 };
    const embedder = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });

    const failed = embedder.embed('a');
    const next = embedder.embed('b');
    await expect(failed).rejects.toThrow('bad request');
    await settle();
    expect(started(calls)).toEqual(['b']);
    calls[0]?.answer();
    await expect(next).resolves.toEqual([1, 2, 3]);
  });

  it('frees the slot of a request that timed out, without sending it again', async () => {
    const { calls } = parkCalls();
    const parked = create.getMockImplementation();
    create.mockImplementation((args, options) =>
      args.input[0] === 'a'
        ? Promise.reject(new OpenAI.APIConnectionTimeoutError())
        : (parked?.(args, options) ?? Promise.reject(new Error('unreachable'))),
    );
    const model = { ...MODEL, model: 'lane-timeout', maxConcurrentRequests: 1 };
    const embedder = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });

    const timedOut = embedder.embed('a');
    const next = embedder.embed('b');
    await expect(timedOut).rejects.toBeInstanceOf(
      OpenAI.APIConnectionTimeoutError,
    );
    await settle();
    expect(started(calls)).toEqual(['b']);
    expect(
      create.mock.calls.filter(([args]) => args.input[0] === 'a'),
    ).toHaveLength(1);
    calls[0]?.answer();
    await expect(next).resolves.toEqual([1, 2, 3]);
  });

  it('keeps the slot through its retries and frees it after the last failure', async () => {
    vi.useFakeTimers();
    const { calls } = parkCalls();
    const parked = create.getMockImplementation();
    create.mockImplementation((args, options) =>
      args.input[0] === 'a'
        ? Promise.reject(new OpenAI.APIConnectionError({}))
        : (parked?.(args, options) ?? Promise.reject(new Error('unreachable'))),
    );
    const model = { ...MODEL, model: 'lane-retries', maxConcurrentRequests: 1 };
    const embedder = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });

    const timedOut = embedder.embed('a').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    const next = embedder.embed('b');
    await vi.advanceTimersByTimeAsync(1_600);
    // Still retrying: the waiting request has not started.
    expect(started(calls)).toEqual([]);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(await timedOut).toBeInstanceOf(OpenAI.APIConnectionError);
    expect(
      create.mock.calls.filter(([args]) => args.input[0] === 'a'),
    ).toHaveLength(3);
    expect(started(calls)).toEqual(['b']);
    calls[0]?.answer();
    await expect(next).resolves.toEqual([1, 2, 3]);
  });
});

/**
 * A caller whose own budget ends — an indexing job pg-boss has given up on —
 * must stop waiting and stop its request, so the retry pg-boss starts is the
 * only indexer left working on the document.
 */
describe('a caller that gives up', () => {
  it('leaves the queue without ever sending its request', async () => {
    const { calls } = parkCalls();
    const model = { ...MODEL, model: 'lane-abort-q', maxConcurrentRequests: 1 };
    const embedder = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });
    const controller = new AbortController();

    const first = embedder.embed('a');
    const abandoned = embedder.embedAll(['b'], { signal: controller.signal });
    const last = embedder.embed('c');
    await settle();
    controller.abort();
    await expect(abandoned).rejects.toThrow();

    calls[0]?.answer();
    await settle();
    expect(started(calls)).toEqual(['a', 'c']);
    calls[1]?.answer();
    await expect(Promise.all([first, last])).resolves.toHaveLength(2);
  });

  it('cancels its request in flight, does not retry it, and frees the slot', async () => {
    const { calls } = parkCalls();
    const model = { ...MODEL, model: 'lane-abort-f', maxConcurrentRequests: 1 };
    const embedder = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });
    const controller = new AbortController();

    const abandoned = embedder.embedAll(['a'], { signal: controller.signal });
    const next = embedder.embed('b');
    await settle();
    // The request runs on a signal of its own that follows the caller's.
    const requestSignal = calls[0]?.options?.signal;
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
    await expect(abandoned).rejects.toThrow();
    await settle();
    expect(started(calls)).toEqual(['a', 'b']);
    calls[1]?.answer();
    await expect(next).resolves.toEqual([1, 2, 3]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('stops between attempts when it gives up during the backoff', async () => {
    vi.useFakeTimers();
    create.mockRejectedValue(new OpenAI.APIConnectionError({}));
    const embedder = new Embedder(
      { ...MODEL, model: 'lane-abort-b' },
      'sk-test',
    );
    const controller = new AbortController();

    const abandoned = embedder
      .embedAll(['a'], { signal: controller.signal })
      .then(
        () => 'resolved',
        (error: unknown) => error,
      );
    await vi.advanceTimersByTimeAsync(100);
    expect(create).toHaveBeenCalledTimes(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await abandoned).not.toBe('resolved');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not start at all when it has already given up', async () => {
    const embedder = new Embedder(
      { ...MODEL, model: 'lane-abort-early' },
      'sk-test',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      embedder.embedAll(['a'], { signal: controller.signal }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * How long one request may take, when the model states the throughput its
 * server keeps. The server works one pass at a time and makes every other
 * request wait, so a request's time is the work queued with it plus its own
 * tokens — never its own tokens at an idle rate.
 */
describe('the per-request timeout', () => {
  it('waits up to the ceiling when the model states no throughput floor', () => {
    // No stated rate, no way to size the queue: a request is never cut
    // shorter than a queued one could take. The old flat minute cut them.
    for (const tokens of [1, 60_000, 10_000_000]) {
      expect(embeddingRequestTimeoutMs(tokens, {})).toBe(900_000);
      expect(
        embeddingRequestTimeoutMs(tokens, { maxConcurrentRequests: 1 }),
      ).toBe(900_000);
    }
    expect(EMBED_REQUEST_TIMEOUT_MIN_MS).toBe(60_000);
  });

  it('gives a small request the time for the full batches that may be queued with it', () => {
    // 2 in flight: 1 more from this process and 2 from other clients, each
    // at least a full batch (64 × 1,024 tokens): (10 + 3 × 65,536) × 1.5 /
    // 1,000 tokens per second.
    expect(
      embeddingRequestTimeoutMs(10, {
        maxConcurrentRequests: 2,
        minTokensPerSecond: 1_000,
      }),
    ).toBe(294_927);
    // The same wait applies to a request of one token or a thousand.
    expect(
      embeddingRequestTimeoutMs(1_000, {
        maxConcurrentRequests: 2,
        minTokensPerSecond: 1_000,
      }),
    ).toBe(296_412);
  });

  it('adds a full batch’s own tokens on top of that wait', () => {
    // (60,000 + 3 × 65,536) × 1.5 / 1,000 tokens per second.
    expect(
      embeddingRequestTimeoutMs(60_000, {
        maxConcurrentRequests: 2,
        minTokensPerSecond: 1_000,
      }),
    ).toBe(384_912);
  });

  it('counts every request ahead as at least as large as an oversized one', () => {
    // (100,000 + 3 × 100,000) × 1.5 / 1,000 tokens per second.
    expect(
      embeddingRequestTimeoutMs(100_000, {
        maxConcurrentRequests: 2,
        minTokensPerSecond: 1_000,
      }),
    ).toBe(600_000);
  });

  it('allows for more queued work as the in-flight bound grows, three when unset', () => {
    const at = (maxConcurrentRequests?: number) =>
      embeddingRequestTimeoutMs(10, {
        ...(maxConcurrentRequests === undefined
          ? {}
          : { maxConcurrentRequests }),
        minTokensPerSecond: 1_000,
      });
    // (10 + (2N − 1) × 65,536) × 1.5 / 1,000 tokens per second.
    expect(at(1)).toBe(98_319);
    expect(at(3)).toBe(491_535);
    expect(at()).toBe(at(3));
  });

  it('never drops below the minute and never outlives an indexing job', () => {
    expect(
      embeddingRequestTimeoutMs(10, {
        maxConcurrentRequests: 1,
        minTokensPerSecond: 1_000_000,
      }),
    ).toBe(60_000);
    expect(
      embeddingRequestTimeoutMs(60_000, {
        maxConcurrentRequests: 64,
        minTokensPerSecond: 0.5,
      }),
    ).toBe(EMBED_REQUEST_TIMEOUT_MAX_MS);
    expect(EMBED_REQUEST_TIMEOUT_MAX_MS).toBe(900_000);
  });

  it('hands each request the timeout its own batch derives', async () => {
    create.mockImplementation((args) =>
      Promise.resolve(vectorsFor(args.input)),
    );
    const model = {
      ...MODEL,
      model: 'lane-timeout-derived',
      maxConcurrentRequests: 2,
      minTokensPerSecond: 800,
    };
    const embedder = new Embedder(model, 'sk-test');
    const texts = Array.from(
      { length: MAX_BATCH + 1 },
      (_, i) => `Absatz ${i}: Die Mehrwertsteuer beträgt 8,1 %.`,
    );

    await embedder.embedAll(texts);

    const batches = [texts.slice(0, MAX_BATCH), texts.slice(MAX_BATCH)];
    expect(create.mock.calls.map(([, options]) => options?.timeout)).toEqual(
      batches.map((batch) =>
        embeddingRequestTimeoutMs(estimateEmbeddingTokens(batch), model),
      ),
    );
    expect(create.mock.calls[0]?.[1]?.timeout).toBeGreaterThan(60_000);
  });
});

/**
 * A search query waits on a person's chat turn, and the chat generation
 * watchdog fails a turn whose heartbeat has not moved for its staleness
 * window — which a running tool call does not move. A search therefore ends,
 * with an error the turn can report, well inside that window: the query
 * ceiling bounds each request and the whole search, slot wait included.
 */
describe('a search query has a ceiling of its own', () => {
  it('waits at most the query ceiling, with or without a throughput floor', () => {
    expect(EMBED_QUERY_TIMEOUT_MAX_MS).toBe(300_000);
    for (const tokens of [10, 10_000_000]) {
      expect(embeddingRequestTimeoutMs(tokens, {}, 'query')).toBe(300_000);
    }
    // (10 + 3 × 65,536) × 1.5 / 1,000 tokens per second: under the ceiling.
    expect(
      embeddingRequestTimeoutMs(
        10,
        { maxConcurrentRequests: 2, minTokensPerSecond: 1_000 },
        'query',
      ),
    ).toBe(294_927);
    // The same at 800 tokens per second is over it.
    expect(
      embeddingRequestTimeoutMs(
        10,
        { maxConcurrentRequests: 2, minTokensPerSecond: 800 },
        'query',
      ),
    ).toBe(300_000);
    // Never under the minute.
    expect(
      embeddingRequestTimeoutMs(
        10,
        { maxConcurrentRequests: 1, minTokensPerSecond: 1_000_000 },
        'query',
      ),
    ).toBe(60_000);
    // A batch keeps the indexing ceiling.
    expect(embeddingRequestTimeoutMs(10, {}, 'batch')).toBe(900_000);
    expect(embeddingRequestTimeoutMs(10, {})).toBe(900_000);
  });

  it('hands a search request the query ceiling and a batch the indexing one', async () => {
    create.mockImplementation((args) =>
      Promise.resolve(vectorsFor(args.input)),
    );
    const embedder = new Embedder(
      { ...MODEL, model: 'lane-ceilings' },
      'sk-test',
    );

    await embedder.embed('query');
    await embedder.embedAll(['batch']);

    expect(create.mock.calls.map(([, options]) => options?.timeout)).toEqual([
      300_000, 900_000,
    ]);
  });

  it('gives up on a search at the ceiling while it still waits for a slot', async () => {
    vi.useFakeTimers();
    const { calls } = parkCalls();
    const model = {
      ...MODEL,
      model: 'lane-query-deadline',
      maxConcurrentRequests: 1,
    };
    const indexing = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });
    const search = new Embedder(model, 'sk-test', { organizationId: 'org-a' });

    const batch = indexing.embedAll(['batch']);
    await vi.advanceTimersByTimeAsync(0);
    const query = search.embed('query').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(EMBED_QUERY_TIMEOUT_MAX_MS - 1_000);
    expect(started(calls)).toEqual(['batch']);
    await vi.advanceTimersByTimeAsync(1_000);

    const error = await query;
    expect(error).toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect(classifyEmbeddingFailure(error)).toBe('upstream');
    expect(started(calls)).toEqual(['batch']);
    calls[0]?.answer();
    await expect(batch).resolves.toHaveLength(1);
  });

  it('gives up on a search at the ceiling across its attempts', async () => {
    vi.useFakeTimers();
    const { calls } = parkCalls();
    const parked = create.getMockImplementation();
    let attempts = 0;
    create.mockImplementation((args, options) => {
      attempts++;
      return attempts === 1
        ? Promise.reject(new OpenAI.APIConnectionError({}))
        : (parked?.(args, options) ?? Promise.reject(new Error('unreachable')));
    });
    const embedder = new Embedder(
      { ...MODEL, model: 'lane-query-attempts' },
      'sk-test',
    );

    const query = embedder.embed('query').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(EMBED_QUERY_TIMEOUT_MAX_MS);

    expect(await query).toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect(calls[0]?.options?.signal?.aborted).toBe(true);
  });
});

/**
 * One failed batch fails the whole call, so its other batches are wasted
 * work: they would keep their slots, and the server would keep computing
 * vectors nobody stores. The server drops work whose client disconnects, so
 * the embedder stops them — queued ones unsent, running ones cancelled.
 */
describe('one failed batch stops the others', () => {
  it('cancels the running batches, withdraws the queued ones, and surfaces the first failure', async () => {
    const { calls } = parkCalls();
    const model = {
      ...MODEL,
      model: 'lane-siblings',
      maxConcurrentRequests: 2,
    };
    const embedder = new Embedder(model, 'sk-test', {
      organizationId: 'org-a',
    });
    const texts = Array.from(
      { length: MAX_BATCH * 2 + 1 },
      (_, i) => `text ${i}`,
    );

    const outcome = embedder.embedAll(texts).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await settle();
    expect(started(calls)).toEqual(['text 0', `text ${MAX_BATCH}`]);
    const failure = new Error('bad request');
    calls[0]?.fail(failure);

    expect(await outcome).toBe(failure);
    expect(calls[1]?.options?.signal?.aborted).toBe(true);
    await settle();
    // The third batch was never sent, and the lane is free again.
    expect(started(calls)).toEqual(['text 0', `text ${MAX_BATCH}`]);
    const next = embedder.embed('next');
    await settle();
    expect(started(calls)).toEqual(['text 0', `text ${MAX_BATCH}`, 'next']);
    calls[2]?.answer();
    await expect(next).resolves.toEqual([1, 2, 3]);
  });

  it('leaves no listener behind on a long-lived caller signal', async () => {
    // The SDK adds an abort listener to the signal it is handed and never
    // removes it; an indexing job hands every slice the same job signal.
    create.mockImplementation((args, options) => {
      options?.signal?.addEventListener('abort', () => undefined, {
        once: true,
      });
      return Promise.resolve(vectorsFor(args.input));
    });
    const embedder = new Embedder(
      { ...MODEL, model: 'lane-listeners' },
      'sk-test',
    );
    const job = new AbortController();

    for (let slice = 0; slice < 12; slice++) {
      await embedder.embedAll([`slice ${slice}`], { signal: job.signal });
    }

    expect(create).toHaveBeenCalledTimes(12);
    expect(getEventListeners(job.signal, 'abort')).toHaveLength(0);
  });
});

/**
 * The conservative token count the timeout is sized from. Over-counting only
 * lengthens a wait; under-counting abandons work the server would finish.
 */
describe('the token estimate', () => {
  it('counts three ASCII letters or spaces as one token, plus two per text', () => {
    expect(estimateEmbeddingTokens(['abc def'])).toBe(5);
    expect(estimateEmbeddingTokens([''])).toBe(2);
  });

  it('counts every digit, punctuation mark and symbol as a token of its own', () => {
    expect(estimateEmbeddingTokens(['2026'])).toBe(6);
    // "CHF " → 2, six digits → 6, ’ and . → 2, plus the text's 2.
    expect(estimateEmbeddingTokens(['CHF 1’234.50'])).toBe(12);
  });

  it('counts every non-ASCII UTF-16 unit as a token', () => {
    expect(estimateEmbeddingTokens(['Grüße'])).toBe(5);
    expect(estimateEmbeddingTokens(['日本語'])).toBe(5);
    expect(estimateEmbeddingTokens(['😀'])).toBe(4);
  });

  it('adds up every text of the request', () => {
    expect(estimateEmbeddingTokens(['abc def', '2026', 'Grüße'])).toBe(16);
  });

  it('never counts ordinary prose below four characters a token', () => {
    const prose =
      'The organization keeps its knowledge in documents that people upload, and every document is split into passages before it is embedded. ';
    const text = prose.repeat(15);
    expect(estimateEmbeddingTokens([text])).toBeGreaterThan(text.length / 4);
  });
});

/**
 * The refusals no wait can lift, across providers: OpenAI's billing and
 * spend codes and its 402, a rejected key, a key the model is closed to.
 * The first review of this module found them all classified as transient
 * — retried three times and answered as a 503 the docs told consumers to
 * retry.
 */
describe('provider refusals no wait can lift', () => {
  const apiError = (status: number, body: Record<string, unknown>) =>
    OpenAI.APIError.generate(status, body, undefined, new Headers());

  it.each([
    [
      '429 insufficient_quota',
      429,
      {
        error: {
          code: 'insufficient_quota',
          message: 'You exceeded your current quota',
        },
      },
      'credit',
    ],
    [
      '429 credit_balance_exhausted with neutral wording',
      429,
      {
        error: { code: 'credit_balance_exhausted', message: 'Request refused' },
      },
      'credit',
    ],
    [
      '429 organization_spend_limit_exceeded',
      429,
      {
        error: {
          code: 'organization_spend_limit_exceeded',
          message: 'Request refused',
        },
      },
      'credit',
    ],
    [
      '402 payment required',
      402,
      { error: { message: 'Payment Required' } },
      'credit',
    ],
    [
      '401 invalid_api_key',
      401,
      {
        error: {
          code: 'invalid_api_key',
          message: 'Incorrect API key provided',
        },
      },
      'credential',
    ],
    [
      '403 model access refused',
      403,
      {
        error: {
          code: 'permission_denied',
          message: 'Project does not have access to this model',
        },
      },
      'credential',
    ],
    [
      '429 rate_limit_exceeded',
      429,
      {
        error: {
          code: 'rate_limit_exceeded',
          message: 'Rate limit reached for embeddings',
        },
      },
      'upstream',
    ],
    ['500', 500, { error: { message: 'The server had an error' } }, 'upstream'],
  ])('classifies %s as %s', (_label, status, body, expected) => {
    expect(classifyEmbeddingFailure(apiError(status, body))).toBe(expected);
  });

  it.each([
    [
      'an account refusal',
      429,
      {
        error: {
          code: 'insufficient_quota',
          message: 'You exceeded your current quota',
        },
      },
    ],
    [
      'a rejected credential',
      401,
      {
        error: {
          code: 'invalid_api_key',
          message: 'Incorrect API key provided',
        },
      },
    ],
  ])('does not retry %s', async (_label, status, body) => {
    create.mockRejectedValue(apiError(status, body));
    const embedder = new Embedder(MODEL, 'sk-test');

    await expect(embedder.embed('hello')).rejects.toBeInstanceOf(
      OpenAI.APIError,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
