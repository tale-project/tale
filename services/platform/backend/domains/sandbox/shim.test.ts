import { describe, expect, it } from 'vitest';

import {
  reachableHandlerNames,
  unansweredHandlerNames,
} from '../../lib/ctx-shim-reachability.ts';
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
 * The walk itself lives in `lib/ctx-shim-reachability.ts` — shared with the
 * chat map's gate, so both surfaces are held to one standard.
 */

/** Where a dispatch begins: the bridge and the domain handlers it delegates
 * to. Everything they hand this ctx to is reached transitively. */
const TOOL_DISPATCH = {
  entryPoints: [
    'core/node_only/sandbox/workspace_tools_bridge.ts',
    'core/node_only/sandbox/workspace_domain_tools.ts',
  ],
};

const TURN_EQUIPMENT = {
  entryPoints: ['core/node_only/sandbox/turn_equipment.ts'],
};

describe('sandboxToolShimHandlers', () => {
  // The factories only close over `sql`; no handler runs until it is called,
  // so a stand-in is enough to enumerate the map.
  const handlers = sandboxToolShimHandlers({} as never);

  it('answers every internal function the tool dispatch can reach', () => {
    expect(unansweredHandlerNames(handlers, TOOL_DISPATCH)).toEqual([]);
  });

  it('reaches the write and ask lanes, not just the read doors', () => {
    // A guard on the guard: if the walk ever stops finding the bridge's
    // imports, the assertion above would pass vacuously.
    const reachable = reachableHandlerNames(TOOL_DISPATCH);
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
    expect(unansweredHandlerNames(handlers, TURN_EQUIPMENT)).toEqual([]);
  });

  it('reaches the broker seams, not just the secrets lane', () => {
    // A guard on the guard, as above.
    const reachable = reachableHandlerNames(TURN_EQUIPMENT);
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
