import { transactSerializable } from '@tale/shared/db/serializable';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  DEFAULT_SANDBOX_QUOTA,
  isFilePolicyType,
  isPolicyReadableByMember,
  POLICY_SCHEMAS,
  sandboxQuotaConfigSchema,
  sandboxQuotaTotal,
  sandboxWorkspacesConfigSchema,
  standardAgentConfigSchema,
  type FilePolicyType,
} from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';

import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '../../../lib/shared/hint-entities';
import { isAdmin } from '../../core/lib/rls/helpers/role_helpers.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { eligibleProjectAgentHarnesses } from '../projects/service.ts';
import { getSandboxDeploymentLimits } from '../sandbox/limits.ts';
import { recordUnusedWorkspaceRule } from '../sandbox/unused-rule.ts';

/**
 * The organization's policies, read and changed by one set of rules: who
 * may read which policy, how a change is checked before anything is
 * written, and how it lands — audited, announced to every open session and
 * written to its file last, inside one transaction. The Settings pages'
 * door (`routes.ts`) answers through it, and so does every other caller
 * that changes a policy, so the rules cannot differ by where the change
 * comes from. The policy files are the store: `lib/governance-policy-write.ts`
 * owns their bytes, history and compare-and-set.
 */

/** Policies with their own staged workflows (bounds, grace periods) —
 * never changed through the generic write. */
const SPECIAL_WRITE_POLICY_TYPES: ReadonlySet<string> = new Set([
  'retention_policy',
  'dsar_governance',
]);

/**
 * A refusal of a policy read or change, as the app's door answers it: the
 * code and status it puts on the wire, the sentence a reader is told, and
 * the data some refusals carry. `answersMessage` says whether the door's
 * answer carries the sentence.
 */
export class GovernancePolicyError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 503;
  readonly data?: Record<string, unknown>;
  readonly answersMessage: boolean;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 503,
    options: { data?: Record<string, unknown>; answersMessage?: boolean } = {},
  ) {
    super(message);
    this.name = 'GovernancePolicyError';
    this.code = code;
    this.status = status;
    if (options.data !== undefined) this.data = options.data;
    this.answersMessage = options.answersMessage === true;
  }
}

/** Who changes a policy, in which organization, with which role. */
export interface GovernancePolicyActor {
  readonly organizationId: string;
  readonly userId: string;
  readonly email?: string;
  readonly role: string;
}

/** Whether a role may change the organization's policies: an owner or an
 * admin. */
export function mayChangeGovernancePolicies(role: string): boolean {
  return isAdmin(role);
}

function unknownPolicy(policyType: string): GovernancePolicyError {
  return new GovernancePolicyError(
    'UNKNOWN_POLICY_TYPE',
    `"${policyType}" is not an organization policy.`,
    400,
  );
}

function organizationGone(): GovernancePolicyError {
  return new GovernancePolicyError(
    'ORG_NOT_FOUND',
    'The organization no longer exists.',
    404,
  );
}

/** The policy a reader names, when the reader's role may read it: any
 * member reads the policies `isPolicyReadableByMember` lists, an owner or
 * admin every one. */
export function assertGovernancePolicyReadable(
  role: string,
  policyType: string,
): FilePolicyType {
  if (!isFilePolicyType(policyType)) throw unknownPolicy(policyType);
  if (!isPolicyReadableByMember(policyType) && !isAdmin(role)) {
    throw new GovernancePolicyError(
      'FORBIDDEN',
      `Only owners and admins can read the ${policyType} policy.`,
      403,
    );
  }
  return policyType;
}

/**
 * A policy as its file holds it now, past every cache, with the hash its
 * writer checks a change against: no policy and a null hash when the
 * organization has never saved one. The organization's slug is resolved
 * afresh unless the caller already read it for this request.
 */
