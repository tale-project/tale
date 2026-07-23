import { describe, expect, it } from 'vitest';

import {
  isParseFailure,
  jsonErrorDetail,
  parseAgentReply,
  repairJson,
  stripThink,
} from './repair';

describe('repairJson — grammar-forced fixes only', () => {
  it('returns valid input unchanged', () => {
    expect(repairJson('{"a": 1}')).toBe('{"a": 1}');
  });

  it('appends missing closers at EOF, string-aware', () => {
    expect(repairJson('{"a": [1, 2')).toBe('{"a": [1, 2]}');
    expect(repairJson('{"a": "unterminated')).toBe('{"a": "unterminated"}');
  });

  it('escapes raw control characters inside strings', () => {
    expect(repairJson('{"a": "line\nbreak"}')).toBe('{"a": "line\\nbreak"}');
    expect(repairJson('{"a": "tab\there"}')).toBe('{"a": "tab\\there"}');
  });

  it('inserts a missing } before ] when an object is still open', () => {
    expect(repairJson('{"list": [{"a": 1]}')).toBe('{"list": [{"a": 1}]}');
  });

  it('drops a spurious ] when no array is open', () => {
    expect(repairJson('{"a": 1]}')).toBe('{"a": 1}');
  });

  it('removes a trailing comma before an object closer', () => {
    expect(repairJson('{"a": 1,}')).toBe('{"a": 1}');
    // An array trailing comma has no grammar-forced object-context signal;
    // it stays unfixed here — and never reaches this path in practice, since
    // YAML flow sequences accept it upstream.
    expect(repairJson('[1, 2,]')).toBeNull();
  });

  it('never guesses: mismatched nesting stays broken', () => {
    expect(repairJson('{"a": ]}')).toBeNull();
  });
});

describe('jsonErrorDetail', () => {
  it('quotes the neighborhood of the failure position', () => {
    let error: unknown;
    try {
      JSON.parse('{"a": nope}');
    } catch (e) {
      error = e;
    }
    const detail = jsonErrorDetail('{"a": nope}', error);
    expect(detail).toContain('malformed');
    expect(detail).toContain('nope');
  });
});

describe('stripThink', () => {
  it('removes reasoning blocks before parsing', () => {
    expect(stripThink('<think>hmm</think>{"method":"x"}')).toBe(
      '{"method":"x"}',
    );
  });
});

describe('parseAgentReply', () => {
  it('parses a fenced yaml action', () => {
    const reply = [
      'Let me validate that.',
      '```yaml',
      'method: validate_workflow',
      'params:',
      '  workflow:',
      '    name: my-flow',
      '```',
    ].join('\n');
    const parsed = parseAgentReply(reply);
    expect(isParseFailure(parsed)).toBe(false);
    if (!isParseFailure(parsed)) {
      expect(parsed.method).toBe('validate_workflow');
      expect(parsed.params).toEqual({ workflow: { name: 'my-flow' } });
      expect(parsed.lenient).toBeUndefined();
    }
  });

  it('prefers the LAST fenced block', () => {
    const reply = [
      '```yaml',
      'method: get_docs',
      '```',
      'Actually:',
      '```yaml',
      'method: get_catalog',
      'params: {}',
      '```',
    ].join('\n');
    const parsed = parseAgentReply(reply);
    if (!isParseFailure(parsed)) expect(parsed.method).toBe('get_catalog');
  });

  it('accepts bare JSON and auto-repairs malformed JSON, marking leniency', () => {
    const parsed = parseAgentReply('{"method": "list_workflows", "params": {}');
    expect(isParseFailure(parsed)).toBe(false);
    if (!isParseFailure(parsed)) {
      expect(parsed.method).toBe('list_workflows');
      expect(parsed.lenient).toBe('auto-repaired malformed JSON');
    }
  });

  it('recovers known methods under non-standard keys', () => {
    const parsed = parseAgentReply(
      '{"tool": "run_workflow", "arguments": {"input": {}}}',
    );
    if (!isParseFailure(parsed)) {
      expect(parsed.method).toBe('run_workflow');
      expect(parsed.lenient).toBe('used a non-standard action key');
    }
  });

  it('treats a bare workflow document as run_workflow', () => {
    const parsed = parseAgentReply(
      ['name: my-flow', 'nodes:', '  - id: a', '    type: transform'].join(
        '\n',
      ),
    );
    if (!isParseFailure(parsed)) {
      expect(parsed.method).toBe('run_workflow');
      expect(parsed.lenient).toBe('sent a bare workflow');
      expect(parsed.params).toMatchObject({
        workflow: { name: 'my-flow' },
        input: {},
      });
    }
  });

  it('finds a balanced JSON object buried in prose', () => {
    const parsed = parseAgentReply(
      'I will call {"method": "get_docs", "params": {}} now.',
    );
    if (!isParseFailure(parsed)) expect(parsed.method).toBe('get_docs');
  });

  it('fails with protocol guidance when nothing parses', () => {
    const parsed = parseAgentReply('just some prose with no action at all');
    expect(isParseFailure(parsed)).toBe(true);
    if (isParseFailure(parsed)) {
      expect(parsed.parseError).toContain('fenced yaml block');
    }
  });

  it('an unquoted scalar is legal YAML — the bogus method flows to dispatch', () => {
    // `{"method": nope}` is a valid YAML flow mapping; method validation is
    // dispatch's job, not the parser's.
    const parsed = parseAgentReply(
      ['```json', '{"method": nope}', '```'].join('\n'),
    );
    expect(isParseFailure(parsed)).toBe(false);
    if (!isParseFailure(parsed)) expect(parsed.method).toBe('nope');
  });

  it('reports the JSON failure neighborhood for an unrepairable fenced block', () => {
    const reply = ['```json', '{"a": ]}', '```'].join('\n');
    const parsed = parseAgentReply(reply);
    expect(isParseFailure(parsed)).toBe(true);
    if (isParseFailure(parsed)) {
      expect(parsed.parseError).toContain('malformed');
    }
  });

  it('rejects an empty reply', () => {
    expect(parseAgentReply('<think>only thoughts</think>')).toEqual({
      parseError: 'empty reply',
    });
  });
});
