import { describe, expect, test } from 'bun:test';

import {
  ExpressionError,
  contextPath,
  foldTemplate,
  hasStatusFunction,
  keepStatusFunction,
  parseExpression,
  parseTemplate,
  printExpression,
  simplify,
  truthy,
  type Facts,
} from './expression';

const print = (source: string) => printExpression(parseExpression(source));

/** What a Forgejo run knows about a workflow whose candidate jobs were left out. */
const forgejo: Facts = {
  values: new Map([
    ['needs.candidate-source.result', 'skipped'],
    ['needs.candidate-gate.result', 'skipped'],
  ]),
  absent: [
    'github.event.client_payload',
    'github.event.merge_group',
    'needs.candidate-source.outputs',
  ],
  oneOf: new Map([['github.event_name', ['pull_request', 'push']]]),
};

function fold(source: string, mode: 'condition' | 'value' = 'condition') {
  return printExpression(simplify(parseExpression(source), forgejo, mode));
}

describe('parseExpression and printExpression', () => {
  test('keep contexts, indexing, wildcards and calls', () => {
    expect(print('github.event.pull_request.head.repo.fork')).toBe(
      'github.event.pull_request.head.repo.fork',
    );
    expect(print("matrix['service'].name")).toBe("matrix['service'].name");
    expect(print('needs.*.result')).toBe('needs.*.result');
    expect(
      print('contains(fromJSON(needs.scope.outputs.services), matrix.service)'),
    ).toBe('contains(fromJSON(needs.scope.outputs.services), matrix.service)');
    expect(print('hashFiles(  "a" )'.replace('"a"', "'a'"))).toBe(
      "hashFiles('a')",
    );
  });

  test('read names with hyphens as one name', () => {
    expect(
      contextPath(
        parseExpression('needs.candidate-source.outputs.candidate_sha'),
      ),
    ).toBe('needs.candidate-source.outputs.candidate_sha');
  });

  test('read GitHub literals', () => {
    expect(parseExpression('true')).toEqual({ kind: 'literal', value: true });
    expect(parseExpression('null')).toEqual({ kind: 'literal', value: null });
    expect(parseExpression('42')).toEqual({ kind: 'literal', value: 42 });
    expect(parseExpression('-1.5e2')).toEqual({ kind: 'literal', value: -150 });
    expect(parseExpression('0x10')).toEqual({ kind: 'literal', value: 16 });
    expect(parseExpression("'it''s'")).toEqual({
      kind: 'literal',
      value: "it's",
    });
    expect(print("'it''s'")).toBe("'it''s'");
  });

  test('read every escaped quote of a string, and any name it is given', () => {
    expect(parseExpression("'a''b''c'")).toEqual({
      kind: 'literal',
      value: "a'b'c",
    });
    expect(print("'a''b''c'")).toBe("'a''b''c'");
    expect(print('someNewContext.value[otherName]')).toBe(
      'someNewContext.value[otherName]',
    );
  });

  test('give && more weight than ||, and ! more than both', () => {
    expect(parseExpression('a || b && c')).toEqual({
      kind: 'binary',
      op: '||',
      left: { kind: 'ident', name: 'a' },
      right: {
        kind: 'binary',
        op: '&&',
        left: { kind: 'ident', name: 'b' },
        right: { kind: 'ident', name: 'c' },
      },
    });
    expect(print('(a || b) && c')).toBe('(a || b) && c');
    expect(print('a || (b && c)')).toBe('a || b && c');
    expect(print('!(a && b)')).toBe('!(a && b)');
    expect(print('!a && b')).toBe('!a && b');
    expect(print("a == 'x' && b != 'y'")).toBe("a == 'x' && b != 'y'");
  });

  test('keep a right-hand group of the same operator', () => {
    expect(print('a && (b && c)')).toBe('a && (b && c)');
    expect(print('a && b && c')).toBe('a && b && c');
  });

  test('round-trip every shape the workflows use', () => {
    const sources = [
      "!cancelled() && (((github.event_name == 'repository_dispatch') && needs.candidate-source.result == 'success') || ((github.event_name != 'repository_dispatch') && needs.candidate-source.result == 'skipped'))",
      "github.event_name == 'pull_request' && !startsWith(github.head_ref, 'dependabot/')",
      "always() && (github.event_name == 'pull_request' || github.event_name == 'merge_group')",
      "(needs.integration-scope.result != 'success' || needs.integration-scope.outputs.run == 'true')",
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "format('type=gha,scope={0},mode=max,ghtoken={1},repository={2}', matrix.service, secrets.GITHUB_TOKEN, github.repository)",
    ];
    for (const source of sources) {
      const once = print(source);
      expect(print(once)).toBe(once);
      expect(parseExpression(once)).toEqual(parseExpression(source));
    }
  });

  test('refuse what is not an expression', () => {
    expect(() => parseExpression('a == ')).toThrow(ExpressionError);
    expect(() => parseExpression("'open")).toThrow('Unterminated string');
    expect(() => parseExpression('a b')).toThrow('Unexpected token');
    expect(() => parseExpression('a @ b')).toThrow('Unexpected character');
    expect(() => parseExpression('f(a,')).toThrow(ExpressionError);
    expect(() => parseExpression('(a')).toThrow('Expected ")"');
  });
});

