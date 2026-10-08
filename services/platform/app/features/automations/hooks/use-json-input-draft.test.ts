import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  checkJsonInput,
  inputSchemaValidator,
  parseJsonText,
  useJsonInputDraft,
} from './use-json-input-draft';

const GITHUB_INPUTS = {
  type: 'object',
  required: ['owner', 'repo', 'limit'],
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
    limit: { type: 'integer' },
    labels: { type: 'array' },
  },
};

describe('parseJsonText', () => {
  it('reads JSON and says when text is none', () => {
    expect(parseJsonText('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonText('{a: 1}')).toEqual({ ok: false });
    expect(parseJsonText('')).toEqual({ ok: false });
  });
});

describe('checkJsonInput', () => {
  it('passes every input without a schema', () => {
    expect(checkJsonInput(null, 'anything')).toEqual({
      valid: true,
      input: 'anything',
    });
  });

  it('names each refused field once, and the input itself as $', () => {
    const validator = inputSchemaValidator(GITHUB_INPUTS);
    expect(checkJsonInput(validator, { owner: 1, owner2: 2 })).toEqual({
      valid: false,
      paths: ['owner', 'repo', 'limit'],
    });
    expect(checkJsonInput(validator, 'text')).toEqual({
      valid: false,
      paths: ['$'],
    });
  });

  it('hands on the original input, not a converted copy', () => {
    const validator = inputSchemaValidator(GITHUB_INPUTS);
    const input = { owner: 'tale', repo: 'tale', limit: 5, extra: true };
    const checked = checkJsonInput(validator, input);
    expect(checked).toEqual({ valid: true, input });
    expect(checked.valid && checked.input).toBe(input);
  });
});

describe('inputSchemaValidator', () => {
  it('reads no schema as no validator', () => {
    expect(inputSchemaValidator(undefined)).toBeNull();
  });

  it('does not refuse a schema the client converter cannot read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      inputSchemaValidator({ type: 'object', unevaluatedProperties: false }),
    ).toBeNull();
    warn.mockRestore();
  });
});

describe('useJsonInputDraft', () => {
  it('builds one validator per schema and checks with it', () => {
    const { result, rerender } = renderHook(
      ({ schema }) => useJsonInputDraft(schema),
      { initialProps: { schema: GITHUB_INPUTS } },
    );
    const first = result.current;
    rerender({ schema: GITHUB_INPUTS });
    expect(result.current).toBe(first);
    expect(result.current.check({ owner: 'a', repo: 'b', limit: 1 })).toEqual({
      valid: true,
      input: { owner: 'a', repo: 'b', limit: 1 },
    });
    expect(result.current.check({}).valid).toBe(false);
  });
});
