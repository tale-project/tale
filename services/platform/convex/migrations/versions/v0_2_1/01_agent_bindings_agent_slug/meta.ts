import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.1 / 01 — rename `agentBindings.agentFileName` → `agentSlug`.
 *
 * Shipped in v0.2.1 (verified against `git diff v0.2.0 v0.2.1 --
 * convex/agents/schema.ts`): the field was renamed and the `by_org_agent`
 * index recolumned from `['organizationId', 'agentFileName']` to
 * `['organizationId', 'agentSlug']`. Pure rename — fully reversible from the
 * data already present, no information lost.
 *
 * up: copy `agentFileName` → `agentSlug`, then unset `agentFileName`.
 * down: copy `agentSlug` → `agentFileName`, then unset `agentSlug`.
 *
 * Reference-only: this already shipped in a tagged release and CANNOT be
 * replayed (Convex validates rows against today's schema at push, where
 * `agentFileName` no longer exists). Kept under round-trip test for the audit
 * trail; the runner never executes it. The index recolumn is a schema concern
 * outside this row transform.
 */
export const meta: MigrationMeta = {
  id: '0.2.1/01_agent_bindings_agent_slug',
  semver: '0.2.1',
  numericId: 1,
  slug: 'agent_bindings_agent_slug',
  title: 'Rename agentBindings.agentFileName to agentSlug',
  description:
    'Renames the agentBindings.agentFileName field to agentSlug (and recolumns ' +
    'the by_org_agent index). up copies agentFileName into agentSlug and unsets ' +
    'agentFileName; down does the inverse. Pure rename, fully reversible, no ' +
    'data loss.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
