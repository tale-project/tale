import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The EXHAUSTIVENESS walk behind every ctx-shim gate.
 *
 * A shim map (`ShimHandlers`) fails LOUD on a name it has no handler for — at
 * the call, in production. Each half of a dispatch surface is easy to cover in
 * isolation (the handlers exist; the route is tested with a different
 * session), and nothing then asserts that the map answers everything the
 * reused 0.4 code can actually reach. That is how `ask_human` and the whole
 * task/document write family shipped broken on the sandbox surface, and how
 * three chat search legs shipped as empty stubs.
 *
 * So a gate walks its entry points' own import graph, collects every
 * `internal.a.b.c` reference the reachable modules make, and requires a
 * handler for each. A module that grows a new ctx dependency fails in the
 * suite instead of at an operator's first tool call.
 *
 * This lives here, imported by each `shim.test.ts`, so the surfaces share ONE
 * walk. A second copy is how one gate ends up subtly weaker than the other —
 * and a weaker gate is indistinguishable from a passing one.
 *
 * Test-only: it reads the source tree with `node:fs` and nothing in the
 * shipping path imports it.
 */

const BACKEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The two modules that DEFINE the reference vocabulary rather than call it —
 * their doc comments name example refs (`internal.a.b.c`) that no code
 * dispatches. */
const VOCABULARY_MODULES = [
  'core/lib/handler_names.ts',
  '../lib/shared/handlers/function-refs.ts',
];

/**
 * Modules whose `internal.*` references this map never has to answer — the
 * vocabulary definitions above, plus whatever a caller adds.
 *
 * A caller adds one only for a 0.4 module the 0.5 host REPLACES wholesale (a
 * `deps` override), never for one it merely does not exercise yet. Every
 * exclusion needs its own assertion that the replacement is still wired,
 * because an exclusion is a hole in the gate.
 */
function excluded(extra: readonly string[]): Set<string> {
  return new Set(
    [...VOCABULARY_MODULES, ...extra].map((entry) =>
      path.resolve(BACKEND, entry),
    ),
  );
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Where a dispatch begins, and which reachable modules do not count. */
export interface ReachabilityScope {
  /** Backend-relative paths the reused code is entered through. */
  readonly entryPoints: readonly string[];
  /** Backend-relative paths whose `internal.*` names this map never answers
   *  (see {@link excluded}). */
  readonly replacedModules?: readonly string[];
}

/**
 * Every `internal.a.b.c` the entry points can reach, as shim names
 * (`a/b:c`), mapped to the backend-relative modules that name them.
 */
export function reachableHandlerNames(
  scope: ReachabilityScope,
): Map<string, Set<string>> {
  const skip = excluded(scope.replacedModules ?? []);
  const names = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const queue = scope.entryPoints.map((entry) => path.join(BACKEND, entry));
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    if (!skip.has(file)) {
      for (const match of source.matchAll(
        /internal\.([a-zA-Z_]+)\.([a-zA-Z_]+)\.([a-zA-Z_]+)/g,
      )) {
        const name = `${match[1]}/${match[2]}:${match[3]}`;
        const callers = names.get(name) ?? new Set<string>();
        callers.add(path.relative(BACKEND, file));
        names.set(name, callers);
      }
    }
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const target = resolveImport(file, match[1] ?? '');
      if (target !== null && !target.includes('.test.')) queue.push(target);
    }
  }
  return names;
}

/**
 * The names a shim map does NOT answer, each labelled with the modules that
 * reach it — the assertion's whole message, so a red gate names the handler
 * to write and where it is called from.
 */
export function unansweredHandlerNames(
  handlers: Record<string, unknown>,
  scope: ReachabilityScope,
): string[] {
  return [...reachableHandlerNames(scope)]
    .filter(([name]) => handlers[name] === undefined)
    .map(
      ([name, callers]) => `${name} (called from ${[...callers].join(', ')})`,
    );
}
