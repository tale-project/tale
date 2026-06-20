/**
 * The `when` predicate — a deliberately tiny, closed boolean grammar that gates
 * whether an action button shows for a given item. Availability-as-DATA: the
 * part renders exactly the legal verbs.
 *
 * Grammar (intentionally crippled — NOT JEXL, NOT JS): an OR of AND groups of
 * leaves. A leaf is `field <op> literal` (op ∈ == != > < >= <=), a bare `field`
 * (truthy), or `!field` / `!(field op literal)` negation. Single-level field
 * access on the bound item only; literals are quoted strings, bare words,
 * numbers, or true/false. No parentheses, no function calls, no member chains —
 * richer gating is a workflow concern, not a view concern. Parsing fails CLOSED
 * (a malformed predicate hides the action rather than exposing an illegal one).
 */
type Op = '==' | '!=' | '>=' | '<=' | '>' | '<';

function parseLiteral(raw: string): string | number | boolean {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return t; // bare word → string
}

function compare(
  left: unknown,
  op: Op,
  right: string | number | boolean,
): boolean {
  if (op === '==') return left === right || String(left) === String(right);
  if (op === '!=') return !(left === right || String(left) === String(right));
  const l = typeof left === 'number' ? left : Number(left);
  const r = typeof right === 'number' ? right : Number(right);
  if (Number.isNaN(l) || Number.isNaN(r)) return false;
  if (op === '>') return l > r;
  if (op === '<') return l < r;
  if (op === '>=') return l >= r;
  return l <= r;
}

const LEAF_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function evalLeaf(rawLeaf: string, item: Record<string, unknown>): boolean {
  let leaf = rawLeaf.trim();
  let negate = false;
  while (leaf.startsWith('!')) {
    negate = !negate;
    leaf = leaf.slice(1).trim();
  }
  let result: boolean;
  const m = LEAF_RE.exec(leaf);
  if (m) {
    result = compare(item[m[1]], m[2] as Op, parseLiteral(m[3]));
  } else if (FIELD_RE.test(leaf)) {
    result = Boolean(item[leaf]);
  } else {
    throw new Error(`invalid when leaf: "${rawLeaf}"`);
  }
  return negate ? !result : result;
}

/**
 * Evaluate a `when` predicate against an item record. An empty/absent predicate
 * is always true (the action always shows). Throws are swallowed → fail closed.
 */
export function evaluateWhen(
  expr: string | undefined,
  item: Record<string, unknown>,
): boolean {
  if (expr === undefined || expr.trim() === '') return true;
  try {
    // OR of AND groups.
    return expr
      .split('||')
      .some((orPart) =>
        orPart.split('&&').every((leaf) => evalLeaf(leaf, item)),
      );
  } catch {
    return false;
  }
}
