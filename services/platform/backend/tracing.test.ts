// @vitest-environment node

import { createServer, type IncomingHttpHeaders } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { serve } from '@hono/node-server';
import * as Sentry from '@sentry/node';
import { Hono } from 'hono';
import type { Job, JobResult, PgBoss, WorkOptions } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../lib/net/safe-fetch.ts';
import { flushErrorReporting, initErrorReporting } from './error-reporting.ts';
import { startWorker } from './jobs/runner.ts';
import {
  configureBackendTracing,
  requestTelemetry,
  traceBackendTask,
  traceWorkerPhase,
} from './tracing.ts';

type SpanEvent = {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  op?: string;
  status?: string;
  data?: Record<string, unknown>;
};
type Transaction = {
  type: string;
  transaction: string;
  contexts: { trace: SpanEvent };
  spans: SpanEvent[];
};

const transactions: Transaction[] = [];
const requests: IncomingHttpHeaders[] = [];
const server = createServer((req, res) => {
  if (req.url?.startsWith('/probe')) {
    requests.push(req.headers);
    res.end('ok');
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const body =
      req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
    for (const line of body.toString('utf8').split('\n')) {
      if (!line) continue;
      const event = JSON.parse(line) as Transaction;
      if (event.type === 'transaction') transactions.push(event);
    }
    res.end('{}');
  });
});
let port: number;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('no test port');
  port = address.port;
});

afterAll(async () => {
  configureBackendTracing(false);
  await Sentry.close(2000);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('manual backend spans', () => {
  it('runs 20,000 disabled tasks without an SDK scope or span', () => {
    const promise = Promise.resolve(42);
    let spans = 0;
    let wrappedPromises = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const result = traceBackendTask('noop', (span) => {
        if (span !== undefined || Sentry.getActiveSpan() !== undefined)
          spans += 1;
        return traceWorkerPhase('handler', () => promise);
      });
      if (result !== promise) wrappedPromises += 1;
    }
    expect(spans).toBe(0);
    expect(wrappedPromises).toBe(0);
  });

  it('exports sampled HTTP spans with only operational metadata', async () => {
    expect(
      initErrorReporting({
        dsn: `http://publickey@127.0.0.1:${port}/42`,
        role: 'test',
        tracesSampleRate: 1,
      }),
    ).toBe(true);
    const app = new Hono();
    app.use(requestTelemetry());
    app.get('/api/app/tasks/:id', (c) => c.text('ok'));
    const status = await Sentry.withIsolationScope(async (scope) => {
      scope.setExtra('jobPayload', 'private-payload');
      scope.setUser({ id: 'private-user' });
      scope.setTag('organization', 'private-org');
      scope.addBreadcrumb({ message: 'private-breadcrumb' });
      const response = await app.request(
        '/api/app/tasks/private-id?token=private-token',
        {
          headers: {
            cookie: 'session=private-cookie',
            'sentry-trace': `${'1'.repeat(32)}-${'2'.repeat(16)}-0`,
          },
        },
      );
      return response.status;
    });
    expect(status).toBe(200);
    await flushErrorReporting();
    const event = transactions.find(
      (entry) => entry.transaction === 'GET /api/app/tasks',
    );
    expect(event).toBeDefined();
    expect(event?.contexts.trace.op).toBe('http.server');
    expect(event?.contexts.trace.trace_id).not.toBe('1'.repeat(32));
    expect(event?.contexts.trace.data).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/api/app/tasks',
      'http.response.status_code': 200,
    });
    expect(JSON.stringify(event)).not.toContain('private-');
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('breadcrumbs');
    expect(event).not.toHaveProperty('extra');
    const integrations = Sentry.getClient()
      ?.getOptions()
      .integrations.map((i) => i.name);
    expect(integrations).not.toContain('Postgres');
    expect(integrations).not.toContain('OpenAI');
  });

  it('scrubs a real HTTP request and ignores incoming sampling headers', async () => {
    const app = new Hono();
    app.use(requestTelemetry());
    app.post('/api/app/chat/:id', async (c) => {
      await c.req.text();
      return c.text('ok');
    });
    const listening = Promise.withResolvers<number>();
    const http = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
      (info) => listening.resolve(info.port),
    );
    try {
      const httpPort = await listening.promise;
      const response = await fetch(
        `http://127.0.0.1:${httpPort}/api/app/chat/private-thread?token=private-token`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer private-key',
            cookie: 'session=private-cookie',
            'sentry-trace': `${'3'.repeat(32)}-${'4'.repeat(16)}-0`,
          },
          body: 'private-request-body',
        },
      );
      expect(await response.text()).toBe('ok');
      await flushErrorReporting();
      const event = transactions.find(
        (entry) => entry.transaction === 'POST /api/app/chat',
      );
      expect(event).toBeDefined();
      expect(event?.contexts.trace.trace_id).not.toBe('3'.repeat(32));
      expect(JSON.stringify(event)).not.toContain('private-');
      expect(event?.contexts.trace.data).toMatchObject({
        'http.response.status_code': 200,
      });
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });

  it('completes handled HTTP failures and bounds unknown request names', async () => {
    const app = new Hono();
    app.use(requestTelemetry());
    app.onError((_error, c) => c.text('failed', 500));
    app.get('/api/app/private-domain', () => {
      throw new Error('private-failure');
    });
    expect((await app.request('/api/app/private-domain')).status).toBe(500);
    await flushErrorReporting();
    const event = transactions.find(
      (entry) => entry.transaction === 'GET /api/app',
    );
    expect(event?.contexts.trace.status).toBe('internal_error');
    expect(JSON.stringify(event)).not.toContain('private-');
  });

  it('isolates concurrent worker jobs and finishes failed handler spans', async () => {
    let run: ((jobs: Job[]) => Promise<JobResult[]>) | undefined;
    const boss = {
      work: async (
        _name: string,
        _options: WorkOptions,
        handler: typeof run,
      ) => {
        run = handler;
      },
    } as unknown as PgBoss;
    await startWorker({
      boss,
      taskList: {
        noop: async (data) => {
          await Promise.resolve();
          if (data === 'private-fail') throw new Error('private-job-error');
        },
      },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await run?.([
        { id: 'private-job-a', data: 'ok' },
        { id: 'private-job-b', data: 'private-fail' },
      ] as unknown as Job[]);
      expect(result?.map((entry) => entry.status)).toEqual([
        'completed',
        'failed',
      ]);
      await flushErrorReporting();
    } finally {
      log.mockRestore();
    }
    const events = transactions.filter((event) => event.transaction === 'noop');
    expect(events).toHaveLength(2);
    expect(
      new Set(events.map((event) => event.contexts.trace.trace_id)).size,
    ).toBe(2);
    const failed = events.find(
      (event) => event.contexts.trace.status === 'internal_error',
    );
    expect(failed).toBeDefined();
    expect(failed?.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'queue.handler',
          status: 'internal_error',
          parent_span_id: failed?.contexts.trace.span_id,
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('private-');
  });

  it('sends no external trace headers while a sampled task is active', async () => {
    await traceBackendTask('noop', async () => {
      await fetch(`http://127.0.0.1:${port}/probe?sampled=1`);
      await safeFetch(`http://127.0.0.1:${port}/probe?crawler=1`, {
        allowPrivateAddresses: true,
        allowedHosts: ['127.0.0.1'],
      });
    });
    expect(requests).toHaveLength(2);
    for (const headers of requests) {
      expect(headers).not.toHaveProperty('sentry-trace');
      expect(headers).not.toHaveProperty('baggage');
      expect(headers).not.toHaveProperty('traceparent');
    }
  });
});
