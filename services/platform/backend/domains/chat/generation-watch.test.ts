// @vitest-environment node

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { describe, expect, test } from 'vitest';

import { createGenerationWatch } from './generation-watch.ts';

interface Generation {
  thread_id: string;
  org_id: string;
  message_id: string | null;
  text: string;
  reasoning: string;
  cancel_requested: boolean;
  updated_at_ms: number;
}

interface Message {
  id: string;
  org_id: string;
  thread_id: string;
  role: string;
  parts: unknown[];
  order: number;
}

/**
 * The generations and messages tables behind a `postgres` stand-in that
 * answers the watcher's reads and counts them: the point of the watcher is
 * how few reads a crowd of tabs costs.
 */
function chatWorld() {
  const world = {
    generations: new Map<string, Generation>(),
    messages: new Map<string, Message>(),
    queries: [] as string[],
    count(fragment: string): number {
      return world.queries.filter((text) => text.includes(fragment)).length;
    },
    start(threadId: string, orgId: string, messageId: string): void {
      world.generations.set(threadId, {
        thread_id: threadId,
        org_id: orgId,
        message_id: messageId,
        text: '',
        reasoning: '',
        cancel_requested: false,
        updated_at_ms: Date.now(),
      });
      world.messages.set(messageId, {
        id: messageId,
        org_id: orgId,
        thread_id: threadId,
        role: 'assistant',
        parts: [],
        order: 2,
      });
    },
    write(threadId: string, text: string, parts?: unknown[]): void {
      const generation = world.generations.get(threadId);
      if (generation === undefined) throw new Error('no generation');
      generation.text = text;
      generation.updated_at_ms = Math.max(
        Date.now(),
        generation.updated_at_ms + 1,
      );
      if (parts !== undefined && generation.message_id !== null) {
        const message = world.messages.get(generation.message_id);
        if (message !== undefined) message.parts = parts;
      }
    },
    finish(threadId: string): void {
      world.generations.delete(threadId);
    },
  };
  const light = (row: Generation) => ({
    threadId: row.thread_id,
    orgId: row.org_id,
    messageId: row.message_id,
    updatedAt: row.updated_at_ms,
  });
  const answer = (text: string, values: unknown[]): unknown[] => {
    world.queries.push(text);
    if (text.includes('FROM app.generations')) {
      const named = text.includes('ANY(')
        ? new Set(values[0] as string[])
        : null;
      const rows = [...world.generations.values()].filter(
        (row) => named === null || named.has(row.thread_id),
      );
      if (text.includes('text, reasoning')) {
        return rows.map((row) => ({
          ...light(row),
          text: row.text,
          reasoning: row.reasoning,
          cancelRequested: row.cancel_requested,
        }));
      }
      return rows.map(light);
    }
    if (text.includes('SELECT id, parts FROM app.messages')) {
      const ids = values[0] as string[];
      return ids
        .map((id) => world.messages.get(id))
        .filter((row): row is Message => row !== undefined)
        .map((row) => ({ id: row.id, parts: row.parts }));
    }
    if (text.includes('FROM app.messages')) {
      const ids = values[0] as string[];
      return ids
        .map((id) => world.messages.get(id))
        .filter((row): row is Message => row !== undefined)
        .map((row) => ({
          id: row.id,
          role: row.role,
          parts: row.parts,
          sequence: row.order,
          model: null,
          providerSlug: null,
          usage: null,
          createdAt: 0,
        }));
    }
    return [];
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(
      answer(strings.join('?'), values),
    )) as unknown as Parameters<typeof createGenerationWatch>[0];
  return { world, sql };
}

function appFor(sql: Parameters<typeof createGenerationWatch>[0]) {
  const watch = createGenerationWatch(sql, {
    pollIntervalMs: 10,
    heartbeatIntervalMs: 60_000,
  });
  const app = new Hono();
  app.get('/stream/:org/:thread', (c) =>
    streamSSE(c, (stream) =>
      watch.attach(stream, {
        organizationId: c.req.param('org'),
        threadId: c.req.param('thread'),
      }),
    ),
  );
  return { app, watch };
}

function collect(response: Response) {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  const pump = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      text += decoder.decode(next.value, { stream: true });
    }
  })();
  return {
    get text() {
      return text;
    },
    async until(predicate: (read: string) => boolean, timeoutMs = 2_000) {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(text)) {
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return true;
    },
    async close() {
      await reader.cancel();
      await pump;
    },
  };
}

function events(text: string, name: string): unknown[] {
  return [
    ...text.matchAll(new RegExp(`event: ${name}\\ndata: ([^\\n]*)`, 'g')),
  ].map((match) => JSON.parse(match[1] ?? 'null') as unknown);
}

