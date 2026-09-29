// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * One failure, one toast. A failed `useBackendMutation` / `useBackendAction`
 * raises a destructive toast of its own unless its call passes
 * `errorToast: false` — a custom `errorToast` object still toasts, and so
 * does a `mutateAsync` awaited inside the caller's own `try`. A caller that
 * reports the same failure again shows the person two toasts for one
 * failure: its own `catch`, `.catch` or `onError` toast; a batch summary
 * toast; the `save` of an editor controller, whose rejection `EditorActions`
 * toasts; a callback that `BulkDeleteBar`, `BulkArchiveBar`,
 * `EntityDeleteDialog` or `EnvVarListEditor` toasts for when it rejects; a
 * query, which retries the write and surfaces its error itself. Either the
 * write stays quiet (`errorToast: false`) and the caller's toast says why,
 * or the caller leaves the reporting to the write.
 *
 * This parses every non-test `.ts` / `.tsx` under `services/platform/app`
 * and indexes each write that toasts on failure: a direct call, a hook that
 * returns one (a hook forwarding its options is judged by the argument at
 * each call site), a hook returning a function that rethrows one, and a hook
 * an adapter object names (`mutations: { useUpdate: … }`). It follows each
 * invocation's rejection up through awaits, returns, rethrowing catches, the
 * local functions it escapes and their callers, to the first place that
 * handles it, and fails on every place that toasts it again.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** The two hooks whose failure raises the default toast. */
const WRITE_HOOKS = new Set(['useBackendMutation', 'useBackendAction']);

/** The hooks whose `save` rejection `EditorActions` toasts. */
const EDITOR_HOOKS = new Set(['useFormEditor', 'useJsonConfigEditor']);

/** Shared surfaces that toast when a callback they are handed rejects. */
const SURFACES: ReadonlyMap<string, readonly string[]> = new Map([
  ['BulkDeleteBar', ['onDeleteItem']],
  ['BulkArchiveBar', ['onArchiveItem']],
  ['EntityDeleteDialog', ['deleteMutation']],
  ['EnvVarListEditor', ['onSet', 'onDelete']],
]);

/** Where a toasting write is declared, as a caller names it. */
interface Origin {
  file: string;
  line: number;
  /** The hook's name, or the contract name a direct call writes. */
  name: string;
}

/** Whether a write toasts its own failure: always, never, or as the options
 * argument at `param` says (a hook forwarding its options). */
type Mode = 'toasts' | 'quiet' | { readonly param: number };

/** A value a call hands back that carries a toasting write. */
interface Write {
  origin: Origin;
  mode: Mode;
  /** The options object the write's own call took, for its `onError`. */
  options?: ts.Expression;
  /** Members that reject with the failure (`mutateAsync`, a hook's rethrowing
   * function); `''` is the value itself. */
  rejects: ReadonlySet<string>;
  /** Members whose call-site `onError` runs beside the default toast
   * (`mutate`); `''` is the value itself. */
  settles: ReadonlySet<string>;
  /** The hook whose returned function rethrows the write, when it is not the
   * write's own hook. */
  through?: string;
}

interface Violation {
  origin: Origin;
  /** The file and line of the second report. */
  file: string;
  line: number;
  /** What reports the failure the second time. */
  via: string;
}

interface Walk {
  write: Write;
  /** Promises and names already followed, so a cycle ends. */
  seen: Set<ts.Node>;
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

const MUTATION_REJECTS: ReadonlySet<string> = new Set(['mutateAsync']);
const MUTATION_SETTLES: ReadonlySet<string> = new Set(['mutate']);
const NONE: ReadonlySet<string> = new Set();
const ITSELF: ReadonlySet<string> = new Set(['']);

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** `(x)`, `x as T`, `x!`, `x satisfies T`, `<T>x` — the value is `x`. */
function isWrapper(
  node: ts.Node,
): node is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.NonNullExpression
  | ts.SatisfiesExpression
  | ts.TypeAssertion {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (isWrapper(current)) current = current.expression;
  return current;
}

/** `node` with every wrapper around it. */
function outer(node: ts.Node): ts.Node {
  let current = node;
  while (isWrapper(current.parent)) current = current.parent;
  return current;
}

function nameText(name: ts.Node | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function propertyName(
  property: ts.ObjectLiteralElementLike,
): string | undefined {
  return ts.isSpreadAssignment(property) ? undefined : nameText(property.name);
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function isCallTo(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && calleeName(node) === name;
}

function isHookName(name: string | undefined): boolean {
  return name !== undefined && /^use[A-Z]/.test(name);
}

function lineOf(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function enclosingFunction(node: ts.Node): FunctionNode | undefined {
  let current = node.parent;
  while (current !== undefined && !isFunctionNode(current)) {
    current = current.parent;
  }
  return current;
}

/** `node` and its descendants; nested functions only when `nested`. */
function* walkTree(node: ts.Node, nested: boolean): Generator<ts.Node> {
  const stack: ts.Node[] = [node];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    yield next;
    if (next === node || nested || !isFunctionNode(next)) {
      ts.forEachChild(next, (child) => {
        stack.push(child);
      });
    }
  }
}

/** The expressions `fn` returns, nested functions aside. */
function returnedExpressions(fn: FunctionNode): ts.Expression[] {
  if (fn.body === undefined) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  for (const node of walkTree(fn.body, false)) {
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      out.push(node.expression);
    }
  }
  return out;
}

/** The name a top-level function is declared under; undefined for any
 * other function. */
function topLevelName(fn: FunctionNode): string | undefined {
  if (ts.isFunctionDeclaration(fn)) {
    return ts.isSourceFile(fn.parent) ? fn.name?.text : undefined;
  }
  const declaration = outer(fn).parent;
  return ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    ts.isSourceFile(declaration.parent.parent.parent)
    ? declaration.name.text
    : undefined;
}

/** The identifier a chain like `a.b[c].d` starts from. */
function rootIdentifier(node: ts.Expression): ts.Identifier | undefined {
  let current = unwrap(node);
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = unwrap(current.expression);
  }
  return ts.isIdentifier(current) ? current : undefined;
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name),
  );
}

function isAssignment(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

/** Whether a catch block or handler throws again, on any branch. */
function rethrows(body: ts.Node): boolean {
  for (const node of walkTree(body, false)) {
    if (ts.isThrowStatement(node)) return true;
  }
  return false;
}

/** The names a catch block keeps the failure in for later — a list it
 * pushes onto, a count it bumps, a variable it assigns. */
function recordedNames(block: ts.Block): Set<string> {
  const names = new Set<string>();
  const add = (target: ts.Expression) => {
    const root = rootIdentifier(target);
    if (root !== undefined) names.add(root.text);
  };
  for (const node of walkTree(block, false)) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'push'
    ) {
      add(node.expression.expression);
    } else if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      add(node.operand);
    } else if (isAssignment(node)) {
      add(node.left);
    }
  }
  return names;
}