describe('contextPath', () => {
  test('is undefined for a computed lookup', () => {
    expect(contextPath(parseExpression('a[b]'))).toBeUndefined();
    expect(contextPath(parseExpression('f(a).b'))).toBeUndefined();
    expect(contextPath(parseExpression("a['b'].c"))).toBe('a.b.c');
  });
});

describe('status functions', () => {
  const parse = parseExpression;

  test('are found wherever an expression calls one, in any case', () => {
    for (const source of [
      'always()',
      '!cancelled()',
      'success() && a',
      "a == 'x' || FAILURE()",
      'contains(github.ref, always())',
      'a[always()]',
    ])
      expect(hasStatusFunction(parse(source)), source).toBe(true);
    for (const source of [
      'a',
      "github.event_name == 'push'",
      'contains(github.ref, x)',
    ])
      expect(hasStatusFunction(parse(source)), source).toBe(false);
  });

  test('are put back when a fold left none, and only then', () => {
    const keep = (original: string, folded: string) =>
      printExpression(keepStatusFunction(parse(original), parse(folded)));
    expect(keep('always() || a', 'true')).toBe('always()');
    expect(keep('always() || a', 'b')).toBe('always() && b');
    expect(keep('always() || a', 'b || c')).toBe('always() && (b || c)');
    expect(keep('always() && a', 'false')).toBe('false');
    expect(keep('always() && a', '!cancelled()')).toBe('!cancelled()');
    expect(keep('a || b', 'true')).toBe('true');
  });
});

describe('truthy', () => {
  test('follows GitHub: only false, 0, NaN, empty and null are falsy', () => {
    expect([false, 0, '', null, Number.NaN].some(truthy)).toBe(false);
    expect([true, 1, 'false', 'x', -1].every(truthy)).toBe(true);
  });
});

