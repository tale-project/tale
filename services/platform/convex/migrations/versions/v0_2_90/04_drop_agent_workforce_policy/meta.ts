import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 04 — retire the `agent_workforce` governance policy.
 *
 * The org-tunable workforce guardrail knobs (org concurrency cap, per-task
 * circuit breaker, budget-pause behaviour) became fixed deployment defaults
 * (`agents/guardrails/budget_guard.ts::AGENT_GUARDRAIL_DEFAULTS`); the policy
 * type left the schema registry, so an on-disk
 * `<org>/governance/agent-workforce.json` would be an unknown config file.
 * This migration deletes that file per org. A per-org fs-tree snapshot of the
 * governance directory is taken first so `down` can restore the prior files.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/04_drop_agent_workforce_policy',
  semver: '0.2.90',
  numericId: 4,
  slug: 'drop_agent_workforce_policy',
  title: 'Delete the retired agent-workforce governance policy file',
  description:
    'Deletes <org>/governance/agent-workforce.json — the agent_workforce ' +
    'policy type was removed from the governance schema registry (its ' +
    'capacity knobs became fixed deployment defaults). Idempotent: orgs ' +
    'without the file are untouched. A per-org fs-tree snapshot of the ' +
    'governance directory is taken first so down can restore the prior files.',
  kind: 'node',
  reversible: true,
  destructive: true,
  snapshot: 'fs-tree',
};
