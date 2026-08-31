import { createServer, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  appErrorHandler,
  errorReportingEnabled,
  flushErrorReporting,
  initErrorReporting,
  reportError,
} from './error-reporting.ts';

/**
 * The module holds one process-wide SDK, so ordering is load-bearing: the
 * disabled-path suite runs first, then one real `init` against a local fake
 * ingest server serves every reporting assertion. The fake server speaks
 * just enough of the envelope protocol to prove events leave the process
 * over real HTTP — which is the actual contract ("respects SENTRY_DSN"),
 * not an internals mock.
 */

interface CapturedEnvelope {
  url: string;
  events: Record<string, unknown>[];
}

const captured: CapturedEnvelope[] = [];
let ingest: Server;
let ingestPort: number;

function parseEnvelope(url: string, raw: Buffer, gzipped: boolean): void {
  const body = (gzipped ? gunzipSync(raw) : raw).toString('utf8');
  // Envelope = newline-delimited JSON: header, then item-header/payload pairs.
  const events: Record<string, unknown>[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'exception' in parsed
      ) {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Non-JSON payload lines (attachments) are not what these tests read.
      console.warn('[test] skipping non-JSON envelope line');
    }
  }
  captured.push({ url, events });
}

function capturedEvents(): Record<string, unknown>[] {
  return captured.flatMap((envelope) => envelope.events);
}

describe('error reporting without a DSN', () => {
  it('stays disabled and every hook is a safe no-op', async () => {
    expect(initErrorReporting({ dsn: undefined, role: 'all' })).toBe(false);
    expect(errorReportingEnabled()).toBe(false);
    expect(() => reportError(new Error('never sent'))).not.toThrow();
    await expect(flushErrorReporting(10)).resolves.toBeUndefined();
  });
});

describe('error reporting with a DSN', () => {
  beforeAll(async () => {
    ingest = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        parseEnvelope(
          req.url ?? '',
          Buffer.concat(chunks),
          req.headers['content-encoding'] === 'gzip',
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => {
      ingest.listen(0, '127.0.0.1', resolve);
    });
    const address = ingest.address();
    if (address === null || typeof address === 'string') {
      throw new Error('fake ingest server has no port');
    }
    ingestPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      ingest.close(() => resolve());
    });
  });

  it('initializes against the DSN and reports over real HTTP', async () => {
    const dsn = `http://publickey@127.0.0.1:${ingestPort}/42`;
    expect(initErrorReporting({ dsn, role: 'test-role' })).toBe(true);
    expect(errorReportingEnabled()).toBe(true);

    reportError(new Error('boom-direct'), {
      tags: { 'tale.task': 'unit-test' },
      extra: { jobId: 'job-1' },
    });
    await flushErrorReporting();

    expect(captured.length).toBeGreaterThan(0);
    // Project id 42 from the DSN determines the ingest path (the SDK
    // appends sentry_key/sentry_version auth as query parameters).
    expect(captured[0]?.url).toMatch(/^\/api\/42\/envelope\/\?/);
    const event = capturedEvents().find((e) =>
      JSON.stringify(e).includes('boom-direct'),
    );
    expect(event).toBeDefined();
    const tags = event?.tags as Record<string, string>;
    expect(tags['tale.role']).toBe('test-role');
    expect(tags['tale.task']).toBe('unit-test');
    const extra = (event?.extra ?? {}) as Record<string, unknown>;
    expect(extra.jobId).toBe('job-1');
  });

  it('captures thrown route errors and keeps the stock 500 response', async () => {
    // Hono's default handler console.errors the throwable; keep the test
    // output clean while asserting the behavior is preserved.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const app = new Hono();
      app.onError(appErrorHandler);
      app.get('/throws', () => {
        throw new Error('boom-http');
      });

      const res = await app.request('http://localhost/throws');
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Internal Server Error');
      expect(consoleError).toHaveBeenCalled();

      await flushErrorReporting();
      const event = capturedEvents().find((e) =>
        JSON.stringify(e).includes('boom-http'),
      );
      expect(event).toBeDefined();
      const tags = event?.tags as Record<string, string>;
      expect(tags['http.method']).toBe('GET');
      expect(tags['http.route_class']).toBe('other');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('captures errors thrown inside mounted sub-apps', async () => {
    // createApp mounts every domain via `app.route(...)` — the production
    // topology is sub-apps bubbling into the parent's onError.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const sub = new Hono();
      sub.get('/boom', () => {
        throw new Error('boom-subapp');
      });
      const app = new Hono();
      app.onError(appErrorHandler);
      app.route('/api/app/widgets', sub);

      const res = await app.request('http://localhost/api/app/widgets/boom');
      expect(res.status).toBe(500);

      await flushErrorReporting();
      const event = capturedEvents().find((e) =>
        JSON.stringify(e).includes('boom-subapp'),
      );
      expect(event).toBeDefined();
      const tags = event?.tags as Record<string, string>;
      expect(tags['http.route_class']).toBe('/api/app/widgets');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('passes HTTPException through untouched and unreported', async () => {
    const app = new Hono();
    app.onError(appErrorHandler);
    app.get('/teapot', () => {
      throw new HTTPException(418, { message: 'teapot-refusal' });
    });

    const res = await app.request('http://localhost/teapot');
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('teapot-refusal');

    await flushErrorReporting();
    const leaked = capturedEvents().find((e) =>
      JSON.stringify(e).includes('teapot-refusal'),
    );
    expect(leaked).toBeUndefined();
  });
});