function mentions(node: ts.Node, names: ReadonlySet<string>): boolean {
  for (const child of walkTree(node, true)) {
    if (ts.isIdentifier(child) && names.has(child.text)) return true;
  }
  return false;
}

/** Scans a set of files, parsed with the TypeScript compiler. */
class Scan {
  private readonly trees = new Map<string, ts.SourceFile | null>();
  private readonly identifiers = new Map<
    ts.SourceFile,
    Map<string, ts.Identifier[]>
  >();
  private readonly toasting = new Map<ts.Node, boolean>();
  private readonly writes = new Map<ts.Node, Write[]>();
  /** Object-literal hooks by key, for the adapter shape
   * `mutations: { useUpdate: () => looseMutation(useUpdateCredential()) }`. */
  private readonly propertyHooks = new Map<string, ts.Expression[]>();
  /** Hooks found returning functions that rethrow a toasting write: by the
   * hook's function node, the member, and the write's origin. */
  private readonly derived = new Map<
    ts.Node,
    Map<string, Map<string, Origin>>
  >();
  private changed = false;
  private found: Violation[] = [];

  constructor(
    private readonly read: (file: string) => string | undefined,
    private readonly files: readonly string[],
  ) {}

  run(): Violation[] {
    const trees = this.files
      .map((file) => this.tree(file))
      .filter((tree) => tree !== undefined);
    for (const tree of trees) this.indexPropertyHooks(tree);
    // A hook's rethrowing members are found while its own file is scanned,
    // so a caller scanned before it needs another round.
    for (let round = 0; round < 10; round++) {
      this.changed = false;
      this.found = [];
      this.writes.clear();
      for (const tree of trees) this.scanFile(tree);
      if (!this.changed) break;
    }
    const seen = new Set<string>();
    return this.found.filter((violation) => {
      const key = `${keyOf(violation)}@${violation.file}:${violation.line}:${violation.via}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Files, modules, names ──────────────────────────────────────────────

  private tree(file: string): ts.SourceFile | undefined {
    const cached = this.trees.get(file);
    if (cached !== undefined) return cached ?? undefined;
    const text = this.read(file);
    const tree =
      text === undefined
        ? null
        : ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          );
    this.trees.set(file, tree);
    return tree ?? undefined;
  }

  private resolveModule(from: string, specifier: string): string | undefined {
    let base: string;
    if (specifier.startsWith('@/')) base = specifier.slice(2);
    else if (specifier.startsWith('.')) {
      base = path.posix.join(path.posix.dirname(from), specifier);
    } else return undefined;
    return [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((candidate) => this.tree(candidate) !== undefined);
  }

  /** The top-level declaration of `name` in `file`. */
  private topLevel(file: string, name: string): ts.Node | undefined {
    const tree = this.tree(file);
    for (const statement of tree?.statements ?? []) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
        return statement;
      if (ts.isVariableStatement(statement)) {
        const declaration = statement.declarationList.declarations.find(
          (entry) => nameText(entry.name) === name,
        );
        if (declaration !== undefined) return declaration;
      }
    }
    return undefined;
  }

  /** The declaration an identifier refers to, by lexical scope. */
  private lookup(id: ts.Identifier): ts.Node | undefined {
    const name = id.text;
    const inPattern = (
      pattern: ts.BindingName,
      whole: ts.Node,
    ): ts.Node | undefined => {
      if (ts.isIdentifier(pattern)) {
        return pattern.text === name ? whole : undefined;
      }
      for (const element of pattern.elements) {
        if (ts.isOmittedExpression(element)) continue;
        const hit = inPattern(element.name, element);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const inStatements = (
      statements: readonly ts.Statement[],
    ): ts.Node | undefined => {
      for (const statement of statements) {
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === name
        ) {
          return statement;
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            const hit = inPattern(declaration.name, declaration);
            if (hit !== undefined) return hit;
          }
        }
        if (ts.isImportDeclaration(statement)) {
          const clause = statement.importClause;
          if (clause?.name?.text === name) return clause;
          const bindings = clause?.namedBindings;
          if (bindings !== undefined && ts.isNamedImports(bindings)) {
            const hit = bindings.elements.find(
              (element) => element.name.text === name,
            );
            if (hit !== undefined) return hit;
          }
        }
      }
      return undefined;
    };
    for (let scope = id.parent; scope !== undefined; scope = scope.parent) {
      if (isFunctionNode(scope)) {
        for (const parameter of scope.parameters) {
          const hit = inPattern(parameter.name, parameter);
          if (hit !== undefined) return hit;
        }
      }
      if (
        ts.isBlock(scope) ||
        ts.isSourceFile(scope) ||
        ts.isCaseClause(scope) ||
        ts.isDefaultClause(scope)
      ) {
        const hit = inStatements(scope.statements);
        if (hit !== undefined) return hit;
      }
      if (
        (ts.isForOfStatement(scope) ||
          ts.isForInStatement(scope) ||
          ts.isForStatement(scope)) &&
        scope.initializer !== undefined &&
        ts.isVariableDeclarationList(scope.initializer)
      ) {
        for (const declaration of scope.initializer.declarations) {
          const hit = inPattern(declaration.name, declaration);
          if (hit !== undefined) return hit;
        }
      }
      if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
        const hit = inPattern(
          scope.variableDeclaration.name,
          scope.variableDeclaration,
        );
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  }

  /** The function a declaration holds: itself, a `const` arrow or function,
   * a `useCallback` around one, or what an import names. */
  private functionOf(
    declaration: ts.Node | undefined,
  ): FunctionNode | undefined {
    if (declaration === undefined) return undefined;
    if (ts.isFunctionDeclaration(declaration)) return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      let value = unwrap(declaration.initializer);
      if (isCallTo(value, 'useCallback') && value.arguments[0] !== undefined) {
        value = unwrap(value.arguments[0]);
      }
      return ts.isArrowFunction(value) || ts.isFunctionExpression(value)
        ? value
        : undefined;
    }
    if (ts.isImportSpecifier(declaration)) {
      const module = declaration.parent.parent.parent.moduleSpecifier;
      if (!ts.isStringLiteral(module)) return undefined;
      const file = this.resolveModule(
        declaration.getSourceFile().fileName,
        module.text,
      );
      const exported = (declaration.propertyName ?? declaration.name).text;
      return file === undefined
        ? undefined
        : this.functionOf(this.topLevel(file, exported));
    }
    return undefined;
  }

  /** Every identifier of `tree` that reads a binding, by name. */
  private identifiersOf(tree: ts.SourceFile): Map<string, ts.Identifier[]> {
    const cached = this.identifiers.get(tree);
    if (cached !== undefined) return cached;
    const index = new Map<string, ts.Identifier[]>();
    for (const node of walkTree(tree, true)) {
      if (!ts.isIdentifier(node)) continue;
      const parent = node.parent;
      const isKey =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        (ts.isJsxAttribute(parent) && parent.name === node) ||
        ts.isImportSpecifier(parent);
      if (isKey) continue;
      const list = index.get(node.text) ?? [];
      list.push(node);
      index.set(node.text, list);
    }
    this.identifiers.set(tree, index);
    return index;
  }

  /** The reads of a declared name within its file. */
  private references(
    declaration:
      | ts.VariableDeclaration
      | ts.BindingElement
      | ts.FunctionDeclaration
      | ts.ParameterDeclaration,
  ): ts.Identifier[] {
    const name = declaration.name;
    if (name === undefined || !ts.isIdentifier(name)) return [];
    const candidates =
      this.identifiersOf(declaration.getSourceFile()).get(name.text) ?? [];
    return candidates.filter(
      (id) => id !== name && this.lookup(id) === declaration,
    );
  }

  // ── Toasts ─────────────────────────────────────────────────────────────

  /** A call that raises a toast: `toast(…)`, `x.toast(…)`, or a call of a
   * function (same file or imported) that does. */
  private isToastCall(call: ts.CallExpression): boolean {
    const callee = unwrap(call.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      return callee.name.text === 'toast';
    }
    if (!ts.isIdentifier(callee)) return false;
    if (callee.text === 'toast') return true;
    const fn = this.functionOf(this.lookup(callee));
    return fn !== undefined && this.functionToasts(fn);
  }

  private functionToasts(fn: FunctionNode): boolean {
    const cached = this.toasting.get(fn);
    if (cached !== undefined) return cached;
    this.toasting.set(fn, false);
    const toasts =
      fn.body !== undefined && this.toastingCall(fn.body, true) !== undefined;
    this.toasting.set(fn, toasts);
    return toasts;
  }

  /** The first toasting call in `node` that starts at or after `after`;
   * nested functions only when `nested`. */
  private toastingCall(
    node: ts.Node,
    nested: boolean,
    after = -1,
    accept: (call: ts.CallExpression) => boolean = () => true,
  ): ts.CallExpression | undefined {
    for (const child of walkTree(node, nested)) {
      if (
        ts.isCallExpression(child) &&
        child.pos >= after &&
        this.isToastCall(child) &&
        accept(child)
      ) {
        return child;
      }
    }
    return undefined;
  }

  /** The function a handler is: inline, or the one a name refers to. */
  private handlerFunction(
    handler: ts.Node | undefined,
  ): FunctionNode | undefined {
    if (handler === undefined) return undefined;
    if (isFunctionNode(handler)) return handler;
    if (ts.isShorthandPropertyAssignment(handler)) {
      return this.functionOf(this.lookup(handler.name));
    }
    if (!ts.isExpression(handler)) return undefined;
    const value = unwrap(handler);
    if (isFunctionNode(value)) return value;
    return ts.isIdentifier(value)
      ? this.functionOf(this.lookup(value))
      : undefined;
  }

  /** A toast raised after `node` in the function that holds it and read from
   * what the batch recorded (`names`): a summary of its failures. */
  private summaryToast(
    node: ts.Node,
    names: ReadonlySet<string>,
  ): ts.CallExpression | undefined {
    const fn = enclosingFunction(node);
    if (fn?.body === undefined || names.size === 0) return undefined;
    // What the recorded failures flow into: `failed` → `groups` → the toast.
    const tainted = new Set(names);
    for (let grew = true; grew;) {
      grew = false;
      for (const child of walkTree(fn.body, false)) {
        if (
          ts.isVariableDeclaration(child) &&
          child.initializer !== undefined &&
          mentions(child.initializer, tainted)
        ) {
          for (const name of boundNames(child.name)) {
            if (!tainted.has(name)) {
              tainted.add(name);
              grew = true;
            }
          }
        }
      }
    }
    const readsFailures = (call: ts.CallExpression): boolean => {
      if (call.arguments.some((argument) => mentions(argument, tainted))) {
        return true;
      }
      for (let at: ts.Node = call; at !== fn; at = at.parent) {
        if (ts.isIfStatement(at.parent) && at !== at.parent.expression) {
          if (mentions(at.parent.expression, tainted)) return true;
        }
      }
      return false;
    };
    return this.toastingCall(fn.body, false, node.end, readsFailures);
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  private indexPropertyHooks(tree: ts.SourceFile): void {
    for (const node of walkTree(tree, true)) {
      if (!ts.isPropertyAssignment(node)) continue;
      const key = nameText(node.name);
      if (!isHookName(key) || key === undefined) continue;
      const list = this.propertyHooks.get(key) ?? [];
      list.push(node.initializer);
      this.propertyHooks.set(key, list);
    }
  }

  /** The functions a callee names: the declaration it resolves to, or every
   * hook an adapter object keys under its property name. */
  private calleeFunctions(callee: ts.Expression): FunctionNode[] {
    const target = unwrap(callee);
    if (ts.isIdentifier(target)) {
      const fn = this.functionOf(this.lookup(target));
      return fn === undefined ? [] : [fn];
    }
    if (!ts.isPropertyAccessExpression(target)) return [];
    const out: FunctionNode[] = [];
    for (const value of this.propertyHooks.get(target.name.text) ?? []) {
      const hook = unwrap(value);
      if (isFunctionNode(hook)) out.push(hook);
      else if (ts.isIdentifier(hook)) {
        const fn = this.functionOf(this.lookup(hook));
        if (fn !== undefined) out.push(fn);
      }
    }
    return out;
  }

  /** How an options object decides the default toast: an unset
   * `errorToast` leaves it on. */
  private modeOf(expr: ts.Expression | undefined): Mode {
    return this.errorToastOf(expr) ?? 'toasts';
  }

  /** How an options object sets `errorToast`, or undefined when it leaves it
   * unset — so a later spread that sets it wins over an earlier one, as the
   * object it builds does. */
  private errorToastOf(expr: ts.Expression | undefined): Mode | undefined {
    if (expr === undefined) return undefined;
    const value = unwrap(expr);
    if (ts.isObjectLiteralExpression(value)) {
      let mode: Mode | undefined;
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          mode = this.errorToastOf(property.expression) ?? mode;
        } else if (propertyName(property) === 'errorToast') {
          const setting = ts.isPropertyAssignment(property)
            ? property.initializer
            : ts.isShorthandPropertyAssignment(property)
              ? property.name
              : undefined;
          if (setting !== undefined) {
            mode = this.isFalse(setting)
              ? 'quiet'
              : (this.forwardedParam(setting) ?? 'toasts');
          }
        }
      }
      return mode;
    }
    if (ts.isIdentifier(value)) {
      const forwarded = this.forwardedParam(value);
      if (forwarded !== undefined) return forwarded;
      const declaration = this.lookup(value);
      return declaration !== undefined &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined
        ? this.errorToastOf(declaration.initializer)
        : undefined;
    }
    if (ts.isCallExpression(value)) {
      // An options factory: `...useRefusalFeedback()`.
      const [fn] = this.calleeFunctions(value.expression);
      const [returned] = fn === undefined ? [] : returnedExpressions(fn);
      return this.errorToastOf(returned);
    }
    if (ts.isConditionalExpression(value)) {
      return this.modeOf(value.whenTrue) === 'quiet' &&
        this.modeOf(value.whenFalse) === 'quiet'
        ? 'quiet'
        : 'toasts';
    }
    return undefined;
  }

  /** `false`, or a `const` holding it. */
  private isFalse(expr: ts.Expression): boolean {
    const value = unwrap(expr);
    if (value.kind === ts.SyntaxKind.FalseKeyword) return true;
    if (!ts.isIdentifier(value)) return false;
    const declaration = this.lookup(value);
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      this.isFalse(declaration.initializer)
    );
  }

  /** The parameter an expression forwards (`options`, `options?.x`, a
   * destructured `{ errorToast }`), by its index in its function. */
  private forwardedParam(expr: ts.Expression): Mode | undefined {
    const root = rootIdentifier(expr);
    if (root === undefined) return undefined;
    let declaration = this.lookup(root);
    while (declaration !== undefined && ts.isBindingElement(declaration)) {
      declaration = declaration.parent.parent;
    }
    if (declaration === undefined || !ts.isParameter(declaration)) {
      return undefined;
    }
    const fn = declaration.parent;
    return isFunctionNode(fn)
      ? { param: fn.parameters.indexOf(declaration) }
      : undefined;
  }

  /** What a call hands back that carries a toasting write. */
  private writesOfCall(call: ts.CallExpression): Write[] {
    const callee = unwrap(call.expression);
    if (ts.isIdentifier(callee) && WRITE_HOOKS.has(callee.text)) {
      const [contract, options] = call.arguments;
      return [
        {
          origin: {
            file: call.getSourceFile().fileName,
            line: lineOf(call),
            name:
              contract !== undefined && ts.isStringLiteralLike(contract)
                ? contract.text
                : callee.text,
          },
          mode: this.modeOf(options),
          ...(options !== undefined ? { options } : {}),
          rejects: MUTATION_REJECTS,
          settles: MUTATION_SETTLES,
        },
      ];
    }
    const out: Write[] = [];
    for (const fn of this.calleeFunctions(call.expression)) {
      const name = topLevelName(fn);
      for (const write of this.writesOfFunction(fn)) {
        let stamped = write;
        if (name !== undefined) {
          // A caller names the hook it calls: the write is that hook's,
          // unless the hook only rethrows one of another hook's.
          stamped =
            write.through === undefined && write.rejects === MUTATION_REJECTS
              ? {
                  ...write,
                  origin: {
                    file: fn.getSourceFile().fileName,
                    line: lineOf(
                      ts.isFunctionDeclaration(fn)
                        ? fn
                        : outer(fn).parent.parent.parent,
                    ),
                    name,
                  },
                }
              : { ...write, through: write.through ?? name };
        }
        if (typeof stamped.mode === 'object') {
          const options = call.arguments[stamped.mode.param];
          const { options: _inner, ...rest } = stamped;
          stamped = {
            ...rest,
            mode: this.modeOf(options),
            ...(options !== undefined ? { options } : {}),
          };
        }
        out.push(stamped);
      }
    }
    return out;
  }

  /** The value `access` picks off a write: `useX().mutateAsync`. */
  private pick(write: Write, member: string): Write | undefined {
    if (write.rejects.has(member)) {
      return { ...write, rejects: ITSELF, settles: NONE };
    }
    if (write.settles.has(member)) {
      return { ...write, rejects: NONE, settles: ITSELF };
    }
    return undefined;
  }

  /** What `expr` evaluates to that carries a toasting write. */
  private writesOfValue(expr: ts.Expression): Write[] {
    let value = unwrap(expr);
    if (ts.isIdentifier(value)) {
      const declaration = this.lookup(value);
      if (
        declaration === undefined ||
        !ts.isVariableDeclaration(declaration) ||
        declaration.initializer === undefined
      ) {
        return [];
      }
      value = unwrap(declaration.initializer);
    }
    if (ts.isPropertyAccessExpression(value)) {
      const target = unwrap(value.expression);
      if (!ts.isCallExpression(target)) return [];
      return this.writesOfCall(target)
        .map((write) => this.pick(write, value.name.text))
        .filter((write) => write !== undefined);
    }
    if (!ts.isCallExpression(value)) return [];
    const writes = this.writesOfCall(value);
    if (writes.length > 0 || isHookName(calleeName(value))) return writes;
    // A pass-through wrapper around a hook's result:
    // `looseMutation(useUpdateCredential())`.
    return value.arguments.flatMap((argument) => {
      const inner = unwrap(argument);
      return ts.isCallExpression(inner) ? this.writesOfCall(inner) : [];
    });
  }

  /** What calling `fn` hands back that carries a toasting write. */
  private writesOfFunction(fn: FunctionNode): Write[] {
    const cached = this.writes.get(fn);
    if (cached !== undefined) return cached;
    this.writes.set(fn, []);
    const out = returnedExpressions(fn).flatMap((returned) =>
      this.writesOfValue(returned),
    );
    for (const [member, origins] of this.derived.get(fn) ?? []) {
      for (const origin of origins.values()) {
        out.push({
          origin,
          mode: 'toasts',
          rejects: new Set([member]),
          settles: NONE,
        });
      }
    }
    this.writes.set(fn, out);
    return out;
  }

  // ── Following a rejection ──────────────────────────────────────────────

  private scanFile(tree: ts.SourceFile): void {
    for (const node of walkTree(tree, true)) {
      if (ts.isCallExpression(node) && isWriteHookCall(node)) {
        for (const write of this.writesOfCall(node)) this.ownOnError(write);
      }
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const value = unwrap(node.initializer);
        const call = ts.isPropertyAccessExpression(value)
          ? unwrap(value.expression)
          : value;
        if (!ts.isCallExpression(call)) continue;
        for (const write of this.writesOfValue(value)) {
          if (!isWriteHookCall(call)) this.ownOnError(write);
          this.bind(node, write);
        }
      }
    }
  }

  /** A call whose own options' `onError` toasts beside the default toast. */
  private ownOnError(write: Write): void {
    if (write.mode !== 'toasts' || write.options === undefined) return;
    this.onErrorOf(write.options, write, "the call's own onError toasts");
  }

  /** `options` is an object literal (or a name holding one) whose `onError`
   * toasts: report it. */
  private onErrorOf(options: ts.Expression, write: Write, via: string): void {
    let literal = unwrap(options);
    if (ts.isIdentifier(literal)) {
      const declaration = this.lookup(literal);
      if (
        declaration === undefined ||
        !ts.isVariableDeclaration(declaration) ||
        declaration.initializer === undefined
      ) {
        return;
      }
      literal = unwrap(declaration.initializer);
    }
    if (!ts.isObjectLiteralExpression(literal)) return;
    for (const property of literal.properties) {
      if (propertyName(property) !== 'onError') continue;
      const handler = this.handlerFunction(
        ts.isPropertyAssignment(property) ? property.initializer : property,
      );
      if (handler?.body !== undefined) {
        if (this.toastingCall(handler.body, true) !== undefined) {
          this.report(write, property, via);
        }
      }
    }
  }

  /** Follow every use of a toasting write a declaration binds. */
  private bind(declaration: ts.VariableDeclaration, write: Write): void {
    if (write.mode !== 'toasts') return;
    const walk: Walk = { write, seen: new Set() };
    const track = (reference: ts.Expression, member: string) => {
      if (write.rejects.has(member)) this.useValue(reference, walk);
      else if (write.settles.has(member)) this.settled(reference, walk);
    };
    if (ts.isIdentifier(declaration.name)) {
      for (const reference of this.references(declaration)) {
        track(reference, '');
        const access = outer(reference).parent;
        if (
          ts.isPropertyAccessExpression(access) &&
          access.expression === outer(reference)
        ) {
          track(access, access.name.text);
        }
      }
      return;
    }
    if (!ts.isObjectBindingPattern(declaration.name)) return;
    for (const element of declaration.name.elements) {
      const key = nameText(element.propertyName ?? element.name);
      if (key === undefined || !ts.isIdentifier(element.name)) continue;
      for (const reference of this.references(element)) track(reference, key);
    }
  }

  /** `mutate(vars, { onError })`: the call-site `onError` runs beside the
   * default toast. */
  private settled(callee: ts.Expression, walk: Walk): void {
    const call = outer(callee).parent;
    if (!ts.isCallExpression(call) || call.expression !== outer(callee)) return;
    const options = call.arguments[1];
    if (options !== undefined) {
      this.onErrorOf(options, walk.write, 'its onError toasts');
    }
  }

  /** `value` evaluates to a function that rejects with the failure: follow
   * what happens to it. */
  private useValue(value: ts.Expression, walk: Walk): void {
    const node = outer(value);
    const parent = node.parent;
    if (ts.isCallExpression(parent)) {
      if (parent.expression === node) this.follow(parent, walk);
      else this.passed(parent, node, walk);
    } else if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
      this.attribute(parent.parent, walk);
    } else if (
      (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
      ts.isShorthandPropertyAssignment(parent)
    ) {
      this.member(parent, walk);
    } else if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === node
    ) {
      this.exitValue(parent, walk);
    }
  }

  /** A rejecting function handed to `call` as an argument. */
  private passed(call: ts.CallExpression, argument: ts.Node, walk: Walk): void {
    const name = calleeName(call);
    if (name === 'useCallback') {
      const declaration = outer(call).parent;
      if (ts.isVariableDeclaration(declaration)) {
        this.exitValue(declaration, walk);
      }
      return;
    }
    if (name === 'map' || name === 'flatMap' || name === 'then') {
      this.follow(call, walk);
      return;
    }
    // A local runner calling it back: `run(id, () => stop.mutateAsync(…))`.
    const index = call.arguments.findIndex(
      (entry) => outer(entry) === argument,
    );
    for (const fn of this.calleeFunctions(call.expression)) {
      if (fn.getSourceFile() !== call.getSourceFile()) continue;
      const parameter = fn.parameters[index];
      if (parameter === undefined) continue;
      for (const reference of this.references(parameter)) {
        this.useValue(reference, walk);
      }
    }
  }

  /** Follow the reads of a name that holds a rejecting function. */
  private exitValue(
    declaration: ts.VariableDeclaration | ts.FunctionDeclaration,
    walk: Walk,
  ): void {
    if (walk.seen.has(declaration)) return;
    walk.seen.add(declaration);
    for (const reference of this.references(declaration)) {
      this.useValue(reference, walk);
    }
  }

  /** `fn` hands back a promise that rejects with the failure. */
  private exitFunction(fn: FunctionNode, walk: Walk): void {
    if (ts.isFunctionDeclaration(fn)) this.exitValue(fn, walk);
    else if (ts.isMethodDeclaration(fn)) this.member(fn, walk);
    else this.useValue(fn, walk);
  }

  /** A rejecting function stored under a key of an object literal. */
  private member(
    property:
      | ts.PropertyAssignment
      | ts.ShorthandPropertyAssignment
      | ts.MethodDeclaration,
    walk: Walk,
  ): void {
    const object = property.parent;
    const key = nameText(property.name);
    if (!ts.isObjectLiteralExpression(object) || key === undefined) return;
    if (key === 'save' && this.isEditorController(object)) {
      this.report(
        walk.write,
        property,
        'EditorActions toasts the rejected save',
      );
      return;
    }
    if (key === 'queryFn') {
      this.report(
        walk.write,
        property,
        'a query retries it, one toast per attempt, and surfaces its error',
      );
      return;
    }
    const hook = this.returningHook(object);
    if (hook === undefined) return;
    const members = this.derived.get(hook) ?? new Map();
    const origins = members.get(key) ?? new Map<string, Origin>();
    const originKey = `${walk.write.origin.file}#${walk.write.origin.name}`;
    if (!origins.has(originKey)) {
      origins.set(originKey, walk.write.origin);
      members.set(key, origins);
      this.derived.set(hook, members);
      this.changed = true;
    }
  }

  private isEditorController(object: ts.ObjectLiteralExpression): boolean {
    const call = outer(object).parent;
    if (ts.isCallExpression(call) && EDITOR_HOOKS.has(calleeName(call) ?? '')) {
      return true;
    }
    const keys = new Set(object.properties.map(propertyName));
    return keys.has('save') && keys.has('isDirty') && keys.has('reset');
  }

  /** The top-level `use…` hook an object literal is returned from. */
  private returningHook(object: ts.Expression): FunctionNode | undefined {
    const hookOf = (fn: FunctionNode | undefined) =>
      fn !== undefined && isHookName(topLevelName(fn)) ? fn : undefined;
    let node: ts.Node = outer(object);
    for (;;) {
      const parent = node.parent;
      if (ts.isReturnStatement(parent)) {
        return hookOf(enclosingFunction(parent));
      }
      if (ts.isArrowFunction(parent) && parent.body === node) {
        const call = outer(parent).parent;
        if (!isCallTo(call, 'useMemo')) return hookOf(parent);
        node = outer(call);
        continue;
      }
      if (
        ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        ts.isIdentifier(parent.name)
      ) {
        for (const reference of this.references(parent)) {
          const statement = outer(reference).parent;
          if (ts.isReturnStatement(statement)) {
            return hookOf(enclosingFunction(statement));
          }
        }
      }
      return undefined;
    }
  }

  private attribute(attribute: ts.JsxAttribute, walk: Walk): void {
    const tag = attribute.parent.parent.tagName.getText();
    const name = nameText(attribute.name);
    if (name !== undefined && SURFACES.get(tag)?.includes(name)) {
      this.report(walk.write, attribute, `${tag} toasts the rejected ${name}`);
    }
  }

  /** Follow the promise `start` evaluates to, which rejects with the
   * failure, up to whatever handles it. */
  private follow(start: ts.Expression, walk: Walk): void {
    if (walk.seen.has(start)) return;
    walk.seen.add(start);
    let node: ts.Node = start;
    // Whether an `await` has thrown the rejection into the code around it.
    let thrown = false;
    for (;;) {
      const parent = node.parent;
      if (parent === undefined || ts.isSourceFile(parent)) return;
      if (ts.isAwaitExpression(parent)) {
        thrown = true;
      } else if (flowsThrough(parent, node)) {
        // The promise is the value of the expression around it.
      } else if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      ) {
        const chained = parent.parent;
        const method = parent.name.text;
        const rejected =
          method === 'catch'
            ? chained.arguments[0]
            : method === 'then'
              ? chained.arguments[1]
              : undefined;
        if (rejected !== undefined) {
          const handler = this.handlerFunction(rejected);
          if (handler?.body === undefined) return;
          if (this.toastingCall(handler.body, true) !== undefined) {
            this.report(walk.write, parent.name, `its .${method} toasts`);
            return;
          }
          if (!rethrows(handler.body)) return;
        } else if (method !== 'then' && method !== 'finally') {
          return;
        }
        node = chained;
        continue;
      } else if (ts.isCallExpression(parent)) {
        const name = parent.expression.getText();
        if (!['Promise.all', 'Promise.race', 'Promise.any'].includes(name)) {
          if (name === 'Promise.allSettled') this.settledBatch(parent, walk);
          return;
        }
      } else if (ts.isReturnStatement(parent)) {
        const fn = enclosingFunction(parent);
        if (fn !== undefined) this.exitFunction(fn, walk);
        return;
      } else if (isFunctionNode(parent) && parent.body === node) {
        this.exitFunction(parent, walk);
        return;
      } else if (ts.isTryStatement(parent)) {
        if (node === parent.tryBlock && parent.catchClause !== undefined) {
          if (!this.caught(parent, parent.catchClause, walk)) return;
        }
      } else if (!thrown) {
        if (isAssignment(parent) && parent.right === node) {
          this.stored(parent, walk);
          return;
        }
        if (
          ts.isExpressionStatement(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isVoidExpression(parent)
        ) {
          // A promise nobody awaits: its rejection reaches no `try`.
          return;
        }
      }
      node = parent;
    }
  }

  /** A catch the rejection lands in: report a toast, and whether the
   * failure travels on (a rethrow). */
  private caught(
    statement: ts.TryStatement,
    clause: ts.CatchClause,
    walk: Walk,
  ): boolean {
    const toast = this.toastingCall(clause.block, true);
    if (toast !== undefined) {
      this.report(walk.write, toast, 'its catch toasts');
      return false;
    }
    if (rethrows(clause.block)) return true;
    const summary = this.summaryToast(statement, recordedNames(clause.block));
    if (summary !== undefined) {
      this.report(walk.write, summary, 'a batch summary toast reports it');
    }
    return false;
  }

  /** `Promise.allSettled(…)` keeps the rejection; a toast that reads the
   * results reports it. */
  private settledBatch(call: ts.CallExpression, walk: Walk): void {
    let node: ts.Node = call;
    while (isWrapper(node.parent) || ts.isAwaitExpression(node.parent)) {
      node = node.parent;
    }
    const declaration = node.parent;
    if (!ts.isVariableDeclaration(declaration)) return;
    const summary = this.summaryToast(
      declaration,
      new Set(boundNames(declaration.name)),
    );
    if (summary !== undefined) {
      this.report(walk.write, summary, 'a batch summary toast reports it');
    }
  }

  /** A promise kept in `target` for later: `ref.current ??= (async () =>
   * …)()` in a function that returns `ref.current`. */
  private stored(assignment: ts.BinaryExpression, walk: Walk): void {
    const fn = enclosingFunction(assignment);
    if (fn === undefined) return;
    const target = assignment.left.getText();
    if (
      returnedExpressions(fn).some((returned) => returned.getText() === target)
    ) {
      this.exitFunction(fn, walk);
    }
  }

  private report(write: Write, at: ts.Node, via: string): void {
    this.found.push({
      origin: write.origin,
      file: at.getSourceFile().fileName,
      line: lineOf(at),
      via:
        write.through === undefined ? via : `${via} (through ${write.through})`,
    });
  }
}

function isWriteHookCall(call: ts.CallExpression): boolean {
  const callee = unwrap(call.expression);
  return ts.isIdentifier(callee) && WRITE_HOOKS.has(callee.text);
}

/** Whether the value of `parent` is the promise `node` evaluates to. */
function flowsThrough(parent: ts.Node, node: ts.Node): boolean {
  if (
    isWrapper(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isSpreadElement(parent)
  ) {
    return true;
  }
  if (ts.isConditionalExpression(parent)) return parent.condition !== node;
  return (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.CommaToken,
    ].includes(parent.operatorToken.kind)
  );
}

function keyOf(violation: Violation): string {
  return `${violation.origin.file}#${violation.origin.name}`;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(PLATFORM_ROOT, dir), {
    withFileTypes: true,
  })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(relative));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.includes('.test.')
    ) {
      out.push(relative);
    }
  }
  return out;
}

