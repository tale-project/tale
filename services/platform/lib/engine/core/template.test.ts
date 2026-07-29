import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../runners/node-vm';
import { setCodeRunner } from './runner';
import {
  evalCondition,
  evalTemplates,
  ExprError,
  inputKeysInSource,
  refsInSource,
  runCode,
  templateExprsIn,
} from './template';

beforeEach(() => {
  setCodeRunner(nodeVmRunner());
});

afterEach(() => {
  // Later suites must install their own runner deliberately.
});

describe('scanners (pure, validation-time)', () => {
  it('collects template expressions from nested values', () => {
    expect(
      templateExprsIn({
        a: '{{ input.x }}',
        b: ['plain', 'mixed {{ nodes.first.output.id }} text'],
        c: { d: 42 },
      }),
    ).toEqual(['input.x', 'nodes.first.output.id']);
  });

  it('derives node references from dot and bracket forms', () => {
    expect(
      refsInSource('nodes.alpha.output.x + nodes["beta-2"].output'),
    ).toEqual(new Set(['alpha', 'beta-2']));
  });

  it('derives input keys for schema typo-checking', () => {
    expect(inputKeysInSource('input.city + input.units')).toEqual(
      new Set(['city', 'units']),
    );
  });
});

describe('evalTemplates — the two authoring rules', () => {
  const scope = {
    input: { n: 7, name: 'Ada' },
    nodes: { first: { output: { id: 'abc', list: [1, 2] } } },
  };

  it('a field that is exactly one template keeps the expression type', async () => {
    await expect(evalTemplates('{{ input.n }}', scope)).resolves.toBe(7);
    await expect(
      evalTemplates('{{ nodes.first.output.list }}', scope),
    ).resolves.toEqual([1, 2]);
  });

  it('mixed text interpolates, objects as JSON', async () => {
    await expect(
      evalTemplates('id={{ nodes.first.output.id }}!', scope),
    ).resolves.toBe('id=abc!');
    await expect(
      evalTemplates('l: {{ nodes.first.output.list }}', scope),
    ).resolves.toBe('l: [1,2]');
  });

  it('interpolating null/undefined into a string is an error with guidance', async () => {
    await expect(
      evalTemplates('temp: {{ input.missing }}', scope),
    ).rejects.toThrow(/does not exist.*Check the exact output shape/s);
  });

  it('walks arrays and objects', async () => {
    await expect(
      evalTemplates({ a: ['{{ input.n }}'], b: 'x{{ input.n }}' }, scope),
    ).resolves.toEqual({ a: [7], b: 'x7' });
  });

  it('wraps evaluation failures as ExprError naming the expression', async () => {
    await expect(
      evalTemplates('{{ input.n.f() }}', scope),
    ).rejects.toBeInstanceOf(ExprError);
  });
});

describe('evalCondition', () => {
  it('accepts bare expressions and template form alike', async () => {
    const scope = { input: { ok: true } };
    await expect(evalCondition('input.ok', scope)).resolves.toBe(true);
    await expect(evalCondition('{{ !input.ok }}', scope)).resolves.toBe(false);
  });
});

describe('runCode (transform bodies)', () => {
  it('runs a body with input in scope and returns its value', async () => {
    await expect(
      runCode('return input.a + input.b;', { input: { a: 2, b: 3 } }),
    ).resolves.toBe(5);
  });

  it('undefined result surfaces as undefined (the missing-return signal)', async () => {
    await expect(
      runCode('const x = 1;', { input: {} }),
    ).resolves.toBeUndefined();
  });
});