export async function readGovernancePolicySnapshotFor(
  sql: Sql,
  member: {
    readonly organizationId: string;
    readonly role: string;
    readonly orgSlug?: string;
  },
  policyType: string,
): Promise<{
  policy: { key: FilePolicyType; config: unknown } | null;
  hash: string | null;
}> {
  const type = assertGovernancePolicyReadable(member.role, policyType);
  const orgSlug =
    member.orgSlug ??
    (await resolveOrgSlug(sql, member.organizationId, { fresh: true }));
  if (orgSlug === null) throw organizationGone();
  const { readGovernancePolicySnapshot } =
    await import('../../lib/governance-policy-write');
  const snapshot = await readGovernancePolicySnapshot(orgSlug, type);
  return {
    policy:
      snapshot.config === null ? null : { key: type, config: snapshot.config },
    hash: snapshot.hash,
  };
}

/** A change as the writer will store it, checked the way the save checks
 * it. */
export interface CheckedGovernancePolicy {
  readonly policyType: FilePolicyType;
  readonly config: unknown;
  /** The hash the change expects is stored now; undefined when it names
   * none, and the write then replaces whatever is there. */
  readonly expectedHash: string | null | undefined;
}

/**
 * Check one policy change as the save does, and write nothing: the policy
 * exists and has no workflow of its own, the actor is an owner or admin,
 * the expected hash is well formed, the config is the policy's own, a
 * standard agent names a runtime the managed lane can run, and the sandbox
 * budgets fit the deployment's capacity as it is now.
 */
export async function checkGovernancePolicy(
  sql: Sql,
  actor: GovernancePolicyActor,
  policyType: string,
  input: { readonly config: unknown; readonly expectedHash?: unknown },
): Promise<CheckedGovernancePolicy> {
  if (!isFilePolicyType(policyType)) throw unknownPolicy(policyType);
  if (SPECIAL_WRITE_POLICY_TYPES.has(policyType)) {
    throw new GovernancePolicyError(
      'use_special_action',
      `${policyType} has a dedicated write door.`,
      400,
      { answersMessage: true },
    );
  }
  if (!mayChangeGovernancePolicies(actor.role)) {
    throw new GovernancePolicyError(
      'FORBIDDEN',
      'Only owners and admins can change organization policies.',
      403,
    );
  }
  const precondition = expectedConfigurationHashSchema
    .optional()
    .safeParse(input.expectedHash);
  if (!precondition.success) {
    throw new GovernancePolicyError(
      'INVALID_CONFIG_PRECONDITION',
      'The expected hash is not a configuration hash.',
      400,
    );
  }
  const parsed = POLICY_SCHEMAS[policyType].safeParse(input.config);
  if (!parsed.success) {
    throw new GovernancePolicyError(
      'validation',
      `Invalid ${policyType} configuration: ${parsed.error.message}`,
      400,
      { answersMessage: true },
    );
  }
  if (policyType === 'standard_agent') {
    // The runtime a project agent may run on is the managed lane's list,
    // which only the platform knows; the shared schema cannot check it.
    const { harness } = standardAgentConfigSchema.parse(parsed.data);
    const harnesses = eligibleProjectAgentHarnesses();
    if (harness !== undefined && !harnesses.includes(harness)) {
      throw new GovernancePolicyError(
        'STANDARD_AGENT_HARNESS_INVALID',
        `The agent runtime "${harness}" cannot run project agents here; choose one of ${harnesses.join(', ')}.`,
        400,
        { data: { harnesses } },
      );
    }
  }
  if (policyType === 'sandbox_quota') {
    const total = sandboxQuotaTotal(
      sandboxQuotaConfigSchema.parse(parsed.data),
    );
    // Read at save time; neither a client-supplied ceiling nor the UI's
    // last snapshot can authorize a configuration against a changed host.
    const limits = await getSandboxDeploymentLimits(actor.organizationId);
    if (limits.status === 'unavailable') {
      // No readable ceiling: a total that does not grow is still saved.
      // Lowering limits can never oversubscribe more than the saved
      // configuration already does, and shedding load is the one edit an
      // admin needs while the sandbox service is down; only raising the
      // total needs the capacity.
      const saved = sandboxQuotaConfigSchema.safeParse(
        await readGovernancePolicyForOrg(
          sql,
          actor.organizationId,
          'sandbox_quota',
          { fresh: true },
        ),
      );
      const savedTotal = sandboxQuotaTotal(
        saved.success ? saved.data : DEFAULT_SANDBOX_QUOTA,
      );
      if (total > savedTotal) {
        throw new GovernancePolicyError(
          'SANDBOX_CAPACITY_UNAVAILABLE',
          'The sandbox service cannot say how many sessions this deployment runs, so the sandbox budgets cannot grow now; lowering them still works.',
          503,
        );
      }
    } else if (total > limits.maxSessions + (limits.deviceSessions ?? 0)) {
      // The organization's connected devices add their own slots: a quota
      // may use the deployment's capacity plus its own machines'.
      throw new GovernancePolicyError(
        'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
        `The sandbox budgets add up to ${total} sessions, more than the ${limits.maxSessions + (limits.deviceSessions ?? 0)} this deployment can run for the organization.`,
        400,
        {
          data: {
            total,
            maxSessions: limits.maxSessions,
            ...(limits.deviceSessions
              ? { deviceSessions: limits.deviceSessions }
              : {}),
          },
        },
      );
    }
  }
  return {
    policyType,
    config: parsed.data,
    expectedHash: precondition.data,
  };
}

