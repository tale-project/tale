import { afterEach, describe, expect, it, vi } from 'vitest';

import { Reranker, type RerankableResult } from './reranker';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Reranker', () => {
  it('fails fast when configured with the local provider', () => {
    expect(() => new Reranker({ provider: 'local' })).toThrow(
      'Local reranking',
    );
  });

  it('returns empty for no results', async () => {
    const reranker = new Reranker({ apiBaseUrl: 'https://rerank.example' });
    expect(await reranker.rerank('q', [])).toEqual([]);
  });

  it('returns originals (trimmed) when no apiBaseUrl is configured', async () => {
    const reranker = new Reranker();
    const results: RerankableResult[] = [
      { id: 1, content: 'a' },
      { id: 2, content: 'b' },
      { id: 3, content: 'c' },
    ];
    const out = await reranker.rerank('q', results, 2);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
  });

  it('re-ranks via the API and sorts by relevance score', async () => {
    const reranker = new Reranker({ apiBaseUrl: 'https://rerank.example' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 0, relevance_score: 0.2 },
            { index: 1, relevance_score: 0.9 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const results: RerankableResult[] = [
      { id: 1, content: 'a' },
      { id: 2, content: 'b' },
    ];
    const out = await reranker.rerank('q', results, 10);
    expect(out[0].id).toBe(2);
    expect(out[0].reranking_score).toBe(0.9);
    expect(out[1].id).toBe(1);
  });

  it('returns originals on an API error', async () => {
    const reranker = new Reranker({ apiBaseUrl: 'https://rerank.example' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    const results: RerankableResult[] = [{ id: 1, content: 'a' }];
    const out = await reranker.rerank('q', results, 10);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it('sends an auth header when an api key is configured', async () => {
    const reranker = new Reranker({
      apiBaseUrl: 'https://rerank.example',
      apiKey: 'secret',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await reranker.rerank('q', [{ id: 1, content: 'a' }]);
    const init = fetchSpy.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret');
  });
});
