/**
 * One virtual user against a stand-in platform: the session lifecycle
 * (adopt, boot, hold the hint stream), the reactions (401 → sign in again,
 * hostile input → a finding only on 5xx), the cross-user hint latency, and
 * the contract's promises — never throw, stop promptly, close every stream.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';

import { createAgent } from '../../src/client/index.ts';
import { MetricsRegistry, summarize } from '../../src/metrics/index.ts';
import { mulberry32 } from '../../src/runner/assign.ts';
import {
  type PersonaName,
  type ScenarioOptions,
  type VirtualUserContext,
  scenarioOptionsSchema,
} from '../../src/scenario/contract.ts';
import { runVirtualUser } from '../../src/scenario/index.ts';
import {
  SERVER_ERROR_ON_BAD_INPUT,
  probe,
} from '../../src/scenario/journeys/fuzz.ts';
import { HINT_LATENCY } from '../../src/scenario/registry.ts';
import { VirtualUser } from '../../src/scenario/user.ts';
import { unusedPort } from '../client/test-server.ts';
import {
  type FakePlatform,
  fakePlan,
  startFakePlatform,
} from './fake-platform.ts';

// A user lives for a second or two here: well past bun's 5 s default with
// the waits for its first journeys.
setDefaultTimeout(20_000);

const agent = createAgent({ keepAliveTimeoutMs: 500 });
let platform: FakePlatform | null = null;

afterEach(async () => {
  await platform?.close();
  platform = null;
});

function context(
  baseUrl: string,
  persona: PersonaName,
  overrides: Partial<ScenarioOptions> = {},
  index = 1,
): { ctx: VirtualUserContext; controller: AbortController } {
  const controller = new AbortController();
  return {
    controller,
    ctx: {
      index,
      plan: fakePlan(baseUrl),
      baseUrl,
      agent,
      metrics: new MetricsRegistry(),
      authSecret: 'test-auth-secret',
      persona,
      random: mulberry32(1_000 + index),
      options: scenarioOptionsSchema.parse({
        thinkTimeScale: 0.01,
        passwordSignInRate: 0,
        sessionSeconds: 0,
        requestTimeoutMs: 2_000,
        turnTimeoutMs: 5_000,
        ...overrides,
      }),
      signal: controller.signal,
      forwardedFor: '198.18.0.42',
    },
  };
}

async function until(
  condition: () => boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return condition();
}

/** Stop the user and measure how long it takes to wind down. */
async function stop(
  controller: AbortController,
  running: Promise<void>,
): Promise<number> {
  const stoppedAt = performance.now();
  controller.abort();
  await running;
  return performance.now() - stoppedAt;
}

function scenarioErrors(metrics: MetricsRegistry): string[] {
  return summarize(metrics.snapshot())
    .errors.filter((e) => e.name === 'scenario' || e.name === 'user')
    .map((e) => `${e.kind}: ${e.samples[0] ?? ''}`);
}

/**
 * Streams the user holds open, as its own gauges count them. (The server's
 * view lags under Bun, whose sockets report a client abort late; under
 * Node, the runtime the harness runs on, it is immediate.)
 */
function openStreams(metrics: MetricsRegistry): number {
  const gauges = metrics.snapshot().gauges;
  return (
    (gauges['sse.events.open']?.current ?? 0) +
    (gauges['sse.thread.open']?.current ?? 0)
  );
}

function counter(metrics: MetricsRegistry, name: string): number {
  return metrics.snapshot().counters[name] ?? 0;
}

