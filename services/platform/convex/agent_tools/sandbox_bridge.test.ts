/**
 * Drift guard for the sandbox workspace-tool bridge subset.
 *
 * EXTERNAL_AGENT_TOOL_NAMES (lib/shared/schemas/agents.ts) is what the agent
 * config schema ACCEPTS in an external agent's `toolNames`;
 * `sandboxBridge: true` on a ToolDefinition is what the dispatch endpoint
 * EXECUTES. The two lists live in different layers (the shared schema cannot
 * import the convex registry), so this test is the only guard keeping them
 * identical — the config-snapshot fingerprint cannot see refine rules.
 */

import { describe, expect, it, vi } from 'vitest';

// The registry imports every tool module; stub the convex codegen + agent SDK
// surface so importing it stays a pure data exercise (tool modules reference
// `internal.*` / `components.*` lazily inside their handlers).
vi.mock('../_generated/api', () => {
  const proxy: unknown = new Proxy(function () {}, {
    get: () => proxy,
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

vi.mock('@convex-dev/agent', () => {
  const stub: unknown = new Proxy(function () {}, {
    get: () => stub,
    apply: () => stub,
  });
  return new Proxy(
    { createTool: (def: unknown) => def },
    {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : stub,
    },
  );
});

import { EXTERNAL_AGENT_TOOL_NAMES } from '../../lib/shared/schemas/agents';
import { TOOL_REGISTRY } from './tool_registry';
import type { ToolDefinition } from './types';

describe('sandbox workspace-tool bridge subset', () => {
  it('sandboxBridge markings match EXTERNAL_AGENT_TOOL_NAMES exactly', () => {
    // Widen the `as const` registry so entries without the optional marking
    // still typecheck for the property read.
    const defs: readonly ToolDefinition[] = TOOL_REGISTRY;
    const marked = defs
      .filter((def) => def.sandboxBridge === true)
      .map((def) => def.name)
      .sort();
    expect(marked).toEqual([...EXTERNAL_AGENT_TOOL_NAMES].sort());
  });
});
