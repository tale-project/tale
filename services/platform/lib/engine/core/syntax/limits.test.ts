import { beforeEach, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { createSandboxExecRunner } from '../../runners/sandbox-exec';
import { setCodeRunner } from '../runner';
import { evalCondition, evalTemplates, runCode } from '../template';
import type { Automation } from '../types';
import { validate } from '../validate';
import {
  MAX_BODY_PARSE_TOKENS,
  MAX_BODY_SOURCE_SIZE,
  MAX_PARSE_DEPTH,
  MAX_PARSE_TOKENS,
  MAX_SOURCE_SIZE,
  PARSE_LIMIT_MESSAGE,
  parseBody,
  parseExpressionIn,
} from './parse';
import { exprSegments, tokenizeTemplate } from './tokens';

const expression = (source: string) =>
  parseExpressionIn(source, 0, source.length);
const literal = (size: number) => JSON.stringify('x'.repeat(size - 2));
const array = (items: number) => `[${Array(items).fill('0').join(',')}]`;
const parentheses = (depth: number) =>
  '('.repeat(depth) + '1' + ')'.repeat(depth);
const chain = (items: number) => Array(items).fill('1').join('+');

beforeEach(() => setCodeRunner(nodeVmRunner()));

describe('parser analysis boundaries', () => {
  it.each([MAX_SOURCE_SIZE - 1, MAX_SOURCE_SIZE])(
    'accepts %i source code units',
    (size) => {
      expect(expression(literal(size))).toMatchObject({ ok: true });
    },
  );

  it('refuses the next source code unit', () => {
    expect(expression(literal(MAX_SOURCE_SIZE + 1))).toMatchObject({
      ok: false,
      limited: true,
    });
    expect(
      parseBody(`return ${literal(MAX_BODY_SOURCE_SIZE - 7)};`),
    ).toMatchObject({
      ok: false,
      limited: true,
    });
  });

  it.each([0, 1])('accepts %i extra token at the token boundary', (extra) => {
    // Array brackets, values and commas: 511 tokens; a unary operator is one more.
    expect(
      expression('!'.repeat(extra) + array((MAX_PARSE_TOKENS - 2) / 2)),
    ).toMatchObject({ ok: true });
    expect(
      parseBody(
        `return ${'!'.repeat(extra)}${array((MAX_BODY_PARSE_TOKENS - 4) / 2)};`,
      ),
    ).toMatchObject({ ok: true });
  });

  it('refuses the next token without requiring deep nesting', () => {
    expect(expression('!!' + array((MAX_PARSE_TOKENS - 2) / 2))).toMatchObject({
      ok: false,
      limited: true,
    });
    expect(
      parseBody(`return !!${array((MAX_BODY_PARSE_TOKENS - 4) / 2)};`),
    ).toMatchObject({ ok: false, limited: true });
  });

  it.each([MAX_BODY_SOURCE_SIZE - 1, MAX_BODY_SOURCE_SIZE])(
    'accepts %i transform code units without enlarging expressions',
    (size) => {
      expect(parseBody(`return ${literal(size - 8)};`)).toMatchObject({
        ok: true,
      });
      expect(expression(literal(size))).toMatchObject({
        ok: false,
        limited: true,
      });
    },
  );

  it('keeps malformed code invalid inside the larger body budget', () => {
    const prefix = Array(300).fill('void 0;').join('\n');
    expect(parseBody(`${prefix}\nreturn (;`)).toMatchObject({
      ok: false,
      message: expect.not.stringContaining('limit'),
    });
  });

  it.each([MAX_PARSE_DEPTH - 1, MAX_PARSE_DEPTH])(
    'accepts %i delimiters with a shallow AST',
    (depth) => {
      expect(expression(parentheses(depth))).toMatchObject({ ok: true });
      expect(parseBody(`return ${parentheses(depth)};`)).toMatchObject({
        ok: true,
      });
    },
  );

  it('refuses the next delimiter', () => {
    expect(expression(parentheses(MAX_PARSE_DEPTH + 1))).toMatchObject({
      ok: false,
      limited: true,
    });
    expect(
      parseBody(`return ${parentheses(MAX_PARSE_DEPTH + 1)};`),
    ).toMatchObject({ ok: false, limited: true });
  });

  it('counts actual AST depth, including the body program and return statement', () => {
    expect(expression(chain(MAX_PARSE_DEPTH))).toMatchObject({ ok: true });
    expect(expression(chain(MAX_PARSE_DEPTH + 1))).toMatchObject({
      ok: false,
      limited: true,
    });
    expect(parseBody(`return ${chain(MAX_PARSE_DEPTH - 2)};`)).toMatchObject({
      ok: true,
    });
    expect(parseBody(`return ${chain(MAX_PARSE_DEPTH - 1)};`)).toMatchObject({
      ok: false,
      limited: true,
    });
  });
});

describe('consumer parity at the admitted limits', () => {
  it('admits forty bounded bodies without executing them and retains the node cap', async () => {
    let executions = 0;
    setCodeRunner(
      createSandboxExecRunner(async () => {
        executions++;
        throw new Error('validation cannot execute a body');
      }),
    );
    // 4096 tokens and 16384 code units per body, with a shallow, wide AST.
    const body = `return !${array((MAX_BODY_PARSE_TOKENS - 4) / 2)};`;
    const code = `/*${'x'.repeat(MAX_BODY_SOURCE_SIZE - body.length - 4)}*/${body}`;
    const nodes = Array.from({ length: 40 }, (_, index) => ({
      id: `step${index}`,
      type: 'transform',
      code,
    }));
    const document = {
      version: 1,
      name: 'bounded-bodies',
      nodes,
      output: nodes.map((node) => `{{ nodes.${node.id}.output }}`),
    };
    const admitted = await validate(document);
    expect(admitted.errors).toEqual([]);
    expect(admitted.warnings).toEqual([]);
    const refused = await validate({
      ...document,
      nodes: [...nodes, { id: 'step40', type: 'transform', code }],
    });
    expect(refused.errors).toEqual([
      expect.objectContaining({ code: 'NODES_TOO_MANY' }),
    ]);
    expect(executions).toBe(0);
  });

  it.each([MAX_SOURCE_SIZE - 2, MAX_SOURCE_SIZE - 1, MAX_SOURCE_SIZE])(
    'keeps a quoted closer inside a %i-unit expression through runtime evaluation',
    async (size) => {
      const source = JSON.stringify('}}' + 'x'.repeat(size - 4));
      const value = `{{${source}}}`;
      expect(exprSegments(tokenizeTemplate(value))).toEqual([
        expect.objectContaining({
          source,
          parsed: true,
          start: 0,
          end: value.length,
        }),
      ]);
      await expect(evalTemplates(value, {})).resolves.toBe(JSON.parse(source));
    },
  );

  it.each([
    ['one space', ' '],
    ['line and tab', '\n\t'],
    ['long whitespace', ' '.repeat(MAX_SOURCE_SIZE + 1)],
  ])('keeps %s outside the source-size budget', async (_name, whitespace) => {
    const source = JSON.stringify('}}' + 'x'.repeat(MAX_SOURCE_SIZE - 4));
    const value = `{{${whitespace}${source}${whitespace}}}`;
    expect(exprSegments(tokenizeTemplate(value))).toEqual([
      expect.objectContaining({
        source,
        parsed: true,
        start: 0,
        end: value.length,
      }),
    ]);
    await expect(evalTemplates(value, {})).resolves.toBe(JSON.parse(source));
  });

  it.each([
    "'a}}b'",
    '1 /* }} */',
    '1 // }}\n+ 1',
    '/}}/.test("}}")',
    '`a}}${1}`',
  ])('keeps lexical closers in %s and a long plain suffix', async (source) => {
    const suffix = '('.repeat(MAX_SOURCE_SIZE + 1);
    const value = `{{ ${source} }} ${suffix}`;
    const result = await nodeVmRunner().evalExpr(
      source,
      {},
      { timeoutMs: 1000 },
    );
    await expect(evalTemplates(value, {})).resolves.toBe(
      `${String(result)} ${suffix}`,
    );
    expect(exprSegments(tokenizeTemplate(value))[0]).toMatchObject({
      source,
      parsed: true,
    });
  });

  it('validates and evaluates admitted body and condition depths with the real runner', async () => {
    const source = chain(MAX_PARSE_DEPTH - 2);
    const when = parentheses(MAX_PARSE_DEPTH);
    const doc: Automation = {
      version: 1,
      name: 'boundary-probe',
      nodes: [
        { id: 'main', type: 'transform', code: `return ${source};`, when },
      ],
      output: '{{ nodes.main.output }}',
    };
    expect((await validate(doc)).errors).toEqual([]);
    await expect(evalCondition(when, {})).resolves.toBe(1);
    await expect(runCode(`return ${source};`, {})).resolves.toBe(
      MAX_PARSE_DEPTH - 2,
    );
  });

  it('does not let an installed runner turn an analysis refusal into opaque accepted code', async () => {
    const runner = nodeVmRunner();
    const checked: string[] = [];
    setCodeRunner({
      ...runner,
      async checkBody(source) {
        checked.push(source);
        return await runner.checkBody(source);
      },
      async checkExpr(source) {
        checked.push(source);
        return await runner.checkExpr(source);
      },
    });
    const source = parentheses(MAX_PARSE_DEPTH + 1);
    const doc: Automation = {
      version: 1,
      name: 'boundary-probe',
      nodes: [
        {
          id: 'main',
          type: 'transform',
          code: `return ${source};`,
          when: source,
        },
      ],
      output: '{{ nodes.main.output }}',
    };
    const errors = (await validate(doc)).errors.filter((issue) =>
      ['CODE_SYNTAX', 'EXPR_SYNTAX'].includes(issue.code),
    );
    expect(errors).toHaveLength(2);
    expect(
      errors.every((issue) => issue.params?.detail === PARSE_LIMIT_MESSAGE),
    ).toBe(true);
    expect(checked).toEqual([]);
    const invalid = {
      ...doc,
      nodes: [{ id: 'main', type: 'transform', code: 'return (;' }],
    };
    expect(
      (await validate(invalid)).errors.some(
        (issue) => issue.code === 'CODE_SYNTAX',
      ),
    ).toBe(true);
    expect(checked).toEqual(['return (;']);
  });
});
