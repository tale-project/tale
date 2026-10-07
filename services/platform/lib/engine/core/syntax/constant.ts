/**
 * Constant folding for expressions built only from literals — the value a
 * condition such as `{{ true }}`, `{{ 1 > 2 }}` or `{{ [] }}` has on every
 * run, computed without evaluating anything: no `eval`, no `Function`, no
 * property access, no call. Anything that reads a name other than
 * `undefined`, `NaN` and `Infinity` is not constant.
 */

import type { Expression, Node } from 'estree';

export type Folded = { ok: true; value: unknown } | { ok: false };

const NOT_CONSTANT: Folded = { ok: false };

type Primitive = string | number | boolean | bigint | null | undefined;

function isPrimitive(v: unknown): v is Primitive {
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

function binary(op: string, a: Primitive, b: Primitive): Folded {
  // Mixed bigint/number arithmetic throws at run time — not a constant.
  if ((typeof a === 'bigint') !== (typeof b === 'bigint')) {
    if (!['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(op)) {
      return NOT_CONSTANT;
    }
  }
  /* oxlint-disable typescript/no-unsafe-type-assertion -- JavaScript's own operator semantics over primitives are the point; the operands are never objects */
  const x = a as number;
  const y = b as number;
  /* oxlint-enable typescript/no-unsafe-type-assertion */
  switch (op) {
    case '==':
      // oxlint-disable-next-line eslint/eqeqeq -- folds the author's own loose comparison
      return { ok: true, value: a == b };
    case '!=':
      // oxlint-disable-next-line eslint/eqeqeq -- folds the author's own loose comparison
      return { ok: true, value: a != b };
    case '===':
      return { ok: true, value: a === b };
    case '!==':
      return { ok: true, value: a !== b };
    case '<':
      return { ok: true, value: x < y };
    case '>':
      return { ok: true, value: x > y };
    case '<=':
      return { ok: true, value: x <= y };
    case '>=':
      return { ok: true, value: x >= y };
    case '+':
      return { ok: true, value: x + y };
    case '-':
      return { ok: true, value: x - y };
    case '*':
      return { ok: true, value: x * y };
    case '/':
      return typeof a === 'bigint' && b === BigInt(0)
        ? NOT_CONSTANT
        : { ok: true, value: x / y };
    case '%':
      return typeof a === 'bigint' && b === BigInt(0)
        ? NOT_CONSTANT
        : { ok: true, value: x % y };
    case '**':
      return { ok: true, value: x ** y };
    default:
      return NOT_CONSTANT;
  }
}

function fold(node: Node): Folded {
  switch (node.type) {
    case 'Literal':
      if ('regex' in node || 'bigint' in node) {
        return 'bigint' in node && typeof node.value === 'bigint'
          ? { ok: true, value: node.value }
          : NOT_CONSTANT;
      }
      return { ok: true, value: node.value };
    case 'TemplateLiteral':
      return node.expressions.length === 0
        ? { ok: true, value: node.quasis[0]?.value.cooked ?? '' }
        : NOT_CONSTANT;
    case 'Identifier':
      if (node.name === 'undefined') return { ok: true, value: undefined };
      if (node.name === 'NaN') return { ok: true, value: Number.NaN };
      if (node.name === 'Infinity') {
        return { ok: true, value: Number.POSITIVE_INFINITY };
      }
      return NOT_CONSTANT;
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const el of node.elements) {
        if (el === null || el.type === 'SpreadElement') return NOT_CONSTANT;
        const v = fold(el);
        if (!v.ok) return NOT_CONSTANT;
        out.push(v.value);
      }
      return { ok: true, value: out };
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.kind !== 'init' || p.method) {
          return NOT_CONSTANT;
        }
        let key: string;
        if (!p.computed && p.key.type === 'Identifier') key = p.key.name;
        else if (p.key.type === 'Literal' && isPrimitive(p.key.value)) {
          key = String(p.key.value);
        } else return NOT_CONSTANT;
        if (key === '__proto__') return NOT_CONSTANT;
        const v = fold(p.value);
        if (!v.ok) return NOT_CONSTANT;
        out[key] = v.value;
      }
      return { ok: true, value: out };
    }
    case 'UnaryExpression': {
      const v = fold(node.argument);
      if (!v.ok) return NOT_CONSTANT;
      switch (node.operator) {
        case '!':
          return { ok: true, value: !v.value };
        case 'void':
          return { ok: true, value: undefined };
        case 'typeof':
          return { ok: true, value: typeof v.value };
        case '-':
        case '+':
        case '~': {
          if (!isPrimitive(v.value) || v.value === undefined) {
            return NOT_CONSTANT;
          }
          if (node.operator === '+' && typeof v.value === 'bigint') {
            return NOT_CONSTANT;
          }
          if (node.operator === '+')
            return { ok: true, value: Number(v.value) };
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unary arithmetic over a primitive (a bigint included), with the operator's own coercion
          const n = v.value as number;
          return { ok: true, value: node.operator === '-' ? -n : ~n };
        }
        default:
          return NOT_CONSTANT;
      }
    }
    case 'BinaryExpression': {
      if (node.left.type === 'PrivateIdentifier') return NOT_CONSTANT;
      const a = fold(node.left);
      const b = fold(node.right);
      if (!a.ok || !b.ok) return NOT_CONSTANT;
      if (!isPrimitive(a.value) || !isPrimitive(b.value)) return NOT_CONSTANT;
      return binary(node.operator, a.value, b.value);
    }
    case 'LogicalExpression': {
      const a = fold(node.left);
      if (!a.ok) return NOT_CONSTANT;
      if (node.operator === '&&') return a.value ? fold(node.right) : a;
      if (node.operator === '||') return a.value ? a : fold(node.right);
      return a.value === null || a.value === undefined ? fold(node.right) : a;
    }
    case 'ConditionalExpression': {
      const test = fold(node.test);
      if (!test.ok) return NOT_CONSTANT;
      return fold(test.value ? node.consequent : node.alternate);
    }
    case 'SequenceExpression': {
      let last: Folded = NOT_CONSTANT;
      for (const e of node.expressions) {
        last = fold(e);
        if (!last.ok) return NOT_CONSTANT;
      }
      return last;
    }
    default:
      return NOT_CONSTANT;
  }
}

/** The value of a literal-only expression, or `{ ok: false }`. */
export function foldConstant(expr: Expression | Node): Folded {
  return fold(expr);
}
