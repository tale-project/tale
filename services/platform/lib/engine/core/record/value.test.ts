// @vitest-environment node

import { valueHash } from '@tale/ui/data/hash';
import { randomJson, seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import { boundJson } from '../../../shared/utils/bound-json';
import {
  boundRecorded,
  RECORD_LIMITS,
  RECORD_RUN_BUDGET,
  recordBudget,
  recordedSummary,
  recordValue,
  redactSummary,
  redactTrace,
  redactValue,
  unlimitedBudget,
} from './value';

describe('redactValue', () => {
  it('withholds a member whose name marks a secret, and says where [AUTO-R38]', () => {
    expect(
      redactValue({
        user: 'ada',
        password: 'hunter2',
        auth: { apiKey: 'k', scheme: 'basic' },
      }),
    ).toEqual({
      value: { user: 'ada', password: null, auth: null },
      redacted: [
        { pointer: '/password', why: 'key' },
        { pointer: '/auth', why: 'key' },
      ],
      total: 2,
    });
  });

  it('withholds text that looks like a credential wherever it sits', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    expect(
      redactValue({ notes: ['plain', `use ${token} here`], header: 'x' }),
    ).toEqual({
      value: { notes: ['plain', null], header: 'x' },
      redacted: [{ pointer: '/notes/1', why: 'pattern' }],
      total: 1,
    });
  });

  it('withholds an opaque value under a credential name', () => {
    expect(redactValue({ list: [{ secret: 'abcdefghijklmnop' }] })).toEqual({
      value: { list: [{ secret: null }] },
      redacted: [{ pointer: '/list/0/secret', why: 'key' }],
      total: 1,
    });
  });

  it('keeps counts and flags under a secret-looking name', () => {
    const usage = { inputTokens: 120, maxTokens: 4000, hasPassword: true };
    expect(redactValue({ usage, token: null })).toEqual({
      value: { usage, token: null },
      redacted: [],
      total: 0,
    });
  });

  it('escapes member names in the pointers it reports', () => {
    expect(redactValue({ 'a/b': { 'x~token': 'abc' } }).redacted).toEqual([
      { pointer: '/a~1b/x~0token', why: 'key' },
    ]);
  });

  it('withholds a numeric secret under a name that marks one', () => {
    expect(
      redactValue({ pin: 1234, password: 123_456, totpCode: 1 }).value,
    ).toEqual({
      pin: null,
      password: null,
      totpCode: null,
    });
  });

  it('withholds text under a name that only mentions a token, and reads the rest', () => {
    expect(
      redactValue({
        nextPageToken: 'CAEQAA',
        prompt_tokens_details: { cached_tokens: 0 },
        tokenizer: 'cl100k',
      }),
    ).toEqual({
      value: {
        nextPageToken: null,
        prompt_tokens_details: { cached_tokens: 0 },
        tokenizer: 'cl100k',
      },
      redacted: [{ pointer: '/nextPageToken', why: 'key' }],
      total: 1,
    });
  });

  it('withholds names the audit list misses', () => {
    const headers = {
      'x-api-key': 'k_live_1',
      cookie: 'sid=1',
      'set-cookie': 'sid=2',
      'proxy-authorization': 'Basic abc',
      passwd: 'hunter2',
      pwd: 'x',
      'api-key': 'short',
    };
    const { value } = redactValue({ headers });
    expect(Object.values((value as { headers: object }).headers)).toEqual(
      Object.values(headers).map(() => null),
    );
  });

  it('withholds credential shapes beyond the document check', () => {
    for (const text of [
      `sk_live_${'a'.repeat(24)}`,
      `gho_${'b'.repeat(30)}`,
      `github_pat_${'c'.repeat(30)}`,
      `AIza${'d'.repeat(35)}`,
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl',
      'https://ada:s3cret@example.com/path',
      'https://example.com/x?api_key=abcdefghijk&y=1',
    ]) {
      expect(redactValue({ note: text }).value, text).toEqual({ note: null });
    }
  });

  it('leaves out a member whose name is a credential, and says where', () => {
    const name = `ghp_${'a'.repeat(30)}`;
    const record = recordValue(
      { [name]: { password: 'p' }, kept: 1 },
      'node',
      unlimitedBudget(),
    );
    expect(record.value).toEqual({ kept: 1 });
    expect(record.redacted).toEqual([{ pointer: '', why: 'name' }]);
    expect(JSON.stringify(record)).not.toContain(name);
  });

  it('leaves out a member name too long to show', () => {
    const name = 'n'.repeat(300);
    const record = recordValue({ [name]: 1 }, 'unit', unlimitedBudget());
    expect(record.value).toEqual({});
    expect(JSON.stringify(record)).not.toContain(name);
  });

  it('keeps a member named __proto__ as a member', () => {
    const value: unknown = JSON.parse('{"__proto__":{"x":1},"y":2}');
    expect(JSON.stringify(redactValue(value).value)).toBe(
      '{"__proto__":{"x":1},"y":2}',
    );
  });

  it('counts every place it withheld past the listed ones', () => {
    const many = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [`password${i}`, 'x']),
    );
    const { redacted, total } = redactValue(many);
    expect(redacted).toHaveLength(100);
    expect(total).toBe(150);
    const record = recordValue(many, 'transient', unlimitedBudget());
    expect(record.redactedTotal).toBe(150);
  });

  it('reads the value as JSON first', () => {
    expect(
      redactValue({
        at: new Date(Date.UTC(2026, 9, 9)),
        gone: undefined,
        n: Number.NaN,
      }).value,
    ).toEqual({ at: '2026-10-09T00:00:00.000Z', n: null });
    expect(redactValue(undefined)).toEqual({
      value: undefined,
      redacted: [],
      total: 0,
    });
  });

  it('never withholds the same value twice differently', () => {
    const random = seeded(7);
    for (let i = 0; i < 300; i++) {
      const value = randomJson(random);
      const once = redactValue(value);
      expect(redactValue(once.value).value).toEqual(once.value);
    }
  });
});

