import type { AgentJsonConfig } from '@/convex/agents/file_utils';

export type AgentPrimaryBehavior = NonNullable<
  AgentJsonConfig['primaryBehavior']
>;

/**
 * The config patch to apply when the agent's `primaryBehavior` changes.
 *
 * The whole config is validated by `agentJsonSchema` at save time, and the
 * editor's `updateConfig` SHALLOW-MERGES — so a field that must be dropped has
 * to be set to `undefined` explicitly, not omitted. This helper returns exactly
 * the keys to clear/set so the resulting config passes the schema's
 * `superRefine` cross-field rules:
 *
 *  - `external-agent` and `image-generation` bypass the platform tool loop, so
 *    `toolNames` / `workflows` must be empty (hard error otherwise).
 *    `image-generation` additionally forbids `integrationBindings`;
 *    `external-agent` KEEPS them (they are the sandbox MCP grant set).
 *  - `agentKind` / `authMode` / `nativeWebTools` are valid ONLY for
 *    `external-agent`.
 *
 * Tool-loop-only retrieval/tuning fields (`webSearchMode`, `knowledgeMode`,
 * `responseTuning`, `skillBindings`, `structuredResponsesEnabled`, …) are NOT
 * rejected by the schema for non-chat agents, so we deliberately leave them
 * untouched — they are merely hidden in the UI, not erased (clearing them would
 * be silent data loss on a round-trip through External and back).
 *
 * `supportedModels` is never touched here: every agent needs ≥1 model except a
 * byo-external one, and re-deriving models on a type switch is the caller's
 * concern (it surfaces a warning when the switch would leave models empty).
 */
export function nextConfigForBehavior(
  current: AgentJsonConfig,
  target: AgentPrimaryBehavior,
): Partial<AgentJsonConfig> {
  switch (target) {
    case 'chat':
      return {
        primaryBehavior: 'chat',
        agentKind: undefined,
        authMode: undefined,
        nativeWebTools: undefined,
      };
    case 'external-agent': {
      // Default the runtime when entering External; keep an existing choice
      // (e.g. round-tripping External → Chat → External).
      const agentKind = current.agentKind ?? 'claude-code';
      return {
        primaryBehavior: 'external-agent',
        toolNames: undefined,
        workflows: undefined,
        agentKind,
        // Cursor is BYO only — the Cursor CLI can't route through the platform
        // gateway. OpenCode is managed-only. Pin authMode so the re-entered
        // config passes the schema.
        ...(agentKind === 'cursor'
          ? { authMode: 'byo' as const }
          : agentKind === 'opencode'
            ? { authMode: 'managed' as const }
            : {}),
      };
    }
    case 'image-generation':
      return {
        primaryBehavior: 'image-generation',
        toolNames: undefined,
        workflows: undefined,
        integrationBindings: undefined,
        agentKind: undefined,
        authMode: undefined,
        nativeWebTools: undefined,
      };
    default: {
      const _exhaustive: never = target;
      throw new Error(`Unhandled agent behavior: ${String(_exhaustive)}`);
    }
  }
}
