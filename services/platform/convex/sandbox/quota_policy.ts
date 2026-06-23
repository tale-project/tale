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
