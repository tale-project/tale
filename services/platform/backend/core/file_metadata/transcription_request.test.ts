import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestTranscription } from './transcription_request';

const originalFetch = globalThis.fetch;

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  globalThis.fetch = Object.assign(
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    ),
    { preconnect: vi.fn() },
  );
}

function mockErrorResponse(status: number, body = 'upstream error') {
  globalThis.fetch = Object.assign(
    vi.fn().mockResolvedValue(new Response(body, { status })),
    { preconnect: vi.fn() },
  );
}

function makeBlob(byteLength: number): Blob {
  return new Blob([new Uint8Array(byteLength).fill(7)], {
    type: 'audio/ogg',
  });
}

const MODEL = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  modelId: 'whisper-1',
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('requestTranscription', () => {
  describe('request shape (OpenAI Whisper-compatible)', () => {
    it('POSTs multipart/form-data with file/model/response_format and parses segments', async () => {
      mockJsonResponse({
        text: 'hello world',
        duration: 4.2,
        segments: [{ id: 0, start: 0, end: 4.2, text: 'hello world' }],
      });

      const result = await requestTranscription({
        model: MODEL,
        blob: makeBlob(256),
        fileName: 'clip.ogg',
        timeoutMs: 1000,
      });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
      expect(url).toBe('https://api.example.com/v1/audio/transcriptions');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        'Bearer sk-test',
      );
      const body = init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('model')).toBe('whisper-1');
      expect(body.get('response_format')).toBe('verbose_json');
      expect((body.get('file') as File).name).toBe('clip.ogg');

      expect(result.text).toBe('hello world');
      expect(result.duration).toBe(4.2);
      expect(result.segments).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('throws with the HTTP status attached for non-2xx', async () => {
      mockErrorResponse(429, 'rate limited please retry');

      try {
        await requestTranscription({
          model: MODEL,
          blob: makeBlob(32),
          fileName: 'clip.ogg',
          timeoutMs: 1000,
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as Error).message).toMatch(/Transcription API 429/);
        expect((err as Error & { status?: number }).status).toBe(429);
      }
    });

    it('normalizes a missing text field to empty string', async () => {
      mockJsonResponse({});

      const result = await requestTranscription({
        model: MODEL,
        blob: makeBlob(32),
        fileName: 'clip.ogg',
        timeoutMs: 1000,
      });
      expect(result.text).toBe('');
    });
  });
});
