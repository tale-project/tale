import {
  FILE_POLICY_TYPES,
  isFilePolicyType,
  POLICY_SCHEMAS,
  type FilePolicyType,
} from '@tale/shared/schemas/governance';
import {
  GOVERNANCE_KEYS_NOT_OVER_MCP,
  type SettingsEffect,
} from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  identityOf,
  pageOf,
  parseSettingsConfig,
  settingsActor,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import {
  assertGovernancePolicyReadable,
  checkGovernancePolicy,
  GovernancePolicyError,
  mayChangeGovernancePolicies,
  readGovernancePolicySnapshotFor,
  saveGovernancePolicy,
} from './policy-writer.ts';

/**
 * The organization's policies as a settings kind over MCP (`governance`):
 * one resource per policy, named by its key. Every read and change goes
 * through the policy writer the Settings pages use (`policy-writer.ts`),
 * with its gates, its checks and its audit row; this module adds what an
 * agent needs to weigh a change — which policies it may name, and what a
 * change does beyond the value it sets.
 */

const ID_FORM = 'the policy key, such as password_policy';

/** The policy an id names, when the kind takes it. */
function policyKey(id: string): FilePolicyType {
  if (Object.hasOwn(GOVERNANCE_KEYS_NOT_OVER_MCP, id)) {
    const reason: string = Reflect.get(GOVERNANCE_KEYS_NOT_OVER_MCP, id);
    throw id === 'conversation_access'
      ? new SettingsRefusalError('UNKNOWN_POLICY_TYPE', `${id} ${reason}`, {
          hint: 'tale://docs/settings lists the policies this kind takes',
        })
      : new SettingsRefusalError('SETTINGS_TALE_ONLY', `${id} ${reason}`, {
          hint: 'tell the person where to change it in Tale; nothing over MCP changes it',
        });
  }
  if (!isFilePolicyType(id)) {
    throw new SettingsRefusalError(
      'UNKNOWN_POLICY_TYPE',
      `"${id}" is not an organization policy`,
      { hint: 'tale://docs/settings lists the policies this kind takes' },
    );
  }
  return id;
}

/**
 * A refusal of the policy writer as an agent reads it: its own code and
 * sentence, with a hint. The two refusals the app's door answers in a
 * form of its own get stable codes, and a capacity the sandbox service
 * cannot state now is a refusal to retry, not a fault.
 */
function asRefusal(error: unknown): unknown {
  if (!(error instanceof GovernancePolicyError)) return error;
  if (error.code === 'use_special_action') {
    return new SettingsRefusalError('SETTINGS_TALE_ONLY', error.message, {
      hint: 'tell the person where to change it in Tale; nothing over MCP changes it',
    });
  }
  if (error.code === 'validation') {
    return new SettingsRefusalError('SETTINGS_INVALID', error.message, {
      hint: 'fix the config and plan again; tale://docs/settings names the fields of each policy',
    });
  }
  if (error.code === 'SANDBOX_CAPACITY_UNAVAILABLE') {
    return new SettingsRefusalError(error.code, error.message, {
      status: 409,
      hint: 'lowering the sandbox budgets works now; raising them waits until the sandbox service answers again',
    });
  }
  return new SettingsRefusalError(error.code, error.message, {
    status: error.status === 503 ? 409 : error.status,
    ...(error.status === 403
      ? {
          hint: 'the role of the person whose key this is cannot make this change; an owner or admin can',
        }
      : {}),
    ...(error.data === undefined ? {} : { data: error.data }),
  });
}

async function withRefusals<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asRefusal(error);
  }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Whether a change of the approval rules lets through without a person
 * something that needed one: a target that required approval no longer
 * does. */
function approvalLoosened(before: unknown, after: unknown): boolean {
  const decisions = (policy: unknown) =>
    new Map(
      list(record(policy).rules).map((rule) => {
        const { connector, action, decision } = record(rule);
        return [`${String(connector)}|${String(action)}`, decision] as const;
      }),
    );
  const now = decisions(after);
  return [...decisions(before)].some(
    ([target, decision]) =>
      decision === 'require_approval' && now.get(target) !== 'require_approval',
  );
}

/** Whether a change of the review rules lets someone sign off agent work
 * who could not before. */