describe('runVirtualUser', () => {
  test('adopts the seeded session, boots the dashboard, holds /events', async () => {
    platform = await startFakePlatform();
    const fake = platform;
    const { ctx, controller } = context(fake.url, 'browser');
    const running = runVirtualUser(ctx);
    expect(await until(() => counter(ctx.metrics, 'session.started') > 0)).toBe(
      true,
    );
    expect(await until(() => fake.openStreams() > 0)).toBe(true);
    // Let a journey or two run.
    await until(
      () => fake.requests.filter((r) => r.path === '/api/app/tasks').length > 2,
    );
    const elapsed = await stop(controller, running);
    expect(elapsed).toBeLessThan(1_500);
    expect(openStreams(ctx.metrics)).toBe(0);

    const routes = new Set(fake.requests.map((r) => `${r.method} ${r.path}`));
    for (const route of [
      'GET /api/auth/get-session',
      'GET /api/app/two-factor/status',
      'GET /api/app/users/password-expiry',
      'GET /api/app/users/me',
      'GET /api/app/organizations',
      'GET /api/app/users/last-active-org',
      'GET /api/app/members/me',
      'GET /api/app/teams/mine',
      'GET /api/app/chat/threads',
      'GET /api/app/projects',
      'GET /api/app/tasks',
      'GET /api/app/user-preferences',
      'GET /api/app/notifications/unread-count',
      'GET /api/app/collab/notifications/unread-count',
      'GET /api/app/chat/composer/models',
      'GET /events',
    ]) {
      expect(routes.has(route)).toBe(true);
    }
    // Minted session: no password sign-in; every request names the user's
    // address and carries the signed seeded cookie.
    expect(routes.has('POST /api/auth/sign-in/email')).toBe(false);
    for (const request of fake.requests) {
      expect(request.headers['x-forwarded-for']).toBe('198.18.0.42');
      expect(request.headers.cookie).toContain('better-auth.session_token=');
    }
    const events = fake.requests.find((r) => r.path === '/events');
    expect(events?.query.get('orgId')).toBe('org-0');
    expect(events?.headers.accept).toBe('text/event-stream');
    const orgScoped = fake.requests.filter(
      (r) =>
        r.path.startsWith('/api/app/tasks') || r.path === '/api/app/members/me',
    );
    for (const request of orgScoped) {
      expect(request.query.get('orgId')).toBe('org-0');
    }
    expect(scenarioErrors(ctx.metrics)).toEqual([]);
  });

  test('a 401 signs the user in again and the session carries on', async () => {
    platform = await startFakePlatform();
    const fake = platform;
    let refused = false;
    fake.overrides.push((request, response) => {
      if (refused || request.path !== '/api/app/projects') return false;
      refused = true;
      response.statusCode = 401;
      response.end('{"error":"unauthorized"}');
      return true;
    });
    const { ctx, controller } = context(fake.url, 'browser');
    const running = runVirtualUser(ctx);
    expect(
      await until(() => counter(ctx.metrics, 'auth.reauthenticate') > 0),
    ).toBe(true);
    expect(await until(() => counter(ctx.metrics, 'auth.password') > 0)).toBe(
      true,
    );
    const signInAt = fake.requests.findIndex(
      (r) => r.path === '/api/auth/sign-in/email',
    );
    expect(signInAt).toBeGreaterThan(-1);
    expect(fake.requests[signInAt]?.headers.origin).toBe(fake.url);
    // After the new sign-in the user keeps working with the fresh cookie.
    expect(
      await until(() =>
        fake.requests
          .slice(signInAt + 1)
          .some((r) => r.headers.cookie?.includes('fresh.sig') === true),
      ),
    ).toBe(true);
    await stop(controller, running);
    expect(scenarioErrors(ctx.metrics)).toEqual([]);
  });

  test('stops promptly mid chat turn and closes the thread lane', async () => {
    platform = await startFakePlatform();
    const fake = platform;
    fake.overrides.push((request, response) => {
      if (
        request.method === 'POST' &&
        request.path === '/api/app/chat/threads'
      ) {
        response.statusCode = 201;
        response.setHeader('content-type', 'application/json');
        response.end('{"id":"thread-1"}');
        return true;
      }
      // The send is held open for the whole turn: this one never ends.
      return (
        request.method === 'POST' &&
        request.path === '/api/app/chat/threads/thread-1/messages'
      );
    });
    const { ctx, controller } = context(fake.url, 'chatter');
    const running = runVirtualUser(ctx);
    expect(
      await until(() =>
        fake.requests.some(
          (r) =>
            r.method === 'POST' &&
            r.path === '/api/app/chat/threads/thread-1/messages',
        ),
      ),
    ).toBe(true);
    const send = fake.requests.find(
      (r) => r.path === '/api/app/chat/threads/thread-1/messages',
    );
    const body = JSON.parse(send?.body ?? '{}') as Record<string, unknown>;
    expect(body.modelId).toBe('load-chat-fast');
    expect(body.providerSlug).toBe('loadmock');
    expect(typeof body.text).toBe('string');
    expect(
      fake.requests.some(
        (r) => r.path === '/api/app/chat/threads/thread-1/stream',
      ),
    ).toBe(true);
    const elapsed = await stop(controller, running);
    expect(elapsed).toBeLessThan(1_500);
    expect(openStreams(ctx.metrics)).toBe(0);
    expect(scenarioErrors(ctx.metrics)).toEqual([]);
  });

  test('a task write reaching another tab records the hint latency', async () => {
    platform = await startFakePlatform();
    const fake = platform;
    fake.overrides.push((request, response) => {
      if (request.method !== 'POST' || request.path !== '/api/app/tasks') {
        return false;
      }
      response.setHeader('content-type', 'application/json');
      response.end('{"taskId":"task-77"}');
      // The outbox tail fans the change out a moment later.
      setTimeout(() => fake.hint('task', 'task-77'), 40);
      return true;
    });
    const { ctx, controller } = context(fake.url, 'task-worker');
    const running = runVirtualUser(ctx);
    const recorded = await until(
      () => (ctx.metrics.snapshot().timings[HINT_LATENCY] ?? null) !== null,
      8_000,
    );
    await stop(controller, running);
    expect(recorded).toBe(true);
    expect(counter(ctx.metrics, 'tasks.created')).toBeGreaterThan(0);
    const created = fake.requests.find(
      (r) => r.method === 'POST' && r.path === '/api/app/tasks',
    );
    const draft = JSON.parse(created?.body ?? '{}') as Record<string, unknown>;
    expect(draft.projectId).toBe('project-0');
    expect(typeof draft.title).toBe('string');
    expect(scenarioErrors(ctx.metrics)).toEqual([]);
  });

  test('never throws when the deployment is unreachable', async () => {
    const port = await unusedPort();
    const { ctx, controller } = context(`http://127.0.0.1:${port}`, 'browser');
    const running = runVirtualUser(ctx);
    await until(() =>
      Object.keys(ctx.metrics.snapshot().errors).some((name) =>
        name.startsWith('GET '),
      ),
    );
    const elapsed = await stop(controller, running);
    expect(elapsed).toBeLessThan(1_500);
    const kinds = summarize(ctx.metrics.snapshot()).errors.map((e) => e.kind);
    expect(kinds.some((kind) => kind.startsWith('net_'))).toBe(true);
    expect(scenarioErrors(ctx.metrics)).toEqual([]);
  });
});

