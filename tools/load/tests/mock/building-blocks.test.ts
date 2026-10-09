import { afterEach, describe, expect, test } from 'bun:test';

import { workerStreamLimit } from '../../src/mock/cluster.ts';
import { mockEnvName, parseMockOptions } from '../../src/mock/config.ts';
import { parseDirectives } from '../../src/mock/faults.ts';
import { PrefixHasher, PromptCache } from '../../src/mock/prompt-cache.ts';
import { createRandom, lognormalFromMedianP95 } from '../../src/mock/random.ts';
import { createMockServer, type MockServer } from '../../src/mock/server.ts';
import {
  chunkByTokens,
  estimateTokens,
  truncateToTokens,
} from '../../src/mock/tokens.ts';
import { valueForSchema } from '../../src/mock/tool-args.ts';

describe('options', () => {
  test('a flag beats the environment, which beats the default', () => {
    expect(mockEnvName('ttftMedianMs')).toBe('TALE_LOAD_MOCK_TTFT_MEDIAN_MS');
    expect(parseMockOptions({}, {}).ttftMedianMs).toBe(450);
    const env = {
      TALE_LOAD_MOCK_TTFT_MEDIAN_MS: '900',
      TALE_LOAD_MOCK_TTFT_P95_MS: '2000',
    };
    expect(parseMockOptions({}, env).ttftMedianMs).toBe(900);
    expect(parseMockOptions({ ttftMedianMs: '700' }, env).ttftMedianMs).toBe(
      700,
    );
    // An empty value is unset, not zero.
    expect(parseMockOptions({ ttftMedianMs: '' }, env).ttftMedianMs).toBe(900);
  });

  test('a p95 below the median is refused', () => {
    expect(() =>
      parseMockOptions({ ttftMedianMs: 800, ttftP95Ms: 400 }, {}),
    ).toThrow('ttftP95Ms must be at least ttftMedianMs');
  });
});

describe('directives', () => {
  test('are read from the text, the later one winning', () => {
    expect(
      parseDirectives(
        'a [[mock:tokens=5]] b [[mock:tokens=9]] [[mock:503]]',
        1,
      ),
    ).toEqual({ tokens: 9, status: 503 });
    expect(parseDirectives('[[mock:stall]] [[mock:no-tool]]', 30_000)).toEqual({
      stallMs: 30_000,
      tool: false,
    });
    expect(parseDirectives('no directives here', 1)).toEqual({});
  });
});

describe('latency draws', () => {
  test('a lognormal lands on its median and p95', () => {
    const random = createRandom(42);
    const draws = Array.from({ length: 40_000 }, () =>
      lognormalFromMedianP95(random, 450, 1500),
    ).sort((a, b) => a - b);
    const at = (q: number) => draws[Math.floor(q * draws.length)] ?? 0;
    expect(at(0.5) / 450).toBeGreaterThan(0.95);
    expect(at(0.5) / 450).toBeLessThan(1.05);
    expect(at(0.95) / 1500).toBeGreaterThan(0.92);
    expect(at(0.95) / 1500).toBeLessThan(1.08);
  });

  test('a seed replays the same draws', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });
});

describe('tokens', () => {
  const text =
    'The quarterly review covers revenue, churn and the hiring plan for Q3.';

  test('chunks join back to the text', () => {
    for (const size of [1, 3, 8]) {
      const chunks = chunkByTokens(text, size);
      expect(chunks.join('')).toBe(text);
      expect(chunks.length).toBe(Math.ceil(estimateTokens(text) / size));
    }
  });

  test('truncation keeps a prefix of at most the asked tokens', () => {
    const cut = truncateToTokens(text, 5);
    expect(text.startsWith(cut)).toBe(true);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(5);
    expect(truncateToTokens(text, 10_000)).toBe(text);
  });
});

describe('prompt cache', () => {
  function prompt(parts: string[]): { hashes: string[]; tokens: number[] } {
    const hasher = new PrefixHasher('model');
    const tokens: number[] = [];
    let running = 0;
    for (const part of parts) {
      hasher.add(part);
      running += 600;
      tokens.push(running);
      hasher.commit();
    }
    return { hashes: hasher.hashes, tokens };
  }

  test('only a remembered prefix of 1024+ tokens hits, in 128 blocks', () => {
    const cache = new PromptCache(10);
    const first = prompt(['system', 'question']);
    expect(cache.lookupAndRemember(first.hashes, first.tokens)).toBe(0);
    // The next turn re-reads everything the first one sent.
    const next = prompt(['system', 'question', 'answer', 'follow-up']);
    expect(cache.lookupAndRemember(next.hashes, next.tokens)).toBe(1152);
    // A 600-token prefix is below the floor.
    const short = prompt(['system', 'other']);
    expect(cache.lookupAndRemember(short.hashes, short.tokens)).toBe(0);
  });

  test('the least recently used prefix leaves first', () => {
    // Two-message prompts remember both prefixes, so a capacity of 4 holds
    // two prompts; a hit refreshes its entry.
    const cache = new PromptCache(4);
    const a = prompt(['a', 'a2']);
    const b = prompt(['b', 'b2']);
    const c = prompt(['c', 'c2']);
    cache.lookupAndRemember(a.hashes, a.tokens);
    cache.lookupAndRemember(b.hashes, b.tokens);
    // A hit on a's prefix makes b the least recently used.
    const aAgain = prompt(['a', 'a2', 'a3']);
    expect(cache.lookupAndRemember(aAgain.hashes, aAgain.tokens)).toBe(1152);
    // c's two prefixes push out the two least recently used: b's.
    cache.lookupAndRemember(c.hashes, c.tokens);
    const aThird = prompt(['a', 'a2', 'a3', 'a4']);
    expect(cache.lookupAndRemember(aThird.hashes, aThird.tokens)).toBe(1792);
    const bAgain = prompt(['b', 'b2', 'b3']);
    expect(cache.lookupAndRemember(bAgain.hashes, bAgain.tokens)).toBe(0);
  });
});

