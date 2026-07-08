/**
 * Drift guard for the sandbox workspace-tool bridge subset.
 *
 * EXTERNAL_AGENT_TOOL_NAMES (lib/shared/schemas/agents.ts) is what the agent
 * config schema ACCEPTS in an external agent's `toolNames`; a ToolDefinition's
 * `sandboxBridge: true` is what /api/tools/execute EXECUTES. The two live in
 * different layers (the shared schema cannot import the convex registry) and
 * refine rules are invisible to the config-snapshot fingerprint, so this test
 * is the only guard.
 *
 * The dangerous drift direction is a name the schema accepts whose definition
 * is NOT marked — a schema-legal grant the dispatch then denies at runtime.
 * The test pins that direction by importing exactly the named definitions,
 * NOT the whole TOOL_REGISTRY: reading two static fields does not justify the
 * registry's full transitive import graph (which is heavy enough to wedge a
 * small CI/dev machine).
 *
 * The opposite direction — marking a FIFTH tool without listing it in
 * EXTERNAL_AGENT_TOOL_NAMES — is inert by construction: the schema rejects
 * the name in `toolNames`, so no session token can ever carry the grant and
 * the dispatch's `toolGrants.includes(tool)` gate never passes. The static
 * name→definition map below still forces an edit here whenever the shared
 * list grows — which is exactly when the new definition's marking gets
 * asserted.
 */

import { describe, expect, it, vi } from 'vitest';

// The definition modules pull the convex codegen + agent SDK surface at
// import time; stub both so reading two static fields stays a pure data
// exercise (the modules reference `internal.*` lazily inside handlers).
vi.mock('../_generated/api', () => {
  // `then` must resolve to undefined: anything awaited along the mock path
  // (vitest awaits factory results; app code may await lazy lookups) would
  // otherwise see a thenable whose `then` never settles and hang forever.
  const proxy: unknown = new Proxy(function () {}, {
    get: (_target, key) => (key === 'then' ? undefined : proxy),
    apply: () => proxy,
  });
  return { internal: proxy, api: proxy, components: proxy };
});

vi.mock('../_generated/server', () => {
  const passthrough = (config: unknown) => config;
  return {
    internalAction: passthrough,
    internalMutation: passthrough,
    internalQuery: passthrough,
    action: passthrough,
    mutation: passthrough,
    query: passthrough,
    httpAction: passthrough,
  };
});

// A plain object, never a Proxy: vitest AWAITS the factory result, and a
// get-anything Proxy answers `then` with a function — a thenable that never
// settles, wedging collection at 0% CPU. The named tool modules only use
// `createTool` (plus type-only imports, erased at runtime); a missing export
// fails loudly, which is the failure mode we want.
vi.mock('@convex-dev/agent', () => ({
  createTool: (def: unknown) => def,
}));

import { EXTERNAL_AGENT_TOOL_NAMES } from '../../lib/shared/schemas/agents';
import { documentFindTool } from './documents/document_find_tool';
import { documentRetrieveTool } from './documents/document_retrieve_tool';
import { documentWriteTool } from './documents/document_write_tool';
import { ragSearchTool } from './rag/rag_search_tool';
import { TOOL_NAMES } from './tool_names';
import type { ToolDefinition } from './types';

// Record keyed by the shared union: adding a name to
// EXTERNAL_AGENT_TOOL_NAMES without extending this map is a compile error.
const DEFINITIONS_BY_NAME: Record<
  (typeof EXTERNAL_AGENT_TOOL_NAMES)[number],
  ToolDefinition
> = {
  rag_search: ragSearchTool,
  document_find: documentFindTool,
  document_retrieve: documentRetrieveTool,
  document_write: documentWriteTool,
};

describe('sandbox workspace-tool bridge subset', () => {
  it('every schema-accepted workspace tool is a marked registry tool', () => {
    for (const name of EXTERNAL_AGENT_TOOL_NAMES) {
      const def = DEFINITIONS_BY_NAME[name];
      expect(def.name).toBe(name);
      expect(def.sandboxBridge).toBe(true);
      expect(TOOL_NAMES).toContain(name);
    }
  });
});
