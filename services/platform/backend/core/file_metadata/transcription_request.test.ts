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

const MULTIPART_MODEL = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  modelId: 'whisper-1',
  transcriptionMode: 'multipart' as const,
};

const JSON_MODEL = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
  modelId: 'openai/whisper-1',
  transcriptionMode: 'json-base64' as const,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('requestTranscription', () => {
  describe('multipart mode (OpenAI Whisper-compatible)', () => {
    it('POSTs multipart/form-data with file/model/response_format and parses segments', async () => {
      mockJsonResponse({
        text: 'hello world',
        duration: 4.2,
        segments: [{ id: 0, start: 0, end: 4.2, text: 'hello world' }],
      });

      const result = await requestTranscription({
        model: MULTIPART_MODEL,
        blob: makeBlob(256),
        fileName: 'clip.ogg',
        format: 'ogg',
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

    it('defaults to multipart when transcriptionMode is omitted', async () => {
      mockJsonResponse({ text: 'ok' });

      await requestTranscription({
        model: {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
          modelId: 'whisper-1',
        },
        blob: makeBlob(64),
        fileName: 'clip.ogg',
        format: 'ogg',
        timeoutMs: 1000,
      });

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
      expect(init?.body).toBeInstanceOf(FormData);
    });
  });

  describe('json-base64 mode (OpenRouter)', () => {
    it('POSTs a JSON input_audio envelope and parses text', async () => {
      mockJsonResponse({
        text: 'hello from openrouter',
        usage: { cost: 0.01 },
      });

      const result = await requestTranscription({
        model: JSON_MODEL,
        blob: makeBlob(128),
        fileName: 'clip.ogg',
        format: 'ogg',
        timeoutMs: 1000,
      });

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
      expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
      expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe(
        'application/json',
      );
      const parsed = JSON.parse(init?.body as string) as {
        model: string;
        input_audio: { data: string; format: string };
      };
      expect(parsed.model).toBe('openai/whisper-1');
      expect(parsed.input_audio.format).toBe('ogg');
      // 128 bytes of 0x07 → valid base64, non-empty.
      expect(parsed.input_audio.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(Buffer.from(parsed.input_audio.data, 'base64')).toHaveLength(128);

      expect(result.text).toBe('hello from openrouter');
      // OpenRouter returns no segments/duration — they degrade gracefully.
      expect(result.duration).toBeUndefined();
      expect(result.segments).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws with the HTTP status attached for non-2xx', async () => {
      mockErrorResponse(429, 'rate limited please retry');

      try {
        await requestTranscription({
          model: JSON_MODEL,
          blob: makeBlob(32),
          fileName: 'clip.ogg',
          format: 'ogg',
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
        model: JSON_MODEL,
        blob: makeBlob(32),
        fileName: 'clip.ogg',
        format: 'ogg',
        timeoutMs: 1000,
      });
      expect(result.text).toBe('');
    });
  });
});
