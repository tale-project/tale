import { describe, expect, it } from 'vitest';

import type { ChatToolExecutor, ToolCallOptions } from '../chat/tools';
import { composeToolExecutors } from './compose';

function executor(names: readonly string[], tag: string): ChatToolExecutor {
  return {
    wireTools: names.map((name) => ({
      name,
      description: `${name} tool`,
      parameters: { type: 'object' },
    })),
    execute: (call) => Promise.resolve({ by: tag, name: call.name }),
  };
}

describe('composeToolExecutors', () => {
  it('is absent when no executor is', () => {
    expect(composeToolExecutors([undefined])).toBeUndefined();
  });

  it('hands back a single executor as it is', () => {
    const only = executor(['a'], 'one');
    expect(composeToolExecutors([only, undefined])).toBe(only);
  });

  it('joins the wire tools in order and dispatches each call to its owner', async () => {
    const joined = composeToolExecutors([
      executor(['rag_search'], 'retrieval'),
      executor(['run_code', 'create_file'], 'work'),
    ]);
    expect(joined?.wireTools.map((tool) => tool.name)).toEqual([
      'rag_search',
      'run_code',
      'create_file',
    ]);
    await expect(
      joined?.execute({ id: '1', name: 'create_file', input: {} }),
    ).resolves.toEqual({ by: 'work', name: 'create_file' });
    await expect(
      joined?.execute({ id: '2', name: 'rag_search', input: {} }),
    ).resolves.toEqual({ by: 'retrieval', name: 'rag_search' });
  });

  it('hands the turn’s options — its abort signal — to the executor that owns the call', async () => {
    const seen: (ToolCallOptions | undefined)[] = [];
    const work: ChatToolExecutor = {
      wireTools: [
        { name: 'run_code', description: 'x', parameters: { type: 'object' } },
      ],
      execute: (_call, options) => {
        seen.push(options);
        return Promise.resolve({ status: 'ok' });
      },
    };
    const joined = composeToolExecutors([executor(['rag_search'], 'r'), work]);
    const stop = new AbortController();

    await joined?.execute(
      { id: '1', name: 'run_code', input: {} },
      { signal: stop.signal },
    );

    expect(seen).toEqual([{ signal: stop.signal }]);
  });

  it('answers a call to a tool nobody offered without throwing', async () => {
    const joined = composeToolExecutors([
      executor(['a'], 'one'),
      executor(['b'], 'two'),
    ]);
    const result = await joined?.execute({ id: '1', name: 'zzz', input: {} });
    expect(result).toMatchObject({ status: 'error' });
  });

  it('refuses two executors offering one name', () => {
    expect(() =>
      composeToolExecutors([executor(['a'], 'one'), executor(['a'], 'two')]),
    ).toThrow(/offered by two executors/);
  });
});
