import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.1 / 02 — rename `agentWebhooks.agentFileName` → `agentSlug`.
 *
 * Shipped in v0.2.1 (verified against `git diff v0.2.0 v0.2.1 --
 * convex/agents/webhooks/schema.ts`): the field was renamed and the
 * `by_agent` index recolumned from `['organizationId', 'agentFileName']` to
 * `['organizationId', 'agentSlug']`. Pure rename — fully reversible, no data
 * lost.
 *
 * up: copy `agentFileName` → `agentSlug`, then unset `agentFileName`.
 * down: copy `agentSlug` → `agentFileName`, then unset `agentSlug`.
 *
 * Reference-only: already shipped; cannot be replayed against today's schema.
 * Kept under round-trip test for the audit trail; the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.1/02_agent_webhooks_agent_slug',
  semver: '0.2.1',
  numericId: 2,
  slug: 'agent_webhooks_agent_slug',
  title: 'Rename agentWebhooks.agentFileName to agentSlug',
  description:
    'Renames the agentWebhooks.agentFileName field to agentSlug (and recolumns ' +
    'the by_agent index). up copies agentFileName into agentSlug and unsets ' +
    'agentFileName; down does the inverse. Pure rename, fully reversible, no ' +
    'data loss.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
