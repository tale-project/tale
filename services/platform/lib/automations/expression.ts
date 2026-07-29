/**
 * Translating an org automation's expression language into the engine's
 * template grammar.
 *
 * Automations authored against the imperative step runner carry expressions in
 * a small filter language: `steps.<slug>.output.data`, `variables.x`,
 * `loop.item`, and pipe-applied transforms (`items | length`). The engine
 * speaks ONE grammar instead — a JavaScript expression inside `{{ }}` over
 * `input`, `nodes.<id>.output`, `item` and `index` — so every expression has to
 * be re-emitted, not merely re-quoted.
 *
 * The two languages agree on arithmetic, comparison, ternaries and member
 * access, and disagree on three things that matter:
 *
 *  - member access is null-tolerant in the source language and throws in
 *    JavaScript, so chains are re-emitted with optional chaining — the
 *    faithful translation, not a convenience;
 *  - string literals carry no backslash escapes there and do here, so literal
 *    text is re-escaped when it is emitted;
 *  - `in` and most pipe transforms have no equivalent whose behaviour can be
 *    reproduced exactly.
 *
 * That last group is the whole point of this module: anything that cannot be
 * translated faithfully is REPORTED and left in the author's own words rather
 * than rewritten into something that merely looks right. A wrong silent
 * translation is far more expensive than a flagged one — it runs.
 */

/** What a converted step's output looks like to expressions that read it. */
export type StepOutputKind =
  /** A connector action: reachable, but its payload shape is the connector's. */
  | 'connector'
  /** A model call with no schema: only `.text` exists. */
  | 'llm-text'
  /** A model call with an output schema: the schema-shaped object. */
  | 'llm-json'
  /** A plain data node (variable assignment) whose output is the object. */
  | 'data'
  /** A step that could not be converted; nothing can be said about it. */
  | 'unknown';

export interface ExpressionScope {
  /** Step slug → the node id it became. */
  readonly nodeIds: ReadonlyMap<string, string>;
  /** Step slug → what reading its output now yields. */
  readonly outputKinds: ReadonlyMap<string, StepOutputKind>;
  /** Variable name → the node id whose output carries it. */
  readonly variables: ReadonlyMap<string, string>;
  /** Node id holding the automation's declared constants, when there is one. */
  readonly constantsNodeId?: string;
  /** Names declared as automation constants. */
  readonly constants?: ReadonlySet<string>;
  /** True when the expression is evaluated once per item. */
  readonly iterating: boolean;
  /** The name the iterating step gave the current item. */
  readonly itemVariable?: string;
  /**
   * Slugs of steps that iterate the SAME list as the expression being
   * translated. Their node output is the array of per-item results, so a
   * sibling reads its own item out of it by index.
   */
  readonly perItemOutputs?: ReadonlySet<string>;
}

export interface Translation {
  /** The emitted JavaScript expression. */
  readonly text: string;
  /** One entry per construct that could not be translated faithfully. */
  readonly issues: readonly string[];
}

// ----------------------------------------------------------------- tokenizer

interface Token {
  readonly type: 'number' | 'string' | 'name' | 'punct';
  readonly value: string;
}

/** Longest match first, so `||` never tokenizes as two transform pipes. */
const PUNCTUATORS = [
  '===',
  '!==',
  '==',
  '!=',
  '>=',
  '<=',
  '&&',
  '||',
  '//',
  '**',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  '?',
  '|',
  '!',
  '>',
  '<',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '~',
];

class ExpressionSyntaxError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // Literals carry no escape sequences in the source language: the quote
      // itself is the only terminator, and a backslash is an ordinary char.
      const end = source.indexOf(ch, i + 1);
      if (end === -1) throw new ExpressionSyntaxError('unterminated string');
      tokens.push({ type: 'string', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(source.slice(i));
      if (!match) throw new ExpressionSyntaxError('bad number');
      tokens.push({ type: 'number', value: match[0] });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
      if (!match) throw new ExpressionSyntaxError('bad identifier');
      tokens.push({ type: 'name', value: match[0] });
      i += match[0].length;
      continue;
    }
    const punct = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (punct === undefined) {
      throw new ExpressionSyntaxError(`unexpected character ${ch}`);
    }
    tokens.push({ type: 'punct', value: punct });
    i += punct.length;
  }
  return tokens;
}

