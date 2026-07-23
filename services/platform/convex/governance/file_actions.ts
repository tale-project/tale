'use node';

/**
 * Governance file I/O actions — per organization.
 *
 * The source of truth for governance policies is the per-org config tree at
 * `$TALE_CONFIG_DIR/<orgSlug>/governance/`. V8 code can't read the filesystem,
 * so writes re-sync the generic `configCache` mirror (domain `'governance'`,
 * via `lib/config_cache/actions.ts::syncConfigDomainFromFiles`) that
 * queries/mutations read.
 *
 * This file holds the admin-gated WRITE actions (atomic write + history
 * snapshot + audit log + re-sync), modeled on `branding/file_actions.ts`. The
 * file→cache READ sync is the generic `lib/config_cache` machinery.
 *
 * Writes emit the canonical `.yml` form and then DELETE the `.json` sibling:
 * readers prefer `.yml`, so a stale `.json` left behind would silently shadow
 * nothing today but would resurrect an outdated policy if the `.yml` were
 * ever removed by hand. Superseding it on every successful write keeps
 * exactly one authoritative file per policy.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import {
  type FilePolicyType,
  isFilePolicyType,
  POLICY_SCHEMAS,
} from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { action, internalAction } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeFileSafe,
} from '../lib/file_io';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  MAX_HISTORY_ENTRIES,
  resolveHistoryDir,
  resolvePolicyFilePath,
  resolvePolicyYamlFilePath,
  serializePolicyYaml,
} from './file_utils';

/** Policy types with bespoke write actions (grace windows / bounds) that the
 *  generic writer must refuse — they own their own validation + persistence. */
const SPECIAL_WRITE_POLICY_TYPES = new Set<FilePolicyType>([
  'retention_policy', // governance/retention_actions.upsertRetentionPolicyAction (bounds)
  'dsar_governance', // governance/dsar_policy.proposeDsarPolicy (owner-only + 24h grace)
]);

function rotationDays(config: unknown): number {
  if (!isRecord(config)) return 0;
  return typeof config.rotationDays === 'number' ? config.rotationDays : 0;
}

/**
 * Snapshot the current policy file to `.history`, write the new config
 * atomically, then re-sync the cache. The shared persistence primitive behind
 * `saveGovernancePolicy` and the bespoke retention/DSAR write actions. Does NOT
 * authenticate or audit — callers own those (they differ per policy).
 * `config` must already be schema-validated/normalized by the caller.
 *
 * Persists the canonical `.yml` and, only after that write succeeded,
 * deletes the superseded `.json` sibling (pre-conversion trees still carry
 * one). The history snapshot captures whichever format was current, under
 * its own extension, so a restore-by-hand stays a plain copy.
 */
async function writePolicyFileAndSync(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  policyType: FilePolicyType,
  config: unknown,
): Promise<void> {
  const yamlPath = resolvePolicyYamlFilePath(orgSlug, policyType);
  const jsonPath = resolvePolicyFilePath(orgSlug, policyType);
  const currentYaml = await readFileSafe(yamlPath);
  const currentContent = currentYaml ?? (await readFileSafe(jsonPath));
  if (currentContent) {
    const historyDir = resolveHistoryDir(orgSlug, policyType);
    await mkdir(historyDir, { recursive: true });
    await atomicWrite(
      path.join(
        historyDir,
        `${generateHistoryTimestamp()}.${currentYaml ? 'yml' : 'json'}`,
      ),
      currentContent,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }
  await atomicWrite(yamlPath, serializePolicyYaml(policyType, config));
  await removeFileSafe(jsonPath);
  // Mirror the just-written files into the generic `configCache` (domain
  // 'governance') so V8 readers observe the change immediately.
  await ctx.runAction(
    internal.lib.config_cache.actions.syncConfigDomainFromFiles,
    { organizationId, domain: 'governance' },
  );
}

/**
 * Cross-module file-write primitive for V8 actions that can't touch the
 * filesystem (e.g. `retention_actions.upsertRetentionPolicyAction`,
 * `dsar_policy` writers). Validates against the policy schema, persists, and
 * re-syncs the cache. Auth + audit are the caller's responsibility.
 */
export const persistGovernancePolicyFile = internalAction({
  args: {
    organizationId: v.string(),
    policyType: v.string(),
    config: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!isFilePolicyType(args.policyType)) {
      throw new ConvexError({
        code: 'validation',
        message: `Unknown governance policy type: ${args.policyType}`,
      });
    }
    const parsed = POLICY_SCHEMAS[args.policyType].safeParse(args.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'validation',
        message: `Invalid ${args.policyType} configuration: ${parsed.error.message}`,
      });
    }
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    await writePolicyFileAndSync(
      ctx,
      args.organizationId,
      orgSlug,
      args.policyType,
      parsed.data,
    );
    return null;
  },
});

