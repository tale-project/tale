import type { CodeCompletionContext } from '@tale/ui/code-editor/providers';
import { describe, expect, it } from 'vitest';

import { runInputProviders } from './run-input-completion';

const SCHEMA = {
  type: 'object',
  properties: {
    owner: { type: 'string', description: 'The GitHub organization' },
    limit: { type: 'integer' },
    labels: { type: 'array', items: { type: 'string' } },
  },
  required: ['owner'],
};

function at(
  region: CodeCompletionContext['region'],
  pointer: string | undefined,
): CodeCompletionContext {
  return {
    text: '{ "o": 1 }',
    pos: 4,
    language: 'json',
    region,
    path: null,
    prefix: 'o',
    from: 3,
    to: 4,
    ...(pointer !== undefined && { pointer }),
    explicit: false,
    signal: new AbortController().signal,
  };
}

const kindOf = (field: Record<string, unknown>) => `kind:${String(field.type)}`;

describe('runInputProviders', () => {
  it('offers the declared fields where a key of the input is typed', async () => {
    const { completion } = runInputProviders(SCHEMA, kindOf);
    const answer = await completion?.(at('key', ''));
    expect(answer?.items).toEqual([
      {
        label: 'owner',
        kind: 'input',
        valueType: 'string',
        detail: 'kind:string',
        optional: false,
        info: { description: 'The GitHub organization' },
      },
      {
        label: 'limit',
        kind: 'input',
        valueType: 'integer',
        detail: 'kind:integer',
        optional: true,
      },
      {
        label: 'labels',
        kind: 'input',
        valueType: 'array',
        detail: 'kind:array',
        optional: true,
      },
    ]);
  });

  it('offers nothing inside a value, a nested object or without fields', async () => {
    const { completion } = runInputProviders(SCHEMA, kindOf);
    expect(await completion?.(at('string', '/owner'))).toBeNull();
    expect(await completion?.(at('key', '/labels'))).toBeNull();
    const empty = runInputProviders({ type: 'object' }, kindOf);
    expect(await empty.completion?.(at('key', ''))).toBeNull();
    const none = runInputProviders(undefined, kindOf);
    expect(await none.completion?.(at('key', ''))).toBeNull();
  });
});
