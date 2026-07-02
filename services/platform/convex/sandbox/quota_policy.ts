import type { GenericDatabaseReader } from 'convex/server';

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
 * The three persistent-session workloads are limited separately so they never
 * compete for one pool: external-agent **user** sessions, per-**thread**
 * run_code sessions, and per-**workflow-run** sessions.
 */
export type SessionBudget = 'user' | 'thread' | 'workflow' | 'render';

/** Which budget an `ownerType` draws from. */
export function sessionBudgetForOwnerType(ownerType: string): SessionBudget {
  if (ownerType === 'thread') return 'thread';
  if (ownerType === 'workflow_run') return 'workflow';
  if (ownerType === 'render') return 'render';
  return 'user';
}

/** The per-org cap for a session budget, from the quota policy. */
export function sessionCapFor(
  budget: SessionBudget,
  quota: SandboxQuotaConfig,
): number {
  if (budget === 'thread') return quota.maxThreadSessionsPerOrg;
  if (budget === 'workflow') return quota.maxWorkflowSessionsPerOrg;
  if (budget === 'render') return quota.maxRenderSessionsPerOrg;
  return quota.maxSessionsPerOrg;
}