function readPlatformFile(file: string): string | undefined {
  try {
    return readFileSync(path.join(PLATFORM_ROOT, file), 'utf8');
  } catch (error) {
    // A module the resolver guesses at (`x.tsx` beside `x.ts`) may not
    // exist; any other failure is real.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

let scanned: Violation[] | undefined;

function scan(): Violation[] {
  scanned ??= new Scan(readPlatformFile, sourceFiles('app')).run();
  return scanned;
}

/** Scan in-memory files, keyed by platform-relative path. */
function scanFiles(files: Record<string, string>): string[] {
  return new Scan((file) => files[file], Object.keys(files))
    .run()
    .map(
      (violation) =>
        `${violation.file}:${violation.line} ${violation.origin.name}: ${violation.via}`,
    );
}

interface Allowance {
  /** The write, as `<file>#<name>` of the origin a report names. */
  write: string;
  /** The file that reports the failure again. */
  file: string;
  /** How many reports of that pair the file holds; one unless it says more. */
  count?: number;
  reason: string;
}

/**
 * Pairs that raise two toasts on purpose, each with the reason. An entry
 * exempts exactly the reports it counts: a file holding another report of
 * the same pair fails with every one listed, and one holding fewer marks the
 * entry stale.
 */
const ALLOWED: readonly Allowance[] = [
  'useBulkArchiveConversations',
  'useBulkCloseConversations',
  'useBulkReopenConversations',
  'useBulkSpamConversations',
  'useBulkUnarchiveConversations',
].map((hook) => ({
  write: `app/features/conversations/hooks/mutations.ts#${hook}`,
  file: 'app/features/conversations/hooks/use-bulk-actions.ts',
  reason:
    '#3784 (open) passes `errorToast: false` to the five bulk verbs and ' +
    'rewrites both files, so their fix is its. Delete these entries when ' +
    'it lands: this suite reports them stale.',
}));

function sitesOf(entry: Allowance, found: readonly Violation[]): Violation[] {
  return found.filter(
    (violation) =>
      keyOf(violation) === entry.write && violation.file === entry.file,
  );
}

function unexempted(
  found: readonly Violation[],
  allowances: readonly Allowance[] = ALLOWED,
): Violation[] {
  const exempt = new Set<Violation>();
  for (const entry of allowances) {
    const sites = sitesOf(entry, found);
    if (sites.length === (entry.count ?? 1)) {
      for (const site of sites) exempt.add(site);
    }
  }
  return found.filter((violation) => !exempt.has(violation));
}

/** The hooks every sample imports. */
const HOOKS = `
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
export function useLoud() { return useBackendMutation('x:loud'); }
export function useCustom() {
  return useBackendMutation('x:custom', { errorToast: { title: 'Nope' } });
}
export function useQuiet() {
  return useBackendMutation('x:quiet', { errorToast: false });
}
export function useForwarding(options?: { errorToast?: false }) {
  return useBackendMutation('x:forwarding', options);
}
export function useLoudAsync() {
  return useBackendMutation('x:picked').mutateAsync;
}
`;

function sample(body: string): Record<string, string> {
  return {
    'app/hooks.ts': HOOKS,
    'app/caller.tsx': `
import { toast } from '@tale/ui/use-toast';
import { useCustom, useForwarding, useLoud, useLoudAsync, useQuiet } from './hooks';
${body}`,
  };
}

describe('single failure toast guard', () => {
  it('reports one failure with one toast', () => {
    expect(
      unexempted(scan()).map(
        ({ origin, file, line, via }) =>
          `${file}:${line}: ${via}, and ${origin.name} (${origin.file}:${origin.line}) toasts too`,
      ),
      'pass errorToast: false where the caller reports the failure, or leave the reporting to the write',
    ).toEqual([]);
  });

  it('keeps no stale allowlist entry', () => {
    const found = scan();
    expect(
      ALLOWED.filter(
        (entry) => sitesOf(entry, found).length < (entry.count ?? 1),
      ),
    ).toEqual([]);
  });

  // An entry exempts the pair's reports it counts, never a further one.
  it('exempts only as many reports as the entry counts', () => {
    const origin = { file: 'app/hooks.ts', line: 3, name: 'useLoud' };
    const found = [1, 2].map((line) => ({
      origin,
      file: 'app/caller.tsx',
      line,
      via: 'its catch toasts',
    }));
    const allowance = {
      write: 'app/hooks.ts#useLoud',
      file: 'app/caller.tsx',
      reason: 'a sample',
    };
    expect(unexempted(found, [allowance])).toHaveLength(2);
    expect(unexempted(found, [{ ...allowance, count: 2 }])).toEqual([]);
  });

  // The walk is a model of how a rejection travels: hold it to a sample of
  // each shape it must catch, and to the shapes that report once.
  it.each([
    [
      'a catch that toasts',
      `function A() {
        const { mutateAsync } = useLoud();
        const go = async () => {
          try { await mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
        return <button onClick={() => void go()} />;
      }`,
    ],
    [
      'a custom errorToast beside a catch that toasts',
      `function A() {
        const m = useCustom();
        const go = async () => {
          try { await m.mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a forwarding hook called without options',
      `function A() {
        const { mutateAsync } = useForwarding();
        const go = async () => {
          try { await mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a helper that toasts, called from the catch',
      `function A() {
        const { mutateAsync } = useLoud();
        const failToast = (error: unknown) => toast({ title: String(error) });
        const go = async () => {
          try { await mutateAsync({}); } catch (error) { failToast(error); }
        };
      }`,
    ],
    [
      'a .catch that toasts',
      `function A() {
        const { mutateAsync } = useLoud();
        const onError = () => { toast({ title: 'x' }); };
        const go = () => mutateAsync({}).then(() => {}).catch(onError);
      }`,
    ],
    [
      "mutate's call-site onError that toasts",
      `function A() {
        const { mutate } = useLoud();
        const go = () => mutate({}, { onError: () => toast({ title: 'x' }) });
      }`,
    ],
    [
      "the write's own onError that toasts",
      `import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
      export function useNoisy() {
        return useBackendMutation('x:noisy', { onError: () => toast({ title: 'x' }) });
      }`,
    ],
    [
      'a rethrowing catch under a catch that toasts',
      `function A() {
        const { mutateAsync } = useLoud();
        const inner = async () => {
          try { return await mutateAsync({}); } catch (error) { console.error(error); throw error; }
        };
        const go = async () => {
          try { await inner(); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a local runner whose catch toasts',
      `function A() {
        const { mutateAsync } = useLoud();
        const run = async (fn: () => Promise<unknown>) => {
          try { await fn(); } catch { toast({ title: 'x' }); }
        };
        const go = () => run(() => mutateAsync({}));
      }`,
    ],
    [
      'a picked mutateAsync',
      `function A() {
        const create = useLoudAsync();
        const go = async () => {
          try { await create({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a summary toast over the failures a loop recorded',
      `function A() {
        const { mutateAsync } = useLoud();
        const go = async (ids: string[]) => {
          const failed: string[] = [];
          for (const id of ids) {
            try { await mutateAsync({ id }); } catch { failed.push(id); }
          }
          if (failed.length > 0) toast({ title: failed.join(', ') });
        };
      }`,
    ],
    [
      'a summary toast over Promise.allSettled',
      `function A() {
        const { mutateAsync } = useLoud();
        const go = async (ids: string[]) => {
          const results = await Promise.allSettled(ids.map((id) => mutateAsync({ id })));
          const failedCount = results.filter((r) => r.status === 'rejected').length;
          toast({ title: String(failedCount) });
        };
      }`,
    ],
    [
      'a BulkDeleteBar callback',
      `function A() {
        const { mutateAsync } = useLoud();
        const onDeleteItem = useCallback(async (id: string) => { await mutateAsync({ id }); }, []);
        return <BulkDeleteBar onDeleteItem={onDeleteItem} />;
      }`,
    ],
    [
      'an EntityDeleteDialog callback',
      `function A() {
        const { mutateAsync } = useLoud();
        return <EntityDeleteDialog deleteMutation={async (e) => { await mutateAsync(e); }} />;
      }`,
    ],
    [
      'an editor save',
      `function A() {
        const { mutateAsync } = useLoud();
        const save = async (values: object) => { await mutateAsync(values); };
        const editor = useFormEditor({ data: {}, save });
      }`,
    ],
    [
      'a query function',
      `function A() {
        const { mutateAsync } = useLoud();
        return useQuery({ queryKey: ['x'], queryFn: () => mutateAsync({}), retry: 2 });
      }`,
    ],
    [
      "a factory's errorToast spread after a forwarded opt-out",
      `import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
      function useFeedback() { return { errorToast: { title: 'Nope' } }; }
      function useSpreading(options?: { errorToast?: false }) {
        return useBackendMutation('x:spreading', { ...options, ...useFeedback() });
      }
      function A() {
        const { mutateAsync } = useSpreading({ errorToast: false });
        const go = async () => {
          try { await mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
  ])('catches %s', (_shape, body) => {
    expect(scanFiles(sample(body))).not.toEqual([]);
  });

  it('catches a hook whose returned function rethrows, at its caller', () => {
    const files: Record<string, string> = {
      ...sample(`function A() {
        const editor = useSettings();
        const go = async () => {
          try { await editor.save(); } catch { toast({ title: 'x' }); }
        };
      }`),
      'app/settings.ts': `
import { useLoud } from './hooks';
export function useSettings() {
  const write = useLoud();
  const save = async () => { await write.mutateAsync({}); };
  return { save };
}`,
    };
    files['app/caller.tsx'] = files['app/caller.tsx'].replace(
      "from './hooks';",
      "from './hooks';\nimport { useSettings } from './settings';",
    );
    expect(scanFiles(files)).toEqual([
      'app/caller.tsx:8 useLoud: its catch toasts (through useSettings)',
    ]);
  });

  it.each([
    [
      'a quiet write whose caller toasts',
      `function A() {
        const { mutateAsync } = useQuiet();
        const go = async () => {
          try { await mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a write told to stay quiet through a named false',
      `import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
      const REPORTED_BY_CALLER = false;
      function A() {
        const { mutateAsync } = useBackendMutation('x:named', { errorToast: REPORTED_BY_CALLER });
        const go = async () => {
          try { await mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a forwarding hook told to stay quiet',
      `function A() {
        const quiet = { errorToast: false } as const;
        const { mutateAsync } = useForwarding(quiet);
        const go = async () => {
          try { await mutateAsync({}); } catch { toast({ title: 'x' }); }
        };
      }`,
    ],
    [
      'a caller that leaves the reporting to the write',
      `function A() {
        const { mutateAsync } = useLoud();
        const go = async () => {
          try { await mutateAsync({}); } catch (error) { console.error(error); }
        };
      }`,
    ],
    [
      'a promise nobody awaits',
      `function A() {
        const { mutateAsync } = useLoud();
        const go = () => { try { void mutateAsync({}); } catch { toast({ title: 'x' }); } };
      }`,
    ],
    [
      'mutate without a call-site onError',
      `function A() {
        const { mutate } = useLoud();
        const go = () => mutate({}, { onSuccess: () => toast({ title: 'saved' }) });
      }`,
    ],
    [
      'a catch that shows the failure inline',
      `function A() {
        const [error, setError] = useState<unknown>(null);
        const { mutateAsync } = useLoud();
        const go = async () => {
          try { await mutateAsync({}); toast({ title: 'saved' }); } catch (e) { setError(e); }
        };
      }`,
    ],
    [
      'settled results that no toast reads',
      `function A() {
        const { mutateAsync } = useLoud();
        const go = async (ids: string[]) => {
          const results = await Promise.allSettled(ids.map((id) => mutateAsync({ id })));
          for (const r of results) if (r.status === 'rejected') console.warn(r.reason);
          toast({ title: 'done' });
        };
      }`,
    ],
    [
      'a surface that does not toast',
      `function A() {
        const { mutateAsync } = useLoud();
        return <ConfirmDialog onConfirm={async () => { await mutateAsync({}); }} />;
      }`,
    ],
  ])('allows %s', (_shape, body) => {
    expect(scanFiles(sample(body))).toEqual([]);
  });
});