/**
 * Admin-gated write of a governance policy to its per-org JSON file, then
 * re-sync the cache so V8 readers observe the change. Mirrors
 * `branding/file_actions.ts`: membership + `orgSettings` capability gate,
 * 100-entry history snapshot, atomic write. Audit emission + (for
 * `password_policy`) the rotation grace anchor run in V8 mutations afterwards.
 *
 * Refuses `retention_policy` and `dsar_governance` — those have bespoke write
 * actions enforcing bounds / owner-only-loosen-grace respectively.
 */
export const saveGovernancePolicy = action({
  args: {
    organizationId: v.string(),
    policyType: v.string(),
    config: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!isFilePolicyType(args.policyType)) {
      throw new ConvexError({
        code: 'validation',
        message: `Unknown governance policy type: ${args.policyType}`,
      });
    }
    const policyType = args.policyType;
    if (SPECIAL_WRITE_POLICY_TYPES.has(policyType)) {
      throw new ConvexError({
        code: 'use_special_action',
        message: `${policyType} has a dedicated write action; do not route it through saveGovernancePolicy.`,
      });
    }

    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    if (defineAbilityFor(auth.member.role).cannot('write', 'orgSettings')) {
      throw new ConvexError({
        code: 'ORG_FORBIDDEN',
        message: `Role "${auth.member.role}" cannot modify governance policies.`,
      });
    }
    const orgSlug = auth.orgSlug;

    const parsed = POLICY_SCHEMAS[policyType].safeParse(args.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'validation',
        message: `Invalid ${policyType} configuration: ${parsed.error.message}`,
      });
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema output is always a record for these policy objects
    const config = parsed.data as Record<string, unknown>;

    // Previous effective config (for the audit diff + rotation-grace detection).
    const previousConfig: unknown = await ctx.runQuery(
      internal.governance.internal_queries.getPolicyConfigInternal,
      { organizationId: args.organizationId, policyType },
    );
    const created = previousConfig === null || previousConfig === undefined;

    await writePolicyFileAndSync(
      ctx,
      args.organizationId,
      orgSlug,
      policyType,
      config,
    );

    // Password rotation grace: stamp `effectiveAt` the first time rotation
    // transitions 0 → positive, so affected users get a full grace window.
    if (
      policyType === 'password_policy' &&
      rotationDays(config) > 0 &&
      rotationDays(previousConfig) === 0
    ) {
      await ctx.runMutation(
        internal.lib.config_cache.cache.setConfigCacheEffectiveAt,
        {
          organizationId: args.organizationId,
          domain: 'governance',
          key: policyType,
          effectiveAt: Date.now(),
        },
      );
    }

    await ctx.runMutation(
      internal.governance.policy_audit.recordGovernancePolicyAudit,
      {
        organizationId: args.organizationId,
        actorId: auth.userId,
        actorEmail: auth.email,
        policyType,
        created,
        previousConfig: isRecord(previousConfig) ? previousConfig : undefined,
        newConfig: config,
      },
    );

    return null;
  },
});