describe('simplify', () => {
  test('decides the candidate conditions of a ported workflow', () => {
    expect(
      fold(
        "!cancelled() && (((github.event_name == 'repository_dispatch') && needs.candidate-source.result == 'success') || ((github.event_name != 'repository_dispatch') && needs.candidate-source.result == 'skipped'))",
      ),
    ).toBe('!cancelled()');
  });

  test('keeps the conditions that are not about candidates', () => {
    expect(
      fold(
        "!cancelled() && (((github.event_name == 'repository_dispatch') && needs.candidate-source.result == 'success') || ((github.event_name != 'repository_dispatch') && needs.candidate-source.result == 'skipped')) && (github.event.pull_request.draft != true)",
      ),
    ).toBe('!cancelled() && github.event.pull_request.draft != true');
  });

  test('folds what it knows around a name it does not know', () => {
    expect(
      fold("someNewContext.value || github.event_name == 'merge_group'"),
    ).toBe('someNewContext.value');
  });

  test('drops the merge-group half of the readiness gate', () => {
    expect(
      fold(
        "always() && (github.event_name == 'pull_request' || github.event_name == 'merge_group')",
      ),
    ).toBe("always() && github.event_name == 'pull_request'");
  });

  test('follows value semantics of && and || in a value', () => {
    expect(
      fold("github.event_name == 'repository_dispatch' && 1 || 0", 'value'),
    ).toBe('0');
    expect(
      fold(
        "github.event_name == 'repository_dispatch' && format('candidate-{0}', github.event.client_payload.candidate_sha) || github.ref",
        'value',
      ),
    ).toBe('github.ref');
  });

  test('does not drop an operand a value would still show', () => {
    expect(fold('x && true', 'value')).toBe('x && true');
    expect(fold('x && true', 'condition')).toBe('x');
    expect(fold('x || true', 'condition')).toBe('true');
    expect(fold('x || false', 'condition')).toBe('x');
    expect(fold('x && false', 'condition')).toBe('false');
    expect(fold('x || false', 'value')).toBe('x || false');
  });

  test('reads an absent context as null', () => {
    expect(fold('github.event.client_payload.candidate_sha', 'value')).toBe(
      'null',
    );
    expect(fold('needs.candidate-source.outputs.candidate_sha', 'value')).toBe(
      'null',
    );
    expect(fold("github.event.merge_group.base_sha == ''", 'value')).toBe(
      'true',
    );
  });

  test('compares strings without regard to case, as GitHub does', () => {
    const facts: Facts = { values: new Map([['x', 'Skipped']]) };
    expect(
      printExpression(simplify(parseExpression("x == 'skipped'"), facts)),
    ).toBe('true');
    expect(
      printExpression(simplify(parseExpression("x != 'skipped'"), facts)),
    ).toBe('false');
  });

  test('compares different types by their numbers, as GitHub does', () => {
    const facts: Facts = { values: new Map([['x', 1]]) };
    const folded = (source: string) =>
      printExpression(simplify(parseExpression(source), facts));
    expect(folded("x == '1'")).toBe('true');
    expect(folded("x == 'one'")).toBe('false');
    expect(folded("null == ''")).toBe('true');
    expect(folded('true == 1')).toBe('true');
    expect(folded("false == ''")).toBe('true');
    expect(folded("'abc' == 0")).toBe('false');
    expect(folded("'abc' != 0")).toBe('true');
  });

  test('decides only what the declared events settle', () => {
    expect(fold("github.event_name == 'pull_request'")).toBe(
      "github.event_name == 'pull_request'",
    );
    expect(fold("github.event_name != 'push'")).toBe(
      "github.event_name != 'push'",
    );
    expect(fold("github.event_name == 'schedule'")).toBe('false');
    const single: Facts = {
      oneOf: new Map([['github.event_name', ['push']]]),
    };
    const folded = (source: string) =>
      printExpression(simplify(parseExpression(source), single));
    expect(folded("github.event_name == 'PUSH'")).toBe('true');
    expect(folded("'push' != github.event_name")).toBe('false');
    expect(folded("github.event_name == 'pull_request'")).toBe('false');
  });

  test('negates a decided operand', () => {
    expect(fold("!(github.event_name == 'merge_group')")).toBe('true');
    expect(fold("!(github.event_name != 'merge_group')")).toBe('false');
  });

  test('simplifies inside calls and indexes', () => {
    expect(
      fold(
        "contains(fromJSON(needs.x.outputs.y), github.event_name == 'merge_group' && 'a' || 'b')",
        'value',
      ),
    ).toBe("contains(fromJSON(needs.x.outputs.y), 'b')");
  });
});

