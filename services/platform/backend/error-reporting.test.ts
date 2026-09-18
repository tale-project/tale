import { createServer, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

import * as Sentry from '@sentry/node';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../lib/net/safe-fetch.ts';
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
/** Request headers of every plain `/probe` GET the fake server received. */
const probeRequests: Record<string, string | string[] | undefined>[] = [];
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
  const tracesSampleRateBefore = process.env.SENTRY_TRACES_SAMPLE_RATE;

  beforeAll(async () => {
    // The production condition: the deployment's shared env file carries
    // the browser's `SENTRY_TRACES_SAMPLE_RATE` into the backend containers
    // (the CLI writes `'0'` by default), and the SDK reads it. With it set,
    // `tracePropagationTargets: []` alone stopped nothing on the wire
    // (2026-09-18 evaluation, J6-1) — so the whole suite runs with it.
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0';
    ingest = createServer((req, res) => {
      if (req.url?.startsWith('/probe')) {
        // A plain outgoing request from this process — what a third-party
        // site the crawler visits receives. (The query string varies per
        // request so the propagation decision cache never answers for a
        // URL it has already judged.)
        probeRequests.push({ ...req.headers });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
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
    if (tracesSampleRateBefore === undefined) {
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    } else {
      process.env.SENTRY_TRACES_SAMPLE_RATE = tracesSampleRateBefore;
    }
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

  it('stamps no trace headers onto outgoing requests, the sample-rate knob in the environment included', async () => {
    // The crawler carried `sentry-trace` and `baggage` — release, public
    // key, environment — to every third-party site it visited (2026-09-15
    // evaluation, i6): the SDK propagates them onto every outgoing fetch by
    // default, tracing sampled or not. The empty target list turns the
    // Sentry-native hook off; with `SENTRY_TRACES_SAMPLE_RATE` in the
    // environment the SDK also registered OpenTelemetry's request
    // instrumentation, whose propagator ignores the list for an unsampled
    // span, and the headers went out again (2026-09-18 evaluation, J6-1).
    // The wire is what proves it — on the global `fetch` and on the pinned
    // dispatcher the crawler's `safeFetch` dials through.
    const options = Sentry.getClient()?.getOptions();
    expect(options?.tracePropagationTargets).toEqual([]);
    // The knob reached the SDK: span recording is on, at zero.
    expect(options?.tracesSampleRate).toBe(0);
    const res = await fetch(`http://127.0.0.1:${ingestPort}/probe`);
    expect(res.status).toBe(200);
    const headers = probeRequests.at(-1);
    expect(headers).toBeDefined();
    expect(headers).not.toHaveProperty('sentry-trace');
    expect(headers).not.toHaveProperty('baggage');

    const pinned = await safeFetch(
      `http://127.0.0.1:${ingestPort}/probe?leg=crawler`,
      {
        allowPrivateAddresses: true,
        allowedHosts: ['127.0.0.1'],
      },
    );
    expect(pinned.status).toBe(200);
    const crawlerHeaders = probeRequests.at(-1);
    expect(crawlerHeaders).not.toHaveProperty('sentry-trace');
    expect(crawlerHeaders).not.toHaveProperty('baggage');
  });

  it('would stamp them without the target list — the negative above is a decision, not an inactive hook', async () => {
    // The positive control: the same client, the target list lifted, a URL
    // the propagation decision cache has not seen — the headers appear, so
    // the instrumentation is live in this process and the empty list is
    // what keeps them off.
    const options = Sentry.getClient()?.getOptions();
    expect(options).toBeDefined();
    if (options === undefined) return;
    const targets = options.tracePropagationTargets;
    options.tracePropagationTargets = undefined;
    try {
      const res = await fetch(`http://127.0.0.1:${ingestPort}/probe?control=1`);
      expect(res.status).toBe(200);
      const headers = probeRequests.at(-1);
      expect(headers).toHaveProperty('sentry-trace');
      expect(headers).toHaveProperty('baggage');
    } finally {
      options.tracePropagationTargets = targets;
    }
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