describe('bounds on what a caller can ask for', () => {
  test('a huge tokens directive is cut to the ceiling before it is generated', async () => {
    const mock = await createMockServer(
      {
        port: 0,
        seed: 1,
        ttftMedianMs: 1,
        ttftP95Ms: 1,
        rate429: 0,
        rate5xx: 0,
      },
      {},
    );
    try {
      const started = performance.now();
      const response = await fetch(`${mock.url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer k',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'load-chat-fast',
          max_tokens: 64,
          messages: [
            { role: 'user', content: 'Essay [[mock:tokens=999999999]]' },
          ],
        }),
      });
      const body = (await response.json()) as {
        usage?: { completion_tokens?: number };
      };
      expect(response.status).toBe(200);
      expect(body.usage?.completion_tokens).toBeLessThanOrEqual(64);
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      await mock.close();
    }
  });

  test('a malformed model id is a 404, not a 500', async () => {
    const mock = await createMockServer({ port: 0, seed: 1 }, {});
    try {
      const response = await fetch(`${mock.url}/v1/models/%E0%A4%A`);
      expect(response.status).toBe(404);
    } finally {
      await mock.close();
    }
  });

  test('a schema demanding millions of items gets a bounded value', () => {
    const value = valueForSchema(
      createRandom(1),
      {
        type: 'array',
        minItems: 10_000_000,
        items: { type: 'string', minLength: 10_000_000 },
      },
      'items',
      { keywords: [], locale: 'en' },
    ) as string[];
    expect(value.length).toBeLessThanOrEqual(50);
    for (const item of value) expect(item.length).toBeLessThanOrEqual(4096);
  });

  test('nested arrays share one size bound instead of multiplying theirs', () => {
    const huge = { minItems: 10_000_000 };
    const value = valueForSchema(
      createRandom(1),
      {
        type: 'array',
        ...huge,
        items: {
          type: 'array',
          ...huge,
          items: {
            type: 'array',
            ...huge,
            items: { type: 'string', minLength: 10_000_000 },
          },
        },
      },
      'items',
      { keywords: [], locale: 'en' },
    );
    // Per-array bounds alone allow 50 × 50 × 50 strings of 4,096 characters.
    expect(JSON.stringify(value).length).toBeLessThan(400_000);
  });

  test('cluster workers split the provider-wide stream limit', () => {
    expect(workerStreamLimit(0, 4)).toBe(0);
    expect(workerStreamLimit(500, 4)).toBe(125);
    expect(workerStreamLimit(3, 4)).toBe(1);
    expect(workerStreamLimit(10, 1)).toBe(10);
  });
});

describe('the server', () => {
  let mock: MockServer | null = null;
  afterEach(async () => {
    await mock?.close();
    mock = null;
  });

  const chat = (url: string, content: string, stream = true) =>
    fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer k',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'load-chat-fast',
        stream,
        messages: [{ role: 'user', content }],
      }),
    });

  test('answers health and exposes its own metrics', async () => {
    mock = await createMockServer(
      {
        port: 0,
        seed: 1,
        ttftMedianMs: 5,
        ttftP95Ms: 10,
        rate429: 0,
        rate5xx: 0,
      },
      {},
    );
    expect((await fetch(`${mock.url}/health`)).status).toBe(200);
    await (await chat(mock.url, 'Hi [[mock:tokens=5]]', false)).text();
    const metrics = await (await fetch(`${mock.url}/metrics`)).text();
    expect(metrics).toContain('tale_load_mock_');
    expect(metrics).toMatch(/route="\/v1\/chat\/completions"/);
  });

  test('a stream past the concurrency limit is refused with 429', async () => {
    mock = await createMockServer(
      {
        port: 0,
        seed: 1,
        maxConcurrentStreams: 1,
        ttftMedianMs: 300,
        ttftP95Ms: 300,
        rate429: 0,
        rate5xx: 0,
      },
      {},
    );
    const held = await chat(mock.url, 'Hi [[mock:tokens=50]]');
    expect(held.status).toBe(200);
    const refused = await chat(mock.url, 'Hi');
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).not.toBeNull();
    await refused.text();
    await held.text();
  });

  test('a stall goes silent mid-stream', async () => {
    mock = await createMockServer(
      {
        port: 0,
        seed: 1,
        ttftMedianMs: 5,
        ttftP95Ms: 5,
        tokensPerSecondMean: 20_000,
        tokensPerSecondSd: 0,
        rate429: 0,
        rate5xx: 0,
      },
      {},
    );
    const response = await chat(
      mock.url,
      'Hi [[mock:stall=400]] [[mock:tokens=40]]',
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    let last = performance.now();
    let longestGap = 0;
    for (;;) {
      const next = await reader.read();
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last);
      last = now;
      if (next.done) break;
    }
    expect(longestGap).toBeGreaterThanOrEqual(350);
  });
});
