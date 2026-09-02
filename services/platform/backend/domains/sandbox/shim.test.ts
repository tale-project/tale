import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { agentTurnShimHandlers } from '../tasks/agent-turn-shim.ts';
import { sandboxToolShimHandlers } from './shim.ts';

/**
 * The EXHAUSTIVENESS gate for the in-container tool dispatch.
 *
 * `POST /api/tools/execute` runs the reused bridge on a ctx shim built from
 * `sandboxToolShimHandlers` alone, and the shim fails LOUD on a name it has
 * no handler for — at the call, in production. That is exactly how
 * `ask_human` and the whole task/document write family shipped broken: each
 * half was covered (the handlers existed; the route was tested with a
 * different session), but nothing asserted that the map answers everything
 * the bridge can actually reach.
 *
 * So this test walks the bridge's own import graph, collects every
 * `internal.a.b.c` reference the reachable modules make, and requires a
 * handler for each. A module that grows a new ctx dependency fails here
 * instead of at an operator's first tool call.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '../..');

/** Where a dispatch begins: the bridge and the domain handlers it delegates
 * to. Everything they hand this ctx to is reached transitively. */
const ENTRY_POINTS = [
  'core/node_only/sandbox/workspace_tools_bridge.ts',
  'core/node_only/sandbox/workspace_domain_tools.ts',
];

/** The two modules that DEFINE the reference vocabulary rather than call it —
 * their doc comments name example refs (`internal.a.b.c`) that no code
 * dispatches. */
const VOCABULARY_MODULES = new Set([
  path.join(BACKEND, 'core/lib/handler_names.ts'),
  path.resolve(BACKEND, '../lib/shared/handlers/function-refs.ts'),
]);

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every `internal.a.b.c` the entry points can reach, as shim names
 * (`a/b:c`), mapped to the modules that name them. */
function reachableHandlerNames(
  entryPoints: readonly string[] = ENTRY_POINTS,
): Map<string, Set<string>> {
  const names = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const queue = entryPoints.map((entry) => path.join(BACKEND, entry));
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    if (!VOCABULARY_MODULES.has(file)) {
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

describe('sandboxToolShimHandlers', () => {
  // The factories only close over `sql`; no handler runs until it is called,
  // so a stand-in is enough to enumerate the map.
  const handlers = sandboxToolShimHandlers({} as never);

  it('answers every internal function the tool dispatch can reach', () => {
    const missing = [...reachableHandlerNames()]
      .filter(([name]) => handlers[name] === undefined)
      .map(
        ([name, callers]) => `${name} (called from ${[...callers].join(', ')})`,
      );
    expect(missing).toEqual([]);
  });

  it('reaches the write and ask lanes, not just the read doors', () => {
    // A guard on the guard: if the walk ever stops finding the bridge's
    // imports, the assertion above would pass vacuously.
    const reachable = reachableHandlerNames();
    expect([...reachable.keys()]).toEqual(
      expect.arrayContaining([
        'automations/human_asks:createAskForExec',
        'tasks/internal_mutations:agentCreateTask',
        'tasks/internal_queries:listTasksForAgent',
        'documents/internal_actions:storeRawContent',
        'file_metadata/internal_mutations:linkDocumentToFile',
      ]),
    );
  });
});

describe('agentTurnShimHandlers', () => {
  // The SECOND dispatch surface the maps must answer: both work-lane hosts
  // (task `agent_run_host`, automation `agent_host`) resolve a turn's
  // equipment env — agent secrets plus the Tier-2 connector broker — on the
  // ctx shim built from this map. The resolvers swallow a broker failure
  // into a console.warn by design (a credential gap downgrades a turn, never
  // kills it), which is exactly how an un-shimmed name here ships as "the
  // agent says it has no github credentials" instead of an error.
  const handlers = agentTurnShimHandlers({} as never);

  it('answers every internal function the turn-equipment resolvers reach', () => {
    const missing = [
      ...reachableHandlerNames(['core/node_only/sandbox/turn_equipment.ts']),
    ]
      .filter(([name]) => handlers[name] === undefined)
      .map(
        ([name, callers]) => `${name} (called from ${[...callers].join(', ')})`,
      );
    expect(missing).toEqual([]);
  });

  it('reaches the broker seams, not just the secrets lane', () => {
    // A guard on the guard, as above.
    const reachable = reachableHandlerNames([
      'core/node_only/sandbox/turn_equipment.ts',
    ]);
    expect([...reachable.keys()]).toEqual(
      expect.arrayContaining([
        'agent_secrets/actions:resolveAgentSecretsEnv',
        'connector_credentials/queries:resolveCredentialRefInternal',
        'sandbox/session_mutations:recordCredentialAccess',
        'sandbox/session_queries:getSessionOwnerIdentity',
      ]),
    );
  });
});
