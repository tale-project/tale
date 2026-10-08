/**
 * The scope-aware reference walk: every place an expression or transform
 * body reads one of the automation's scope names (`nodes`, `input`, `item`,
 * `index`, `output`) or a name nothing declares.
 *
 * Only real references count. A comment, a string literal, a property key
 * (`{ nodes: 1 }`, `x.input`) or a local binding that shadows a scope name
 * (`const nodes = []`, `xs.map(item => item.id)`, `catch (output)`) is not a
 * read of the automation's scope, so it never becomes an edge, a pruned
 * scope entry or a finding.
 *
 * Each site carries its member chain (`nodes.fetch.output.items`), whether
 * the chain is called, and the syntactic guards around it. Guards are
 * recorded, not judged: the rules decide which guard covers which step.
 */

import { tokenizer, type Token } from 'acorn';
import type {
  ConditionalExpression,
  Identifier,
  LogicalExpression,
  MemberExpression,
  Node,
} from 'estree';
import isReference from 'is-reference';
import { analyze, type Scope } from 'periscopic';
import { walk } from 'zimmerframe';

import { ES_GLOBALS } from './globals';

export type RefRoot = 'nodes' | 'input' | 'item' | 'index' | 'output' | 'free';

export type GuardKind =
  | 'optional-chain'
  | 'nullish-left'
  | 'or-left'
  | 'and-guarded'
  | 'ternary-guarded'
  | 'typeof';

export interface PathStep {
  key: string | number;
  /** Read with `?.`. */
  optional: boolean;
  /** Written as `x['key']` / `x[0]` rather than `x.key`. */
  computed: boolean;
  /** Where the chain through this step ends in the field string — the
   * chain's own start to here is the read up to and including the step. */
  end?: number;
}

export interface RefSite {
  root: RefRoot;
  /** The identifier text (for `free`, the undeclared name). */
  name: string;
  /** `nodes.<id>`, `nodes['id']`, `nodes["id"]`, nodes[`id`]. */
  nodeId?: string;
  /** `nodes[expr]`, `...nodes`, `nodes` passed or returned as a value — any
   * node may be read, so no static id is known. */
  dynamicNodeAccess?: true;
  /** For `nodes`: the key right after the id; `output` is the only valid
   * one. */
  member?: string;
  /** Steps after `.output` (nodes) or after the root (every other root). */
  path: PathStep[];
  /** The chain continues with a computed member the walk cannot name
   * (`x[k]`), so `path` stops before it. */
  dynamicTail?: true;
  /** The chain is the callee of a call (`x.y.map(...)`). */
  called?: true;
  guards: GuardKind[];
  /** [start, end) of the member chain in the field string. */
  range: [number, number];
}

/** `.b`, `['b-c']`, `[0]` — member steps as an author would write them. */
export function renderPath(
  steps: ReadonlyArray<Pick<PathStep, 'key'>>,
): string {
  return steps
    .map((s) =>
      typeof s.key === 'number'
        ? `[${s.key}]`
        : /^[A-Za-z_$][\w$]*$/.test(s.key)
          ? `.${s.key}`
          : `[${JSON.stringify(s.key)}]`,
    )
    .join('');
}

/** Every scope name the engine ever hands an expression. */
export const SCOPE_ROOTS: ReadonlySet<string> = new Set([
  'nodes',
  'input',
  'item',
  'index',
  'output',
]);

interface Found {
  site: RefSite;
  /** The outermost node of the chain (a member, the identifier, or the
   * ChainExpression around an optional chain). */
  chain: Node;
  /** The chain's ancestors, root first. */
  ancestors: Node[];
  steps: PathStep[];
}

function rangeOf(node: Node): [number, number] {
  const [start, end] = node.range ?? [0, 0];
  return [start, end];
}

