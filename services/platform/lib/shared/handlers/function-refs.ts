/**
 * The function-reference format, owned here instead of borrowed.
 *
 * A reused 0.4 body addresses another handler as `internal.a.b.c`. That
 * expression carries no code and no import — only a NAME — and the 0.5 ctx
 * shim (`backend/lib/convex-shim.ts`) dispatches that name to a SQL-backed
 * handler. So the whole contract is: how a dotted path becomes a string, and
 * how a reference gives that string back.
 *
 * Both halves live here. The shape is the one the retired runtime used, and
 * KEPT deliberately — the shim's handler tables are keyed by these exact
 * strings, and the `Symbol.for` keys are global, so a reference built by
 * either side still reads correctly if some corner of the tree ever imports
 * the package again.
 *
 *     internal.tasks.helpers.recordActivity  →  'tasks/helpers:recordActivity'
 *     internal.audit_logs.emit.default       →  'audit_logs/emit'
 *     components.betterAuth.adapter.findOne  →  '_reference/childComponent/betterAuth/adapter/findOne'
 *
 * A path shorter than two segments is a mistake, not a name: `internal.foo`
 * names no export, and throwing at the point of use beats dispatching to a
 * key that cannot exist.
 */

/**
 * A reference to a handler. Opaque BY DESIGN: its only content is the name it
 * resolves to, and every node of the tree is both a reference and a container
 * (a module path and an export can share a segment), so the type says nothing
 * about arguments or return — the shim has one handler table and dispatches on
 * the name alone.
 */
export type FunctionRef = {
  readonly [FUNCTION_NAME]: string;
} & Record<string, unknown>;

/** Where a reference stores its name. Global, matching the retired runtime. */
export const FUNCTION_NAME = Symbol.for('functionName');

/** Where a COMPONENT reference stores its path (components have no name). */
export const REFERENCE_PATH = Symbol.for('toReferencePath');

/** `['a','b','c']` → `'a/b:c'`; a `default` export is just its path. */
function joinFunctionName(parts: readonly string[]): string {
  if (parts.length < 2) {
    throw new Error(
      `A function reference is \`api.module.export\` or deeper; found \`${['api', ...parts].join('.')}\`.`,
    );
  }
  const modulePath = parts.slice(0, -1).join('/');
  const exportName = parts[parts.length - 1];
  return exportName === 'default' ? modulePath : `${modulePath}:${exportName}`;
}

function functionRefProxy(parts: readonly string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'string') return functionRefProxy([...parts, prop]);
        if (prop === FUNCTION_NAME) return joinFunctionName(parts);
        if (prop === Symbol.toStringTag) return 'FunctionReference';
        return undefined;
      },
    },
  );
}

function componentRefProxy(parts: readonly string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'string')
          return componentRefProxy([...parts, prop]);
        if (prop === REFERENCE_PATH) {
          if (parts.length < 1) {
            throw new Error(
              'A component reference is `components.child.export` or deeper.',
            );
          }
          return `_reference/childComponent/${parts.join('/')}`;
        }
        return undefined;
      },
    },
  );
}

/**
 * Build the root of a reference tree, shaped by the caller's vocabulary.
 *
 * The proxy answers EVERY property, so it inhabits any shape a vocabulary
 * declares — the assertion is not a claim about this value, it is how a
 * hand-maintained list of names gets attached to the walk that produces them.
 */
export function createFunctionRefs<TNames>(): TNames {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above: the proxy answers every path by construction
  return functionRefProxy([]) as TNames;
}

/**
 * A reference tree with NO vocabulary: every path resolves, and the name is
 * only checked when something asks for it. The WebDAV protocol layer uses
 * this — it addresses handlers the door registers, not a fixed list, so a
 * vocabulary there would be a second copy of the door's own handler map.
 */
export interface AnyRefs {
  readonly [segment: string]: AnyRefs;
}

/** The untyped tree. See {@link AnyRefs}. */
export const anyRefs: AnyRefs = createFunctionRefs<AnyRefs>();

/** Build the root of a component reference tree. See {@link createFunctionRefs}. */
export function createComponentRefs<TNames>(): TNames {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see createFunctionRefs
  return componentRefProxy([]) as TNames;
}

/**
 * Name a reference: `path/module:export` for a function, the raw
 * `_reference/childComponent/…` path for a component. A bare string is
 * already a name and passes through, which is what lets a handler table be
 * exercised without building a reference at all.
 */
export function functionRefName(ref: unknown): string {
  if (typeof ref === 'string') return ref;
  if (ref !== null && typeof ref === 'object') {
    const name: unknown = Reflect.get(ref, FUNCTION_NAME);
    if (typeof name === 'string') return name;
    const reference: unknown = Reflect.get(ref, REFERENCE_PATH);
    if (typeof reference === 'string') return reference;
  }
  throw new Error(`Not a function reference: ${String(ref)}`);
}
