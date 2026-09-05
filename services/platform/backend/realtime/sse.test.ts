// @vitest-environment node

import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { AuthEnv } from '../auth/session.ts';
import { createEventsHandler } from './sse.ts';

/**
 * A `postgres` stand-in: the tagged-template call is answered by query text.
 * The handler's own reads (outbox tail, hints) come back empty; the tests
 * steer the three authorization reads — member row, organization row,
 * session row — between polls.
 */
function fakeSql(answer: (text: string) => unknown[]) {
  return ((strings: TemplateStringsArray) =>
    Promise.resolve(answer(strings.join('?')))) as unknown as Parameters<
    typeof createEventsHandler
  >[0];
}

const MEMBER = { id: 'm1', organizationId: 'o1', userId: 'u1', role: 'member' };

function appWith(
  answer: (text: string) => unknown[],
  options = { pollIntervalMs: 5, authRecheckIntervalMs: 20 },
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    c.set('sessionBundle', {
      user: { id: 'u1', email: 'u1@example.com', name: 'U1' },
      session: { id: 's1' },
    });
    await next();
  });
  app.get('/events', createEventsHandler(fakeSql(answer), options));
  return app;
}

/** Read the SSE body to its end, or give up after `timeoutMs`. */
async function drain(
  response: Response,
  timeoutMs: number,
): Promise<{ text: string; ended: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel();
      return { text, ended: false };
    }
    const next = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), remaining),
      ),
    ]);
    if (next === 'timeout') {
      await reader.cancel();
      return { text, ended: false };
    }
    if (next.done) return { text, ended: true };
    text += decoder.decode(next.value, { stream: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /events re-proves the reader while the stream is open', () => {
  test('a member disabled mid-stream is told forbidden and the stream ends', async () => {
    let role = 'member';
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) return [{ ...MEMBER, role }];
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    expect(response.status).toBe(200);
    // The connect-time check passed; now the membership is soft-removed.
    role = 'disabled';
    const { text, ended } = await drain(response, 2_000);
    expect(ended).toBe(true);
    expect(text).toContain('event: forbidden');
  });

  test('a member hard-removed mid-stream ends the same way', async () => {
    let memberRows: unknown[] = [MEMBER];
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) return memberRows;
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    memberRows = [];
    const { text, ended } = await drain(response, 2_000);
    expect(ended).toBe(true);
    expect(text).toContain('event: forbidden');
  });

  test('a session revoked mid-stream ends the stream too', async () => {
    let sessionRows: unknown[] = [{ id: 's1' }];
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) return [MEMBER];
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return sessionRows;
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    // Idle enforcement (or a member removal) deleted the session row.
    sessionRows = [];
    const { text, ended } = await drain(response, 2_000);
    expect(ended).toBe(true);
    expect(text).toContain('event: forbidden');
  });

  test('a still-authorized reader is never ended by the re-check', async () => {
    let memberReads = 0;
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) {
        memberReads += 1;
        return [MEMBER];
      }
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    const { text, ended } = await drain(response, 150);
    expect(ended).toBe(false);
    expect(text).not.toContain('forbidden');
    // Connect-time read plus several interval re-checks: the cadence ran.
    expect(memberReads).toBeGreaterThan(2);
  });

  test('a database fault during the re-check backs off instead of ending a legitimate stream', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let mode: 'ok' | 'fault' | 'gone' = 'ok';
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) {
        if (mode === 'fault') throw new Error('connection reset');
        return mode === 'gone' ? [] : [MEMBER];
      }
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    mode = 'fault';
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    // The fault lands on the first re-check; the stream must still be open
    // after it (the poll backs off a second and retries). The read stays
    // pending across the probe — a fresh read would race it for the chunk.
    let pending = reader.read();
    const probe = await Promise.race([
      pending,
      new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 300)),
    ]);
    expect(probe).toBe('open');
    // Once the database answers again with a definite refusal, the stream ends.
    mode = 'gone';
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3_000;
    for (;;) {
      const next = await Promise.race([
        pending,
        new Promise<'timeout'>((resolve) =>
          setTimeout(
            () => resolve('timeout'),
            Math.max(1, deadline - Date.now()),
          ),
        ),
      ]);
      if (next === 'timeout') {
        await reader.cancel();
        throw new Error(`stream did not end; saw: ${text}`);
      }
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      pending = reader.read();
    }
    expect(text).toContain('event: forbidden');
  });
});
