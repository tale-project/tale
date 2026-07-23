import { describe, expect, it } from 'vitest';

import type { ParseResult, ParseYamlOptions } from './yaml';
import { DEFAULT_MAX_YAML_BYTES, parseYaml, parseYamlOrThrow } from './yaml';

/** Narrow a result to its failure branch so tests can assert on the message. */
function unwrapError(result: ParseResult): string {
  if (result.ok) {
    throw new Error(
      `expected a parse failure, got data: ${JSON.stringify(result.data)}`,
    );
  }
  return result.error;
}

describe('parseYaml', () => {
  it('accepts a plain mapping document', () => {
    const result = parseYaml(
      [
        'name: anthropic',
        'baseUrl: https://api.anthropic.com',
        'auth:',
        '  - method: api-key',
        '  - method: env',
        'retries: 3',
        'enabled: true',
      ].join('\n'),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        auth: [{ method: 'api-key' }, { method: 'env' }],
        retries: 3,
        enabled: true,
      },
    });
  });

  it('parses a JSON document identically to JSON.parse — JSON is valid YAML', () => {
    const json = JSON.stringify({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      catalog: { source: 'openrouter-api' },
      tags: ['chat', 'tools'],
      contextWindow: 200_000,
      deprecated: false,
      notes: null,
    });
    expect(parseYaml(json)).toEqual({ ok: true, data: JSON.parse(json) });
  });

  it('expands anchors and aliases under the expansion cap', () => {
    const result = parseYaml(
      [
        'defaults: &d',
        '  timeoutMs: 5000',
        '  retries: 2',
        'fast: *d',
        'slow: *d',
      ].join('\n'),
    );
    const expanded = { timeoutMs: 5000, retries: 2 };
    expect(result).toEqual({
      ok: true,
      data: { defaults: expanded, fast: expanded, slow: expanded },
    });
  });

  it('rejects billion-laughs alias bombs', () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    ].join('\n');
    const error = unwrapError(parseYaml(bomb));
    expect(error).toMatch(/too many alias expansions/);
    expect(error).toMatch(/anchor/);
  });

  it('rejects !!js and custom tags — core schema only', () => {
    const jsTag = unwrapError(parseYaml('f: !!js/function "function () {}"'));
    expect(jsTag).toMatch(/js\/function/);
    expect(jsTag).toMatch(/line 1, column 4/);
    expect(unwrapError(parseYaml('f: !myapp/custom value'))).toMatch(
      /myapp\/custom/,
    );
    // resolveKnownTags is off: even the YAML 1.1 convenience tags are
    // rejected instead of materializing Date/Uint8Array values.
    expect(unwrapError(parseYaml('t: !!timestamp 2001-12-14'))).toMatch(
      /timestamp/,
    );
  });

  it('rejects multi-document streams', () => {
    const error = unwrapError(parseYaml('a: 1\n---\nb: 2\n'));
    expect(error).toMatch(/single document/);
    expect(error).toMatch(/line 2, column 1/);
  });

  it('rejects non-mapping roots by default', () => {
    expect(unwrapError(parseYaml('- a\n- b\n'))).toMatch(/must be a mapping/);
    expect(unwrapError(parseYaml('42\n'))).toMatch(/must be a mapping/);
    expect(unwrapError(parseYaml(''))).toMatch(/empty/);
    expect(unwrapError(parseYaml('# only a comment\n'))).toMatch(/empty/);
  });

  it('accepts an array root only with allowArrayRoot', () => {
    const options: ParseYamlOptions = { allowArrayRoot: true };
    expect(parseYaml('- a\n- b\n', options)).toEqual({
      ok: true,
      data: ['a', 'b'],
    });
    expect(parseYaml('["a", 1]', options)).toEqual({
      ok: true,
      data: ['a', 1],
    });
    // Scalars stay rejected even with the array opt-in.
    expect(unwrapError(parseYaml('42\n', options))).toMatch(
      /mapping .*or a sequence/,
    );
  });

  it('rejects documents over the size cap', () => {
    const big = `data: ${'x'.repeat(DEFAULT_MAX_YAML_BYTES)}`;
    const error = unwrapError(parseYaml(big));
    expect(error).toMatch(/too large/);
    expect(error).toMatch(/256 KiB/);
    // The cap is overridable per call…
    expect(unwrapError(parseYaml('key: value', { maxBytes: 4 }))).toMatch(
      /too large/,
    );
    // …and measured in UTF-8 bytes, not string length ('é' is two bytes).
    expect(unwrapError(parseYaml('é: 1', { maxBytes: 4 }))).toMatch(
      /too large/,
    );
    expect(parseYaml('é: 1', { maxBytes: 5 })).toEqual({
      ok: true,
      data: { é: 1 },
    });
  });

  it('reports line and column in parse errors', () => {
    const error = unwrapError(parseYaml('a: 1\na: 2\n'));
    expect(error).toMatch(/Map keys must be unique/);
    expect(error).toMatch(/line 2, column 1/);
    expect(unwrapError(parseYaml('key: [1, 2\n'))).toMatch(
      /line \d+, column \d+/,
    );
  });
});

describe('parseYamlOrThrow', () => {
  it('returns the parsed data on success', () => {
    expect(parseYamlOrThrow('a: 1')).toEqual({ a: 1 });
  });

  it('throws the operator-facing message on failure', () => {
    expect(() => parseYamlOrThrow('a: 1\n---\nb: 2\n')).toThrow(
      /single document/,
    );
  });
});
