import type { GenericDatabaseReader } from 'convex/server';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  DEFAULT_SANDBOX_QUOTA,
  sandboxQuotaConfigSchema,
  type SandboxQuotaConfig,
} from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { readConfigCacheRow } from '../lib/config_cache/read';

export { DEFAULT_SANDBOX_QUOTA };

/**
 * Read the per-org sandbox concurrency quota (one-shot exec cap + active-session
 * cap) from the `sandbox_quota` governance policy. The file-backed config is
 * mirrored into `configCache`; a missing or invalid row falls back to the schema
 * defaults. Takes `db` so both one-shot (`reserveSlotAndInsert`) and session
 * (`reserveSessionSlotAndInsert`) mutations can share it.
 */
export async function readSandboxQuotaPolicy(
  db: GenericDatabaseReader<DataModel>,
  organizationId: string,
): Promise<SandboxQuotaConfig> {
  const row = await readConfigCacheRow(
    db,
    organizationId,
    'governance',
    'sandbox_quota',
  );
  if (!row) return DEFAULT_SANDBOX_QUOTA;
  const parsed = sandboxQuotaConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      '[sandbox.quota] invalid sandbox_quota policy; using defaults',
      { organizationId },
    );
    return DEFAULT_SANDBOX_QUOTA;
  }
  return parsed.data;
}

/**
 * The persistent-session workloads are limited separately so they never
 * compete for one pool. The `project` budget is the project agents' standing
 * sandboxes; its cap lives in the `maxSessionsPerOrg` config field, whose
 * name predates the rename and stays for shipped-config compatibility.
 */
export type SessionBudget = 'project' | 'workflow' | 'render';

/**
 * Which budget an `ownerType` draws from — `null` for the retired per-thread
 * run_code lane (dead since chat became plain-conversation, #2877), whose
 * leftover rows must not count against any live budget.
 */
export function sessionBudgetForOwnerType(
  ownerType: string,
): SessionBudget | null {
  if (ownerType === 'thread') return null;
  if (ownerType === 'workflow_run') return 'workflow';
  if (ownerType === 'render') return 'render';
  // `project_agent` standing sandboxes — plus any legacy per-user rows —
  // draw from the org's main session budget.
  return 'project';
}

/** As above for the reserve/resume paths, where the lane must be live. */
export function requireSessionBudgetForOwnerType(
  ownerType: string,
): SessionBudget {
  const budget = sessionBudgetForOwnerType(ownerType);
  if (budget === null) {
    throw new AppError({
      code: 'SESSION_LANE_RETIRED',
      message: `Sandbox sessions owned by '${ownerType}' can no longer be created or resumed.`,
    });
  }
  return budget;
}

/** The per-org cap for a session budget, from the quota policy. */
export function sessionCapFor(
  budget: SessionBudget,
  quota: SandboxQuotaConfig,
): number {
  if (budget === 'workflow') return quota.maxWorkflowSessionsPerOrg;
  if (budget === 'render') return quota.maxRenderSessionsPerOrg;
  // 'project' — the field name predates the rename (shipped org config).
  return quota.maxSessionsPerOrg;
}
