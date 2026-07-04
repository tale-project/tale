import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 01 — retire the archived `opencode` product slug from agent configs.
 *
 * OpenCode is no longer a product runtime (`cursor` replaced it in the registry).
 * Any org agent file still carrying `agentKind: 'opencode'` is rewritten to
 * `claude-code` (the gateway-managed default). Idempotent: files already on
 * `claude-code` or `cursor` are untouched. `down` is a no-op — the prior slug
 * cannot be recovered without an audit trail.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/01_agent_kind_opencode_to_claude_code',
  semver: '0.2.90',
  numericId: 1,
  slug: 'agent_kind_opencode_to_claude_code',
  title: 'Rewrite agentKind opencode → claude-code in agent configs',
  description:
    'Retires the archived opencode product slug: every external-agent config ' +
    'with agentKind opencode becomes claude-code. Idempotent; cursor and ' +
    'claude-code files are left unchanged. down is a no-op.',
  kind: 'node',
  reversible: false,
  destructive: false,
  snapshot: 'none',
};