describe('boundRecorded', () => {
  const limits = { maxString: 5, maxItems: 2, maxDepth: 2, ceiling: 1000 };

  it('cuts without writing into the value, listing every cut', () => {
    expect(
      boundRecorded(
        { s: 'abcdefgh', list: [1, 2, 3], deep: { a: { b: [1] } } },
        limits,
      ),
    ).toEqual({
      value: { s: 'abcde', list: [1, 2], deep: { a: { b: null } } },
      elided: [
        { pointer: '/s', kind: 'string', dropped: 3 },
        { pointer: '/list', kind: 'items', dropped: 1 },
        { pointer: '/deep/a/b', kind: 'depth', dropped: 3 },
      ],
      total: 3,
    });
  });

  it('keeps keys in the order they were written', () => {
    expect(
      Object.keys(boundRecorded({ b: 1, a: 2 }, limits).value ?? {}),
    ).toEqual(['b', 'a']);
  });

  it('keeps nothing of a value still past the ceiling', () => {
    const big = { a: 'x'.repeat(5), b: 'y'.repeat(5) };
    expect(boundRecorded(big, { ...limits, ceiling: 10 })).toEqual({
      value: null,
      elided: [
        {
          pointer: '',
          kind: 'whole',
          dropped: JSON.stringify(big).length,
        },
      ],
      total: 1,
    });
  });

  it('keeps what boundJson keeps, minus its markers', () => {
    const random = seeded(11);
    const tight = { maxString: 8, maxItems: 3, maxDepth: 3 };
    for (let i = 0; i < 300; i++) {
      const value = JSON.parse(JSON.stringify(randomJson(random)) ?? 'null');
      const { value: quiet, elided } = boundRecorded(value, {
        ...tight,
        ceiling: Number.POSITIVE_INFINITY,
      });
      const marked = JSON.stringify(boundJson(value, tight));
      if (elided.length === 0) expect(JSON.stringify(quiet)).toBe(marked);
      expect(JSON.stringify(quiet)).not.toContain('…(+');
    }
  });
});