function reviewLoosened(before: unknown, after: unknown): boolean {
  const was = record(before);
  const now = record(after);
  if (
    was.requireIndependentReviewer === true &&
    now.requireIndependentReviewer !== true
  ) {
    return true;
  }
  const kept = new Set(list(now.requiredCompetences));
  return list(was.requiredCompetences).some(
    (competence) => !kept.has(competence),
  );
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * What a change of one policy does beyond the value it sets, from the
 * policy before (null when none is saved) and after: who may be locked
 * out or signed out, and which human approval it removes.
 */
export function governanceEffects(
  key: FilePolicyType,
  before: unknown,
  after: unknown,
): SettingsEffect[] {
  const was = isRecord(before) ? before : null;
  const now = record(after);
  switch (key) {
    case 'login_policy':
      // An enabled lockout counts failed sign-ins against members.
      return now.enabled === false ? [] : ['may-lock-out-members'];
    case 'password_policy': {
      // Only rotation reaches passwords already set: turned on or
      // shortened, it expires some.
      const rotation = asNumber(now.rotationDays) ?? 0;
      const previous = asNumber(was?.rotationDays) ?? 0;
      return rotation > 0 && (previous === 0 || rotation < previous)
        ? ['may-lock-out-members']
        : [];
    }
    case 'two_factor_policy': {
      if (now.enforced !== true) return [];
      const tightened =
        was?.enforced !== true ||
        (asNumber(now.gracePeriodDays) ?? 0) <
          (asNumber(was.gracePeriodDays) ?? 0) ||
        (was.exemptSsoUsers !== false && now.exemptSsoUsers === false);
      return tightened ? ['may-lock-out-members'] : [];
    }
    case 'session_idle_timeout': {
      if (now.enabled !== true) return [];
      const shortened =
        was?.enabled !== true ||
        (asNumber(now.idleTimeoutMinutes) ?? 0) <
          (asNumber(was.idleTimeoutMinutes) ?? 0);
      return shortened ? ['signs-out-members'] : [];
    }
    case 'approval_policy':
      return approvalLoosened(was, now) ? ['removes-human-approval'] : [];
    case 'review_policy':
      return reviewLoosened(was, now) ? ['removes-human-approval'] : [];
    default:
      return [];
  }
}

/** One policy as the kind answers it, or null when none is saved. */
async function readPolicy(
  ctx: SettingsContext,
  key: FilePolicyType,
): Promise<SettingsResource | null> {
  const { caller } = ctx;
  const snapshot = await withRefusals(() =>
    readGovernancePolicySnapshotFor(
      ctx.sql,
      {
        organizationId: caller.organizationId,
        role: caller.role,
        orgSlug: caller.orgSlug,
      },
      key,
    ),
  );
  if (snapshot.policy === null || snapshot.hash === null) return null;
  return { id: key, config: snapshot.policy.config, hash: snapshot.hash };
}

/** Whether the caller's role reads a policy — a member reads a few, an
 * owner or admin every one. */
function readable(role: string, key: FilePolicyType): boolean {
  try {
    assertGovernancePolicyReadable(role, key);
    return true;
  } catch (error) {
    if (error instanceof GovernancePolicyError && error.status === 403) {
      return false;
    }
    throw error;
  }
}

/** The policy a change names. */
function changedKey(change: SettingsChange): FilePolicyType {
  return policyKey(identityOf('governance', change.id, undefined, ID_FORM));
}

export const governanceSettings: SettingsKindHandler = {
  kind: 'governance',
  access: async ({ caller }) => ({
    read: true,
    write: mayChangeGovernancePolicies(caller.role),
  }),
  identify: (change) => changedKey(change),
  list: async (ctx, query) => {
    const keys =
      query.ids === undefined
        ? FILE_POLICY_TYPES.filter(
            (key) =>
              !Object.hasOwn(GOVERNANCE_KEYS_NOT_OVER_MCP, key) &&
              readable(ctx.caller.role, key),
          )
        : query.ids.map(policyKey);
    const items: SettingsResource[] = [];
    for (const key of keys) {
      const policy = await readPolicy(ctx, key);
      if (policy !== null) items.push(policy);
    }
    return pageOf(items, query.cursor, 100);
  },
  read: async (ctx, id) =>
    id === null ? null : readPolicy(ctx, policyKey(id)),
  plan: async (ctx, change, current) => {
    const key = changedKey(change);
    parseSettingsConfig<unknown>(
      POLICY_SCHEMAS[key],
      change.config,
      `the ${key} policy`,
    );
    const checked = await withRefusals(async () =>
      checkGovernancePolicy(ctx.sql, await settingsActor(ctx), key, {
        config: change.config,
      }),
    );
    return {
      after: checked.config,
      unchanged:
        current !== null &&
        configurationHash(current.config) === configurationHash(checked.config),
      effects: governanceEffects(key, current?.config ?? null, checked.config),
    };
  },
  apply: async (ctx, change, expectedHash) => {
    const key = changedKey(change);
    await withRefusals(async () =>
      saveGovernancePolicy(ctx.sql, await settingsActor(ctx), key, {
        config: change.config,
        expectedHash,
      }),
    );
    return { hash: (await readPolicy(ctx, key))?.hash ?? null };
  },
};