// -------------------------------------------------------------------- parser

type Expr =
  | { kind: 'literal'; raw: string }
  | { kind: 'string'; value: string }
  | { kind: 'identifier'; name: string }
  | { kind: 'member'; object: Expr; name?: string; computed?: Expr }
  | { kind: 'unary'; op: string; argument: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'conditional'; test: Expr; consequent: Expr; alternate: Expr }
  | { kind: 'transform'; subject: Expr; name: string; args: Expr[] }
  | { kind: 'array'; items: Expr[] }
  | { kind: 'object'; entries: Array<{ key: string; value: Expr }> }
  | { kind: 'group'; expression: Expr };

/** Binding power per binary operator; transforms bind tighter than all of
 * them and looser than unary and member access. */
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 3,
  '>': 3,
  '<=': 3,
  '>=': 3,
  in: 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
  '//': 5,
  '^': 5,
};

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.parseTernary();
    if (this.pos < this.tokens.length) {
      throw new ExpressionSyntaxError(
        `unexpected "${this.tokens[this.pos].value}"`,
      );
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(value: string): boolean {
    const token = this.peek();
    if (token && token.type === 'punct' && token.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new ExpressionSyntaxError(`expected "${value}"`);
    }
  }

  private parseTernary(): Expr {
    const test = this.parseBinary(1);
    if (!this.eat('?')) return test;
    const consequent = this.parseTernary();
    this.expect(':');
    return {
      kind: 'conditional',
      test,
      consequent,
      alternate: this.parseTernary(),
    };
  }

  private parseBinary(minPrecedence: number): Expr {
    let left = this.parseTransform();
    for (;;) {
      const token = this.peek();
      if (!token) break;
      const op =
        token.type === 'punct' ||
        (token.type === 'name' && token.value === 'in')
          ? token.value
          : undefined;
      const precedence = op === undefined ? undefined : BINARY_PRECEDENCE[op];
      if (
        op === undefined ||
        precedence === undefined ||
        precedence < minPrecedence
      ) {
        break;
      }
      this.pos++;
      const right = this.parseBinary(precedence + 1);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseTransform(): Expr {
    let subject = this.parseUnary();
    while (this.eat('|')) {
      const name = this.peek();
      if (!name || name.type !== 'name') {
        throw new ExpressionSyntaxError('expected a transform name after "|"');
      }
      this.pos++;
      const args: Expr[] = [];
      if (this.eat('(')) {
        if (!this.eat(')')) {
          do {
            args.push(this.parseTernary());
          } while (this.eat(','));
          this.expect(')');
        }
      }
      subject = { kind: 'transform', subject, name: name.value, args };
    }
    return subject;
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (
      token?.type === 'punct' &&
      (token.value === '!' || token.value === '-')
    ) {
      this.pos++;
      return { kind: 'unary', op: token.value, argument: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let node = this.parsePrimary();
    for (;;) {
      if (this.eat('.')) {
        const name = this.peek();
        if (!name || name.type !== 'name') {
          throw new ExpressionSyntaxError('expected a property name after "."');
        }
        this.pos++;
        node = { kind: 'member', object: node, name: name.value };
        continue;
      }
      if (this.eat('[')) {
        const computed = this.parseTernary();
        this.expect(']');
        node = { kind: 'member', object: node, computed };
        continue;
      }
      return node;
    }
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (!token) throw new ExpressionSyntaxError('unexpected end of expression');
    if (token.type === 'number') {
      this.pos++;
      return { kind: 'literal', raw: token.value };
    }
    if (token.type === 'string') {
      this.pos++;
      return { kind: 'string', value: token.value };
    }
    if (token.type === 'name') {
      this.pos++;
      if (['true', 'false', 'null', 'undefined'].includes(token.value)) {
        return { kind: 'literal', raw: token.value };
      }
      return { kind: 'identifier', name: token.value };
    }
    if (this.eat('(')) {
      const expression = this.parseTernary();
      this.expect(')');
      return { kind: 'group', expression };
    }
    if (this.eat('[')) {
      const items: Expr[] = [];
      if (!this.eat(']')) {
        do {
          items.push(this.parseTernary());
        } while (this.eat(','));
        this.expect(']');
      }
      return { kind: 'array', items };
    }
    if (this.eat('{')) {
      const entries: Array<{ key: string; value: Expr }> = [];
      if (!this.eat('}')) {
        do {
          const key = this.peek();
          if (!key || (key.type !== 'name' && key.type !== 'string')) {
            throw new ExpressionSyntaxError('expected an object key');
          }
          this.pos++;
          this.expect(':');
          entries.push({ key: key.value, value: this.parseTernary() });
        } while (this.eat(','));
        this.expect('}');
      }
      return { kind: 'object', entries };
    }
    throw new ExpressionSyntaxError(`unexpected "${token.value}"`);
  }
}

// ------------------------------------------------------------------ emitting

/** Re-encode literal text as a JavaScript string: the source language reads a
 * backslash and a newline literally, so both must be escaped here to mean the
 * same characters. */
function jsStringLiteral(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `'${escaped}'`;
}

/** Transforms whose behaviour is reproducible one-for-one as an expression.
 * Everything absent from this table is reported instead of guessed. */
const TRANSFORMS: Readonly<
  Record<string, (subject: string, args: string[]) => string | null>
> = {
  length: (subject) => `(${subject} || []).length`,
  first: (subject) => `(${subject} || [])[0]`,
  join: (subject, args) =>
    args.length === 1 ? `(${subject} || []).join(${args[0]})` : null,
  concat: (subject, args) =>
    args.length === 1 ? `(${subject} || []).concat(${args[0]})` : null,
  unique: (subject) => `[...new Set(${subject} || [])]`,
  flatten: (subject) => `(${subject} || []).flat()`,
  string: (subject) => `String(${subject} ?? '')`,
  filterBy: (subject, args) =>
    args.length === 2
      ? `(${subject} || []).filter((entry) => entry?.[${args[0]}] == ${args[1]})`
      : null,
  chunk: (subject, args) =>
    args.length === 1
      ? `Array.from({ length: Math.ceil((${subject} || []).length / ${args[0]}) }, (_, at) => (${subject} || []).slice(at * ${args[0]}, at * ${args[0]} + ${args[0]}))`
      : null,
};

/** `map` takes a field name and plucks it; any other argument shape is not
 * reproducible and is reported. */
function emitMap(subject: string, args: Expr[]): string | null {
  const [field] = args;
  if (args.length !== 1 || field.kind !== 'string') return null;
  return `(${subject} || []).map((entry) => entry?.${field.value})`;
}

interface Chain {
  root: Expr;
  path: Array<{ name?: string; computed?: Expr }>;
}

function flattenChain(node: Expr): Chain {
  const path: Chain['path'] = [];
  let current = node;
  while (current.kind === 'member') {
    path.unshift(
      current.name === undefined
        ? { computed: current.computed }
        : { name: current.name },
    );
    current = current.object;
  }
  return { root: current, path };
}

class Emitter {
  readonly issues: string[] = [];

  constructor(private readonly scope: ExpressionScope) {}

  private report(issue: string): void {
    if (!this.issues.includes(issue)) this.issues.push(issue);
  }

  emit(node: Expr): string {
    switch (node.kind) {
      case 'literal':
        return node.raw;
      case 'string':
        return jsStringLiteral(node.value);
      case 'group':
        return `(${this.emit(node.expression)})`;
      case 'unary':
        return `${node.op}${this.emit(node.argument)}`;
      case 'binary': {
        if (node.op === 'in') {
          this.report(
            'the "in" operator has no equivalent with the same behaviour (it matched substrings and array members); rewrite the test explicitly',
          );
        }
        const op = node.op === '//' ? '/' : node.op === '^' ? '**' : node.op;
        return `${this.emit(node.left)} ${op} ${this.emit(node.right)}`;
      }
      case 'conditional':
        return `${this.emit(node.test)} ? ${this.emit(node.consequent)} : ${this.emit(node.alternate)}`;
      case 'array':
        return `[${node.items.map((item) => this.emit(item)).join(', ')}]`;
      case 'object':
        return `{ ${node.entries
          .map((entry) => `${entry.key}: ${this.emit(entry.value)}`)
          .join(', ')} }`;
      case 'transform':
        return this.emitTransform(node);
      default:
        // identifier and member: a reference chain, rooted onto the scope.
        return this.emitChain(node);
    }
  }

  private emitTransform(node: Extract<Expr, { kind: 'transform' }>): string {
    const subject = this.emit(node.subject);
    const args = node.args.map((arg) => this.emit(arg));
    const emitted =
      node.name === 'map'
        ? emitMap(subject, node.args)
        : (TRANSFORMS[node.name]?.(subject, args) ?? null);
    if (emitted !== null) return emitted;
    this.report(
      `the "${node.name}" transform has no equivalent whose result can be reproduced exactly; compute it in a transform node`,
    );
    return `${subject} | ${node.name}${node.args.length > 0 ? `(${args.join(', ')})` : ''}`;
  }

  /** Emit a member chain, rewriting its root onto the engine's scope. */
  private emitChain(node: Expr): string {
    const { root, path } = flattenChain(node);
    if (root.kind !== 'identifier') {
      return this.emitTail(this.emit(root), path, 0);
    }
    switch (root.name) {
      case 'steps':
        return this.emitStepRead(path);
      case 'input':
        return this.emitTail('input', path, 0);
      case 'variables':
        return this.emitVariableRead(path, 'variables');
      case 'config':
        return this.emitVariableRead(path, 'config');
      case 'loop':
        return this.emitLoopRead(path);
      case 'item':
      case 'index':
        return this.emitIterationRead(root.name, path);
      case 'now':
      case 'nowMs':
        this.report(
          `"${root.name}" is not available to expressions — pass the timestamp in as run input, or compute it in the node that needs it`,
        );
        return this.emitTail(root.name, path, 0);
      case 'secrets':
        this.report(
          'secrets are injected into connector calls at run time and are not readable from an expression',
        );
        return this.emitTail(root.name, path, 0);
      default: {
        if (root.name === this.scope.itemVariable) {
          return this.emitIterationRead('item', path);
        }
        this.report(
          `"${root.name}" is not one of the values an expression can read (input, nodes.<id>.output, item, index)`,
        );
        return this.emitTail(root.name, path, 0);
      }
    }
  }

  /** `steps.<slug>.output…` → `nodes.<id>.output…`, minus the result envelope
   * the step runner wrapped every result in. */
  private emitStepRead(path: Chain['path']): string {
    const slug = path[0]?.name;
    if (slug === undefined) {
      this.report(
        'a step is read through a computed name, which cannot be resolved to a node',
      );
      return this.emitTail('steps', path, 0);
    }
    const nodeId = this.scope.nodeIds.get(slug);
    if (nodeId === undefined) {
      this.report(`step "${slug}" has no node in the converted document`);
      return this.emitTail('steps', path, 0);
    }
    const kind = this.scope.outputKinds.get(slug) ?? 'unknown';
    // Everything after `steps.<slug>.output`.
    const rest = path[1]?.name === 'output' ? path.slice(2) : path.slice(1);
    if (path[1]?.name !== 'output') {
      this.report(
        `step "${slug}" is read without ".output"; results are read through .output`,
      );
    }
    const tail = this.stripEnvelope(slug, kind, rest);
    // A sibling node iterating the same list holds one result per item.
    const head =
      this.scope.iterating && this.scope.perItemOutputs?.has(slug) === true
        ? `nodes.${nodeId}.output[index]`
        : `nodes.${nodeId}.output`;
    return this.emitTail(head, tail, 0);
  }

  /** Drop the `data` / `result` wrappers the step runner added, reporting
   * wherever the underlying payload is no longer the same shape. */
  private stripEnvelope(
    slug: string,
    kind: StepOutputKind,
    rest: Chain['path'],
  ): Chain['path'] {
    const withoutData = rest[0]?.name === 'data' ? rest.slice(1) : rest;
    switch (kind) {
      case 'connector': {
        const withoutResult =
          withoutData[0]?.name === 'result'
            ? withoutData.slice(1)
            : withoutData;
        const payload =
          withoutResult[0]?.name === 'data'
            ? withoutResult.slice(1)
            : withoutResult;
        this.report(
          `step "${slug}" reads a connector result — connector actions now return their own shape, so check the field path against the action's output`,
        );
        return payload;
      }
      case 'llm-text': {
        if (withoutData.length > 0) {
          this.report(
            `step "${slug}" reads a field of a model reply that returns plain text; only .output.text exists`,
          );
          return withoutData;
        }
        return [{ name: 'text' }];
      }
      case 'unknown':
        this.report(
          `step "${slug}" could not be converted, so what its output holds is unknown`,
        );
        return withoutData;
      default:
        // A structured model reply or a data node: the field path survives.
        return withoutData;
    }
  }

  private emitVariableRead(path: Chain['path'], root: string): string {
    const name = path[0]?.name;
    if (name === undefined) {
      this.report(
        `"${root}" is read through a computed name, which cannot be resolved`,
      );
      return this.emitTail(root, path, 0);
    }
    const fromAssignment = this.scope.variables.get(name);
    const fromConstants =
      this.scope.constants?.has(name) === true
        ? this.scope.constantsNodeId
        : undefined;
    const nodeId =
      root === 'config'
        ? (fromConstants ?? fromAssignment)
        : (fromAssignment ?? fromConstants);
    if (nodeId === undefined) {
      this.report(
        `"${root}.${name}" is not set by any converted step — declare it as run input or set it in a node`,
      );
      return this.emitTail(root, path, 0);
    }
    return this.emitTail(`nodes.${nodeId}.output.${name}`, path, 1);
  }

  private emitLoopRead(path: Chain['path']): string {
    const field = path[0]?.name;
    if (field === 'item' || field === 'index') {
      return this.emitIterationRead(field, path.slice(1));
    }
    this.report(
      `"loop.${field ?? '?'}" has no equivalent — only the current item and its index are in scope while iterating`,
    );
    return this.emitTail('loop', path, 0);
  }

  private emitIterationRead(
    name: 'item' | 'index',
    path: Chain['path'],
  ): string {
    if (!this.scope.iterating) {
      this.report(
        `"${name}" is only in scope on a node that iterates; this expression runs once`,
      );
    }
    return this.emitTail(name, path, 0);
  }

  /** Append a property path, null-tolerant like the source language. */
  private emitTail(head: string, path: Chain['path'], from: number): string {
    let out = head;
    for (const [at, segment] of path.slice(from).entries()) {
      const optional = at > 0 || from > 0 || head.includes('.');
      if (segment.name === undefined) {
        out += `${optional ? '?.' : ''}[${this.emit(segment.computed ?? { kind: 'literal', raw: '0' })}]`;
      } else {
        out += `${optional ? '?.' : '.'}${segment.name}`;
      }
    }
    return out;
  }
}

// -------------------------------------------------------------- public entry

/** Translate one expression. Anything untranslatable comes back verbatim with
 * an issue describing exactly what a human has to decide. */
export function translateExpression(
  source: string,
  scope: ExpressionScope,
): Translation {
  const trimmed = source.trim();
  if (trimmed === '') return { text: '', issues: [] };
  let parsed: Expr;
  try {
    parsed = new Parser(tokenize(trimmed)).parse();
  } catch (error) {
    return {
      text: trimmed,
      issues: [
        `the expression ${JSON.stringify(trimmed)} could not be read (${
          error instanceof Error ? error.message : String(error)
        }); rewrite it by hand`,
      ],
    };
  }
  const emitter = new Emitter(scope);
  const text = emitter.emit(parsed);
  return { text, issues: emitter.issues };
}

const TEMPLATE_RE = /\{\{\{?([\s\S]+?)\}?\}\}/g;

/** Translate every `{{ }}` span inside a string, leaving the literal text
 * around them untouched. */
export function translateTemplate(
  source: string,
  scope: ExpressionScope,
): Translation {
  const issues: string[] = [];
  let out = '';
  let last = 0;
  for (const match of source.matchAll(TEMPLATE_RE)) {
    const translated = translateExpression(match[1], scope);
    for (const issue of translated.issues) {
      if (!issues.includes(issue)) issues.push(issue);
    }
    out += source.slice(last, match.index) + `{{ ${translated.text} }}`;
    last = (match.index ?? 0) + match[0].length;
  }
  return { text: out + source.slice(last), issues };
}
