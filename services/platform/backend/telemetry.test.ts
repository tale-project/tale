import * as client from 'prom-client';
import { afterEach, describe, expect, test } from 'vitest';

import {
  hintStreamClosed,
  hintStreamOpened,
  openHintStreamCount,
  registerBackendCollectors,
  routeClass,
} from './telemetry.ts';

afterEach(() => {
  client.register.clear();
});

describe('routeClass', () => {
  test('labels app routes by their domain segment, never the raw path', () => {
    expect(routeClass('/api/app/chat/threads/abc-123/messages')).toBe(
      '/api/app/chat',
    );
    expect(routeClass('/api/app/tasks/9f2/comments')).toBe('/api/app/tasks');
    // An id must never reach the label set — two ids collapse to one series.
    expect(routeClass('/api/app/documents/a')).toBe(
      routeClass('/api/app/documents/b'),
    );
  });

  test('collapses the machine doors and pre-auth lanes', () => {
    expect(routeClass('/api/auth/sign-in/email')).toBe('/api/auth');
    expect(routeClass('/api/tools/execute')).toBe('/api/tools');
    expect(routeClass('/api/v1/tasks/1')).toBe('/api/v1');
    expect(routeClass('/api/control/drain')).toBe('/api/control');
    expect(routeClass('/api/sso/callback/x')).toBe('/api/sso');
    expect(routeClass('/http_api/api/sso/callback/x')).toBe('/api/sso');
    expect(routeClass('/scim/v2/Users/7')).toBe('/scim/v2');
    expect(routeClass('/http_api/scim/v2/Groups')).toBe('/scim/v2');
    expect(routeClass('/api/automations/webhook/tok')).toBe(
      '/api/automations/webhook',
    );
    expect(routeClass('/dav/org/file.txt')).toBe('/dav');
  });

  test('keeps the fixed routes and buckets everything else', () => {
    expect(routeClass('/events')).toBe('/events');
    expect(routeClass('/ping')).toBe('/ping');
    expect(routeClass('/metrics')).toBe('/metrics');
    expect(routeClass('/whatever/else')).toBe('other');
  });
});

describe('hint-stream gauge', () => {
  test('pairs open/close and never goes negative', () => {
    const start = openHintStreamCount();
    hintStreamOpened();
    hintStreamOpened();
    expect(openHintStreamCount()).toBe(start + 2);
    hintStreamClosed();
    expect(openHintStreamCount()).toBe(start + 1);
    hintStreamClosed();
    hintStreamClosed();
    hintStreamClosed();
    // A double-close (abort + finally) must not drive the gauge below zero.
    expect(openHintStreamCount()).toBe(0);
  });
});

describe('pull-time collectors', () => {
  /** A `postgres` stand-in whose tagged-template call returns fixed rows. */
  function fakeSql(rowsByQuery: (text: string) => unknown[]) {
    return ((strings: TemplateStringsArray) =>
      Promise.resolve(rowsByQuery(strings.join('?')))) as unknown as Parameters<
      typeof registerBackendCollectors
    >[0];
  }

  test('reads generations, job states and the drain flag on scrape', async () => {
    const gauges = registerBackendCollectors(
      fakeSql((text) => {
        if (text.includes('app.generations')) return [{ count: '3' }];
        if (text.includes('pgboss.job')) {
          return [
            { state: 'created', count: '12' },
            { state: 'failed', count: '2' },
          ];
        }
        if (text.includes('backend_control')) return [{ draining: true }];
        return [];
      }),
    );
    // `register.metrics()` runs every registered `collect()` itself — the
    // real scrape path, so the test exercises what Prometheus would.
    expect(gauges).toHaveLength(4);
    const metrics = await client.register.metrics();
    expect(metrics).toContain('tale_backend_generations_inflight 3');
    expect(metrics).toContain('tale_backend_jobs{state="created"} 12');
    expect(metrics).toContain('tale_backend_jobs{state="failed"} 2');
    expect(metrics).toContain('tale_backend_drain_active 1');
  });

  test('a job state that empties between scrapes drops out of the series', async () => {
    let jobRows: unknown[] = [
      { state: 'created', count: '12' },
      { state: 'failed', count: '2' },
    ];
    registerBackendCollectors(
      fakeSql((text) => (text.includes('pgboss.job') ? jobRows : [])),
    );
    expect(await client.register.metrics()).toContain(
      'tale_backend_jobs{state="failed"} 2',
    );
    // The failed jobs were retried away: no GROUP BY row for that state.
    jobRows = [{ state: 'created', count: '3' }];
    const second = await client.register.metrics();
    expect(second).toContain('tale_backend_jobs{state="created"} 3');
    // A stale child would still read 2 here and keep a backlog alert firing.
    expect(second).not.toContain('state="failed"');
  });

  test('a failing query leaves its gauge unset instead of failing the scrape', async () => {
    const gauges = registerBackendCollectors(
      fakeSql(() => {
        throw new Error('connection reset');
      }),
    );
    expect(gauges).toHaveLength(4);
    // The scrape still renders: each collector swallowed its own failure.
    await expect(client.register.metrics()).resolves.toBeTypeOf('string');
  });
});