describe('conditional values', () => {
  const pullRequest = parseExpression("github.event_name == 'pull_request'");
  const scoped: Facts = {
    oneOf: new Map([['github.event_name', ['pull_request', 'push']]]),
    conditional: new Map([
      // A queue-only scope: 'false' for a pull request, 'true' for a batch.
      [
        'needs.scope.outputs.run',
        { when: pullRequest, ifTrue: 'false', ifFalse: 'true' },
      ],
      // An output a pull request leaves unset.
      [
        'needs.scope.outputs.changes',
        { when: pullRequest, ifTrue: '', ifFalse: '["web"]' },
      ],
    ]),
  };
  const read = (source: string, mode: 'condition' | 'value' = 'condition') =>
    printExpression(simplify(parseExpression(source), scoped, mode));

  test('a comparison says what the condition says', () => {
    expect(read("needs.scope.outputs.run == 'true'")).toBe(
      "github.event_name != 'pull_request'",
    );
    expect(read("needs.scope.outputs.run != 'true'")).toBe(
      "github.event_name == 'pull_request'",
    );
    expect(read("'false' == needs.scope.outputs.run")).toBe(
      "github.event_name == 'pull_request'",
    );
    expect(read("needs.scope.outputs.run == 'TRUE'")).toBe(
      "github.event_name != 'pull_request'",
    );
    expect(read("needs.scope.outputs.run == 'maybe'")).toBe('false');
    expect(read("needs.scope.outputs.changes == ''")).toBe(
      "github.event_name == 'pull_request'",
    );
  });

  test('a value is read as the condition picks it', () => {
    expect(read('needs.scope.outputs.run', 'value')).toBe(
      "github.event_name == 'pull_request' && 'false' || 'true'",
    );
    expect(read('needs.scope.outputs.changes', 'value')).toBe(
      "github.event_name != 'pull_request' && '[\"web\"]' || ''",
    );
  });

  test('a truthiness needs only the branches that are not empty', () => {
    expect(read('needs.scope.outputs.run')).toBe('true');
    expect(read('needs.scope.outputs.changes')).toBe(
      "github.event_name != 'pull_request'",
    );
  });

  test('a run of one kind decides it', () => {
    const batch: Facts = {
      ...scoped,
      oneOf: new Map([['github.event_name', ['push']]]),
    };
    const foldBatch = (source: string) =>
      printExpression(simplify(parseExpression(source), batch));
    expect(foldBatch("needs.scope.outputs.run == 'true'")).toBe('true');
    expect(foldBatch('needs.scope.outputs.changes')).toBe('\'["web"]\'');
  });

  test('a condition and its negation fold together', () => {
    expect(
      read(
        "github.event_name != 'pull_request' || (needs.scope.outputs.run == 'true' && needs.scope.outputs.run == 'true')",
      ),
    ).toBe("github.event_name != 'pull_request'");
    expect(
      read(
        "github.event_name == 'pull_request' || needs.scope.outputs.run == 'false'",
      ),
    ).toBe("github.event_name == 'pull_request'");
    expect(
      read(
        "needs.scope.outputs.run == 'true' || github.event_name == 'pull_request'",
      ),
    ).toBe('true');
    expect(
      read(
        "needs.scope.outputs.run == 'true' && github.event_name == 'pull_request'",
      ),
    ).toBe('false');
  });

  test('refuse a value with no branch that can be read back', () => {
    const facts: Facts = {
      conditional: new Map([
        ['x.y', { when: pullRequest, ifTrue: '', ifFalse: null }],
      ]),
    };
    expect(() => simplify(parseExpression('x.y'), facts, 'value')).toThrow(
      ExpressionError,
    );
  });
});

describe('aliases', () => {
  const facts: Facts = {
    aliases: new Map([
      ['github.event_name', new Map([['merge_group', 'push']])],
    ]),
    oneOf: new Map([['github.event_name', ['pull_request', 'push']]]),
  };
  const read = (source: string) =>
    printExpression(simplify(parseExpression(source), facts));

  test('a batch is a push', () => {
    expect(read("github.event_name == 'merge_group'")).toBe(
      "github.event_name == 'push'",
    );
    expect(read("'Merge_Group' != github.event_name")).toBe(
      "'push' != github.event_name",
    );
    expect(read("github.event_name != 'pull_request'")).toBe(
      "github.event_name != 'pull_request'",
    );
  });

  test('a workflow that only has pushes decides it', () => {
    const only: Facts = {
      ...facts,
      oneOf: new Map([['github.event_name', ['push']]]),
    };
    expect(
      printExpression(
        simplify(parseExpression("github.event_name == 'merge_group'"), only),
      ),
    ).toBe('true');
  });
});

describe('templates', () => {
  test('split text from holes, and a quoted }} stays in its string', () => {
    expect(parseTemplate("a ${{ x }} b ${{ format('}}', y) }}")).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'expr', expr: parseExpression('x') },
      { kind: 'text', text: ' b ' },
      { kind: 'expr', expr: parseExpression("format('}}', y)") },
    ]);
    expect(() => parseTemplate('${{ x')).toThrow('Unterminated');
  });

  test('a single hole that folds becomes a typed constant', () => {
    expect(
      foldTemplate(
        "${{ github.event_name == 'repository_dispatch' && 1 || 0 }}",
        forgejo,
      ),
    ).toEqual({ kind: 'constant', value: 0 });
    expect(
      foldTemplate(
        '${{ needs.candidate-source.outputs.candidate_sha }}',
        forgejo,
      ),
    ).toEqual({
      kind: 'constant',
      value: null,
    });
  });

  test('holes inside text are written back as text', () => {
    expect(
      foldTemplate(
        "${{ github.workflow }}-${{ github.event_name == 'repository_dispatch' && 'c' || github.ref }}",
        forgejo,
      ),
    ).toEqual({
      kind: 'text',
      text: '${{ github.workflow }}-${{ github.ref }}',
    });
    expect(
      foldTemplate('pre-${{ needs.candidate-source.result }}-post', forgejo),
    ).toEqual({
      kind: 'text',
      text: 'pre-skipped-post',
    });
  });

  test('a template without holes is its own text', () => {
    expect(foldTemplate('plain text', forgejo)).toEqual({
      kind: 'text',
      text: 'plain text',
    });
  });
});