function stepOf(m: MemberExpression): PathStep | null {
  const optional = m.optional;
  if (!m.computed) {
    return m.property.type === 'Identifier'
      ? { key: m.property.name, optional, computed: false }
      : null;
  }
  const p = m.property;
  if (
    p.type === 'Literal' &&
    (typeof p.value === 'string' || typeof p.value === 'number')
  ) {
    return { key: p.value, optional, computed: true };
  }
  if (p.type === 'TemplateLiteral' && p.expressions.length === 0) {
    const quasi = p.quasis[0];
    return {
      key: quasi.value.cooked ?? quasi.value.raw,
      optional,
      computed: true,
    };
  }
  return null;
}

function rootOf(name: string, roots: ReadonlySet<string>): RefRoot | null {
  if (roots.has(name) && SCOPE_ROOTS.has(name)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SCOPE_ROOTS holds exactly the non-free RefRoot names
    return name as RefRoot;
  }
  if (ES_GLOBALS.has(name)) return null;
  return 'free';
}

/** Climb from a root identifier through its static member chain. */
function chainFrom(id: Identifier, root: RefRoot, path: Node[]): Found {
  let chain: Node = id;
  let rangeNode: Node = id;
  let i = path.length - 1;
  const steps: PathStep[] = [];
  let dynamicTail = false;
  while (i >= 0) {
    const parent = path[i];
    if (parent.type === 'ChainExpression') {
      chain = parent;
      i--;
      continue;
    }
    if (parent.type === 'MemberExpression' && parent.object === chain) {
      const step = stepOf(parent);
      if (step === null) {
        dynamicTail = true;
        break;
      }
      steps.push({ ...step, end: rangeOf(parent)[1] });
      chain = parent;
      rangeNode = parent;
      i--;
      continue;
    }
    break;
  }
  const parent = i >= 0 ? path[i] : undefined;
  const called =
    parent?.type === 'CallExpression' &&
    parent.callee === chain &&
    !dynamicTail;

  const site: RefSite = {
    root,
    name: id.name,
    path: steps,
    guards: [],
    range: rangeOf(rangeNode),
  };
  if (dynamicTail) site.dynamicTail = true;
  if (called) site.called = true;
  if (root === 'nodes') {
    if (steps.length === 0) {
      site.dynamicNodeAccess = true;
    } else {
      site.nodeId = String(steps[0].key);
      if (steps.length > 1) site.member = String(steps[1].key);
      site.path = steps.slice(2);
    }
  }
  return { site, chain, ancestors: path.slice(0, i + 1), steps };
}

function isFunction(node: Node): boolean {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  );
}

function within(inner: [number, number], outer: Node): boolean {
  const [s, e] = rangeOf(outer);
  return inner[0] >= s && inner[1] <= e;
}

function isPrefix(a: PathStep[], b: PathStep[]): boolean {
  return a.length <= b.length && a.every((s, i) => s.key === b[i].key);
}

/** Whether `other` reads what `site` reads (or a prefix of it), so a truthy
 * `other` proves `site`'s base exists. */
function readsSame(other: RefSite, site: RefSite): boolean {
  if (other.root !== site.root) return false;
  if (site.root === 'nodes') {
    return (
      site.nodeId !== undefined &&
      other.nodeId === site.nodeId &&
      other.member === 'output'
    );
  }
  if (site.root === 'free') return other.name === site.name;
  return isPrefix(other.path, site.path);
}

function guardsOf(f: Found, all: Found[]): GuardKind[] {
  const guards = new Set<GuardKind>();
  if (f.steps.some((s) => s.optional)) guards.add('optional-chain');
  const testedIn = (expr: Node): boolean =>
    all.some(
      (o) => o !== f && within(o.site.range, expr) && readsSame(o.site, f.site),
    );

  let child: Node = f.chain;
  let transparent = true;
  for (let k = f.ancestors.length - 1; k >= 0; k--) {
    const a = f.ancestors[k];
    // A guard outside a function body does not guard a read inside it.
    if (isFunction(a)) break;
    if (a.type === 'LogicalExpression') {
      guardLogical(a, child, guards, testedIn);
    } else if (a.type === 'ConditionalExpression') {
      guardTernary(a, child, guards, testedIn);
    } else if (
      transparent &&
      a.type === 'UnaryExpression' &&
      a.operator === 'typeof'
    ) {
      guards.add('typeof');
    }
    const passesValue =
      a.type === 'ChainExpression' ||
      (a.type === 'CallExpression' && a.callee === child) ||
      (a.type === 'MemberExpression' && a.object === child);
    if (!passesValue) transparent = false;
    child = a;
  }
  return [...guards];
}

