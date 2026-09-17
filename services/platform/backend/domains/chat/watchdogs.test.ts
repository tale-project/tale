// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMBED_QUERY_TIMEOUT_MAX_MS } from '../../core/knowledge/embedding.ts';
import {
  CHAT_GENERATION_STALE_MS,
  runChatGenerationWatchdog,
} from './watchdogs.ts';

/**
 * A chat turn's heartbeat does not move while one of its tool calls runs, so
 * the watchdog fails a turn whose knowledge search still waits on the
 * embedding server — as "interrupted by a restart", not as the search's own
 * error. The search ceiling keeps a search well inside the staleness window.
 */
describe('the chat generation watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears a generation only once its heartbeat is older than the named window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T08:00:00Z'));
    const cutoffs: unknown[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('DELETE FROM app.generations')) {
        cutoffs.push(values[0]);
      }
      return Promise.resolve([]);
    }) as unknown as Sql;

    await expect(runChatGenerationWatchdog(sql)).resolves.toBe(0);
    expect(cutoffs).toEqual([Date.now() - CHAT_GENERATION_STALE_MS]);
  });

  it('outlasts a knowledge search at least twice over', () => {
    expect(EMBED_QUERY_TIMEOUT_MAX_MS * 2).toBeLessThanOrEqual(
      CHAT_GENERATION_STALE_MS,
    );
  });
});