describe('fuzz probes', () => {
  test('a 5xx on hostile input is a finding, a 4xx a counted refusal', async () => {
    platform = await startFakePlatform();
    const fake = platform;
    fake.overrides.push((request, response) => {
      if (request.path === '/api/app/users/update-name') {
        response.statusCode = 500;
        response.end('Internal Server Error');
        return true;
      }
      if (request.method === 'POST' && request.path === '/api/app/projects') {
        response.statusCode = 400;
        response.end('{"error":"invalid body"}');
        return true;
      }
      return false;
    });
    const { ctx } = context(fake.url, 'fuzzer');
    const vu = new VirtualUser(ctx);
    expect(await vu.startSession()).toBe(true);
    await probe(vu, {
      method: 'POST',
      path: '/api/app/users/update-name',
      json: { name: '\u0000nul\u0000byte' },
      name: 'POST /api/app/users/update-name',
    });
    await probe(vu, {
      method: 'POST',
      path: '/api/app/projects',
      query: { orgId: vu.orgId },
      json: { name: '' },
      name: 'POST /api/app/projects',
    });
    vu.closeStreams();
    const errors = summarize(ctx.metrics.snapshot()).errors;
    const finding = errors.find((e) => e.kind === SERVER_ERROR_ON_BAD_INPUT);
    expect(finding?.name).toBe('FUZZ POST /api/app/users/update-name');
    // The sample names the input that provoked it, NUL escaped.
    expect(finding?.samples[0]).toContain('\\u0000nul');
    expect(errors.some((e) => e.kind === 'http_400')).toBe(false);
    expect(errors.some((e) => e.kind === 'http_500')).toBe(false);
    expect(counter(ctx.metrics, 'fuzz.rejected')).toBe(1);
    expect(counter(ctx.metrics, 'fuzz.server_errors')).toBe(1);
  });
});