/**
 * Change one policy: checked as `checkGovernancePolicy` checks it, then
 * audited, announced and written in one transaction — the file last, so a
 * failed write rolls the audit row back and no policy is ever in force
 * that the tamper-evident chain knows nothing about. With an expected hash
 * the write lands only on the file it names.
 */
export async function saveGovernancePolicy(
  sql: Sql,
  actor: GovernancePolicyActor,
  policyType: string,
  input: { readonly config: unknown; readonly expectedHash?: unknown },
): Promise<void> {
  const checked = await checkGovernancePolicy(sql, actor, policyType, input);
  const { organizationId } = actor;
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (orgSlug === null) throw organizationGone();
  // The file as it IS, not the TTL cache's view of it: two admins saving
  // inside the cache window must each audit the config they replaced.
  const previous = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    checked.policyType,
    { fresh: true },
  );
  const { writeGovernancePolicyFile } =
    await import('../../lib/governance-policy-write.ts');
  await transactSerializable(sql, async (tx) => {
    await createAuditLog(tx, {
      organizationId,
      actorId: actor.userId,
      ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
      actorType: 'user',
      action:
        previous === null
          ? 'governance_policy.created'
          : 'governance_policy.updated',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: checked.policyType,
      ...(previous !== null ? { previousState: { config: previous } } : {}),
      newState: { config: checked.config },
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: organizationId,
      entity: 'governance_policy',
      entityId: checked.policyType,
    });
    if (
      checked.policyType === 'model_access' ||
      checked.policyType === 'vision_model' ||
      checked.policyType === 'transcription_model' ||
      checked.policyType === 'image_generation'
    ) {
      // The serving catalog and resolved picks are provider-derived reads.
      // Every open session must refresh them, not only the saving tab.
      await emitHintInTx(tx, {
        orgId: organizationId,
        entity: PROVIDER_CREDENTIAL_HINT_ENTITY,
        entityId: checked.policyType,
      });
    }
    if (checked.policyType === 'sandbox_workspaces') {
      // The unused-workspace rule takes effect with this save: a rule
      // turned (back) on or a shorter window starts its full window now,
      // not at the next hourly sweep.
      await recordUnusedWorkspaceRule(
        tx,
        organizationId,
        sandboxWorkspacesConfigSchema.parse(checked.config),
        Date.now(),
      );
    }
    // The file LAST, inside the transaction: a write failure rolls the
    // audit row back, and a transaction failure never leaves a policy in
    // force that the tamper-evident chain knows nothing about.
    if (checked.expectedHash === undefined)
      await writeGovernancePolicyFile(
        tx,
        orgSlug,
        checked.policyType,
        checked.config,
      );
    else
      await writeGovernancePolicyFile(
        tx,
        orgSlug,
        checked.policyType,
        checked.config,
        checked.expectedHash,
      );
  });
}