describe('the shared generation watch', () => {
  test('an idle thread answers idle at once, and a crowd of idle tabs costs one light read per tick', async () => {
    const { world, sql } = chatWorld();
    const { app } = appFor(sql);
    const tabs = await Promise.all(
      Array.from({ length: 30 }, async (_, i) =>
        collect(await app.request(`/stream/o1/t${i % 10}`)),
      ),
    );
    for (const tab of tabs) {
      expect(await tab.until((read) => read.includes('event: idle'))).toBe(
        true,
      );
    }
    const before = world.count('FROM app.generations');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const reads = world.count('FROM app.generations') - before;
    // ~12 ticks of 10 ms, thirty tabs on ten threads: one read per tick.
    expect(reads).toBeGreaterThan(3);
    expect(reads).toBeLessThan(30);
    await Promise.all(tabs.map((tab) => tab.close()));
  });

  test('progress reaches every tab of the thread, parts only when they change, and settle reads one row', async () => {
    const { world, sql } = chatWorld();
    const { app } = appFor(sql);
    const a = collect(await app.request('/stream/o1/t1'));
    const b = collect(await app.request('/stream/o1/t1'));
    await a.until((read) => read.includes('event: idle'));
    await b.until((read) => read.includes('event: idle'));
    world.start('t1', 'o1', 'm1');
    world.write('t1', 'Hel', [{ type: 'tool-call', toolName: 'rag_search' }]);
    expect(await a.until((read) => read.includes('"text":"Hel"'))).toBe(true);
    world.write('t1', 'Hello');
    expect(await b.until((read) => read.includes('"text":"Hello"'))).toBe(true);
    await a.until((read) => read.includes('"text":"Hello"'));
    for (const tab of [a, b]) {
      const progress = events(tab.text, 'progress') as {
        text: string;
        parts?: unknown[];
      }[];
      expect(progress.map((event) => event.text)).toEqual(['Hel', 'Hello']);
      // The unchanged parts are not resent with the second tick.
      expect(progress[0]?.parts).toEqual([
        { type: 'tool-call', toolName: 'rag_search' },
      ]);
      expect(progress[1]?.parts).toBeUndefined();
    }
    world.finish('t1');
    expect(await a.until((read) => read.includes('event: settled'))).toBe(true);
    expect(await b.until((read) => read.includes('event: settled'))).toBe(true);
    const settled = events(a.text, 'settled') as { message: { id: string } }[];
    expect(settled[0]?.message.id).toBe('m1');
    // One read of the settled row for both tabs, never the transcript.
    expect(world.count('ORDER BY "order", step_order')).toBe(0);
    expect(world.count('unnest(') - world.count('SELECT id, parts')).toBe(1);
    await a.close();
    await b.close();
  });

  test('a tab that arrives mid-turn is shown the turn and its parts at once', async () => {
    const { world, sql } = chatWorld();
    const { app } = appFor(sql);
    world.start('t2', 'o1', 'm2');
    world.write('t2', 'Halfway', [{ type: 'text', text: 'Halfway' }]);
    const tab = collect(await app.request('/stream/o1/t2'));
    expect(await tab.until((read) => read.includes('event: progress'))).toBe(
      true,
    );
    const [first] = events(tab.text, 'progress') as {
      text: string;
      parts?: unknown[];
    }[];
    expect(first?.text).toBe('Halfway');
    expect(first?.parts).toEqual([{ type: 'text', text: 'Halfway' }]);
    expect(tab.text).not.toContain('event: idle');
    await tab.close();
  });

  test('a generation of another organization never reaches the tab', async () => {
    const { world, sql } = chatWorld();
    const { app } = appFor(sql);
    const tab = collect(await app.request('/stream/o1/t3'));
    await tab.until((read) => read.includes('event: idle'));
    world.start('t3', 'o2', 'm3');
    world.write('t3', 'secret');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(tab.text).not.toContain('secret');
    await tab.close();
  });

  test('with many watched threads the light read scans the in-flight set instead of naming them', async () => {
    const { world, sql } = chatWorld();
    const { app, watch } = appFor(sql);
    const tabs = await Promise.all(
      Array.from({ length: 520 }, async (_, i) =>
        collect(await app.request(`/stream/o1/w${i}`)),
      ),
    );
    expect(watch.threads()).toBe(520);
    const before = world.queries.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    const light = world.queries
      .slice(before)
      .filter(
        (text) =>
          text.includes('FROM app.generations') &&
          !text.includes('text, reasoning'),
      );
    expect(light.length).toBeGreaterThan(0);
    expect(light.every((text) => !text.includes('ANY('))).toBe(true);
    world.start('w7', 'o1', 'mw7');
    world.write('w7', 'found');
    expect(
      await tabs[7]?.until((read) => read.includes('"text":"found"')),
    ).toBe(true);
    await Promise.all(tabs.map((tab) => tab.close()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(watch.threads()).toBe(0);
  });
});