function guardLogical(
  a: LogicalExpression,
  child: Node,
  guards: Set<GuardKind>,
  testedIn: (expr: Node) => boolean,
): void {
  if (a.left === child) {
    if (a.operator === '??') guards.add('nullish-left');
    else if (a.operator === '||') guards.add('or-left');
  } else if (a.right === child && a.operator === '&&' && testedIn(a.left)) {
    guards.add('and-guarded');
  }
}

function guardTernary(
  a: ConditionalExpression,
  child: Node,
  guards: Set<GuardKind>,
  testedIn: (expr: Node) => boolean,
): void {
  if (a.consequent === child && testedIn(a.test)) guards.add('ternary-guarded');
}

/**
 * Every reference to a scope name in `ast`, in source order. `roots` are the
 * names the field's scope declares (`scopeNamesFor`); any other undeclared
 * name that is not a JavaScript global comes back as `root: 'free'`.
 */
export function collectRefs(
  ast: Node,
  opts: { roots: ReadonlySet<string> },
): RefSite[] {
  const { map, scope } = analyze(ast);
  const found: Found[] = [];
  walk<Node, { scope: Scope }>(
    ast,
    { scope },
    {
      _(node, { state, next, path }) {
        const current = map.get(node) ?? state.scope;
        if (node.type === 'Identifier') {
          const parent = path.at(-1);
          if (
            parent !== undefined &&
            (parent.type === 'MetaProperty' || !isReference(node, parent))
          ) {
            return;
          }
          if (current.find_owner(node.name) !== null) return;
          const root = rootOf(node.name, opts.roots);
          if (root !== null) found.push(chainFrom(node, root, [...path]));
          return;
        }
        next({ scope: current });
      },
    },
  );
  found.sort((a, b) => a.site.range[0] - b.site.range[0]);
  for (const f of found) f.site.guards = guardsOf(f, found);
  return found.map((f) => f.site);
}

/**
 * Node references in text that does not parse, found token by token: the
 * dependency graph keeps the edges of a draft whose expression is still
 * being typed. Strings and comments are skipped by the tokenizer; the scan
 * stops where the text stops tokenizing. Scope is not known here, so these
 * sites feed ordering only — never a finding.
 */
export function looseNodeRefs(
  text: string,
  start: number,
  end: number,
): RefSite[] {
  const tokens: Token[] = [];
  try {
    for (const token of tokenizer(text.slice(start, end), {
      ecmaVersion: 'latest',
    })) {
      tokens.push(token);
    }
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    // The tokens read before the error are still references.
  }
  const label = (t: Token | undefined): string | undefined => t?.type.label;
  // acorn's tokens carry their value at run time; its typings omit it.
  const valueOf = (t: Token): unknown => Reflect.get(t, 'value');
  const out: RefSite[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (label(t) !== 'name' || valueOf(t) !== 'nodes') continue;
    const prev = label(tokens[i - 1]);
    if (prev === '.' || prev === '?.') continue;
    let nodeId: string | undefined;
    let last = t;
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    if (
      (label(next) === '.' || label(next) === '?.') &&
      label(after) === 'name'
    ) {
      nodeId = String(valueOf(after));
      last = after;
    } else if (
      label(next) === '[' &&
      label(after) === 'string' &&
      label(tokens[i + 3]) === ']'
    ) {
      nodeId = String(valueOf(after));
      last = tokens[i + 3];
    }
    const site: RefSite = {
      root: 'nodes',
      name: 'nodes',
      path: [],
      guards: [],
      range: [start + t.start, start + last.end],
    };
    if (nodeId === undefined) site.dynamicNodeAccess = true;
    else site.nodeId = nodeId;
    out.push(site);
  }
  return out;
}
