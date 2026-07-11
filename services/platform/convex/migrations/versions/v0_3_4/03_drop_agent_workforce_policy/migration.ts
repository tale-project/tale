'use node';

/**
 * 0.3.4 / 03 — retire the `agent_workforce` governance policy.
 *
 * The org-tunable workforce guardrail knobs (org concurrency cap, per-task
 * circuit breaker, budget-pause behaviour) became fixed deployment defaults
 * (`agents/guardrails/budget_guard.ts::AGENT_GUARDRAIL_DEFAULTS`); the policy
 * type left the schema registry, so an on-disk
 * `<org>/governance/agent-workforce.json` would be an unknown config file.
 * This migration deletes that file per org. A per-org fs-tree snapshot of the
 * governance directory is taken first so `down` can restore the prior files.
 */

import path from 'node:path';

import { resolveGovernanceDir } from '../../../../governance/file_utils';
import { defineNodeMigration } from '../../../framework/define';

export const migration = defineNodeMigration({
  title: 'Delete the retired agent-workforce governance policy file',
  description:
    'Deletes <org>/governance/agent-workforce.json — the agent_workforce ' +
    'policy type was removed from the governance schema registry (its ' +
    'capacity knobs became fixed deployment defaults). Idempotent: orgs ' +
    'without the file are untouched. A per-org fs-tree snapshot of the ' +
    'governance directory is taken first so down can restore the prior files.',
  destructive: true,
  snapshot: 'fs-tree',
  formerIds: ['0.2.90/04_drop_agent_workforce_policy'],
  subjects: { domains: ['governance'] },

  async up(_ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(dir);
    const removed = await helpers.removeFileSafe(
      path.join(dir, 'agent-workforce.json'),
    );
    if (removed) {
      console.log(
        `[${helpers.migrationId}] removed agent-workforce.json for ${org.slug}`,
      );
    }
  },

  async down(_ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.restoreFsTree(dir);
  },
});