describe('recordValue', () => {
  it('summarizes, shapes and hashes the whole withheld value', () => {
    const value = {
      id: 7,
      items: Array.from({ length: 80 }, (_, i) => ({ n: i })),
      apiKey: 'sk-should-never-be-stored',
    };
    const record = recordValue(value, 'node', unlimitedBudget());
    const withheld = { ...value, apiKey: null };
    expect(record.summary).toMatchObject({ kind: 'object', keys: 3 });
    expect(record.bytes).toBe(JSON.stringify(withheld).length);
    expect(record.hash).toBe(valueHash(withheld));
    expect(record.shape.properties?.items).toMatchObject({ type: 'array' });
    expect(record.redacted).toEqual([{ pointer: '/apiKey', why: 'key' }]);
    expect(record.elided).toEqual([
      { pointer: '/items', kind: 'items', dropped: 30 },
    ]);
    expect(JSON.stringify(record)).not.toContain('sk-should');
  });

  it('records the step tier tighter than the node tier', () => {
    const text = 'z'.repeat(2000);
    expect(recordValue(text, 'node', unlimitedBudget()).value).toBe(text);
    expect(recordValue(text, 'unit', unlimitedBudget()).value).toBe(
      'z'.repeat(RECORD_LIMITS.unit.maxString),
    );
  });

  it('spends the run budget and keeps the account once it is spent', () => {
    const budget = recordBudget(RECORD_RUN_BUDGET - 10);
    const first = recordValue('abc', 'node', budget);
    expect(first.value).toBe('abc');
    expect(budget.left).toBe(5);
    const second = recordValue('a longer value', 'node', budget);
    expect(second.value).toBeUndefined();
    expect(second.summary).toMatchObject({ kind: 'string', length: 14 });
    expect(second.hash).toBe(valueHash('a longer value'));
    expect(budget.left).toBe(5);
  });

  it('answers a budget that never goes below nothing', () => {
    expect(recordBudget(RECORD_RUN_BUDGET * 2).left).toBe(0);
  });

  it('records an absent value as such', () => {
    expect(recordValue(undefined, 'node', unlimitedBudget())).toEqual({
      summary: { kind: 'undefined' },
      shape: {},
      bytes: 0,
      hash: null,
    });
  });
});

describe('a record stays small however large the value', () => {
  it('bounds the shape of a wide object', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, i) => [`k${i}`, i]),
    );
    const record = recordValue(wide, 'unit', unlimitedBudget());
    expect(record.value).toBeNull();
    expect(Object.keys(record.shape.properties ?? {})).toHaveLength(50);
    expect(record.shape['x-omitted']).toBe(19_950);
    expect(JSON.stringify(record).length).toBeLessThan(8192);
  });

  it('counts bytes as UTF-8', () => {
    const record = recordValue('ééé', 'node', unlimitedBudget());
    expect(record.bytes).toBe(8);
  });

  it('reads a withheld value as withheld, not as nothing', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    const record = recordValue(token, 'node', unlimitedBudget());
    expect(record.summary).toEqual({ kind: 'redacted' });
    expect(record.shape).toEqual({});
    expect(record.value).toBeNull();
  });
});

describe('summaries of values seen without their names', () => {
  it('withholds text that looks like a credential', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    expect(redactSummary({ kind: 'string', text: token, length: 34 })).toEqual({
      kind: 'redacted',
    });
    expect(
      redactSummary({
        kind: 'array',
        length: 2,
        items: [
          { kind: 'string', text: token },
          { kind: 'number', text: '1' },
        ],
      }).items,
    ).toEqual([{ kind: 'redacted' }, { kind: 'number', text: '1' }]);
  });

  it('summarizes a value with its secrets withheld', () => {
    expect(recordedSummary({ password: 'x', n: 1 })).toMatchObject({
      kind: 'object',
      keys: 2,
    });
    expect(recordedSummary(`sk-${'a'.repeat(20)}`)).toEqual({
      kind: 'redacted',
    });
  });
});

describe('redactTrace', () => {
  it('withholds the secrets of each entry, and leaves the rest of it', () => {
    expect(
      redactTrace([
        {
          node: 'call',
          type: 'http.get',
          status: 'ok',
          note: 'kept',
          input: { apiKey: 'k', q: 1 },
          output: { rows: 2 },
        },
        { node: 'skip', type: 'transform', status: 'skipped' },
      ]),
    ).toEqual([
      {
        node: 'call',
        type: 'http.get',
        status: 'ok',
        note: 'kept',
        input: { apiKey: null, q: 1 },
        output: { rows: 2 },
      },
      { node: 'skip', type: 'transform', status: 'skipped' },
    ]);
  });
});
