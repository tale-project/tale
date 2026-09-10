// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeTurn } from '../../core/chat/turn_action.ts';
import { runChatTurn } from './service.ts';

vi.mock('../../core/chat/turn_action.ts', () => ({ executeTurn: vi.fn() }));

beforeEach(() => {
  vi.mocked(executeTurn).mockReset();
});

describe('runChatTurn carries REST scope to the prompt and atomic store', () => {
  it.each(['project_a', null])(
    'refuses a thread moved after accepting scope %s, before the host opens the turn',
    async (expectedProjectId) => {
      let currentProjectId = expectedProjectId;
      const writes: string[] = [];
      const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        if (text.includes('FOR UPDATE OF tm')) {
          return Promise.resolve(
            values.at(-1) === currentProjectId ? [{ id: 'thread_1' }] : [],
          );
        }
        if (text.includes('INSERT INTO')) writes.push(text);
        return Promise.resolve([]);
      };
      const sql = Object.assign(tag, {
        begin: (
          _options: string,
          callback: (tx: unknown) => Promise<unknown>,
        ) => callback(sql),
      }) as unknown as Sql;
      vi.mocked(executeTurn).mockImplementation(
        async (_ctx, args, overrides) => {
          // Context is pinned to the accepted path even if metadata changes
          // while the host resolves the provider and assembles the prompt.
          expect(args.expectedProjectId).toBe(expectedProjectId);
          currentProjectId = 'project_b';
          await overrides.deps.store.beginTurn({
            organizationId: args.organizationId,
            threadId: args.threadId,
            userParts: [{ type: 'text', text: args.userText }],
          });
          throw new Error('A moved thread must never reach the model call');
        },
      );

      await expect(
        runChatTurn(sql, {
          organizationId: 'org_1',
          userId: 'user_1',
          threadId: 'thread_1',
          userText: 'hello',
          modelId: 'model-a',
          expectedProjectId,
        }),
      ).rejects.toMatchObject({ code: 'THREAD_SCOPE_CHANGED' });
      expect(writes).toEqual([]);
    },
  );
});
