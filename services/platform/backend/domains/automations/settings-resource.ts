import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';

import {
  approvalActArgsSchema,
  type AutomationApprovalConfig,
  automationApprovalConfigSchema,
} from '../../../lib/shared/schemas/automation-approval.ts';
import { isAdminOrDeveloperRole, isAdminRole } from '../../auth/membership.ts';
import { callerOrigin } from '../mcp/caller.ts';
import {
  identityOf,
  pageOf,
  pageOfRead,
  parseSettingsArgs,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import {
  approvalAllowanceHash,
  approvalPolicyOn,
  automationsWithAllowances,
  changeApprovalAllowances,
  readApprovalAllowanceView,
  writeActionOf,
  type ApprovalPolicyNote,
} from './approval-allowances.ts';
import { memberNamesOf } from './author-names.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import { assertAutomationName, AutomationError } from './store.ts';

/**
 * What an automation may do without a person approving each run, as a
 * settings kind over MCP (`automation-approval`): one resource per
 * automation, read as the General tab's "Runs without approval" lists it
 * and changed by the acts `grant` and `revoke` through the writer the tab
 * saves with — its name lock, its audit rows, its hint to every open
 * editor — which here also checks the set the change was read against.
 * Owners, admins and developers read what an automation may do, as the tab
 * shows it to authors; only owners and admins change it. An automation the
 * person cannot see reads as one that does not exist.
 */

const ID_FORM = "the automation's name, such as ops/morning-digest";

/** How many automations one page lists. */
const PAGE_SIZE = 50;

/** The acts the kind takes, as `grant` allows writes and `revoke` withdraws
 * the allowance of them. */
const ACTS = ['grant', 'revoke'] as const;

function forbidden(message: string): SettingsRefusalError {
  return new SettingsRefusalError('FORBIDDEN', message, {
    status: 403,
    hint: 'the role of the person whose key this is cannot do this; an owner or admin can change it, an owner, admin or developer can read it',
  });
}

function assertReader(role: string): void {
  if (!isAdminOrDeveloperRole(role)) {
    throw forbidden(
      'Only owners, admins and developers can read what an automation may do without approval.',
    );
  }
}

function assertGranter(role: string): void {
  if (!isAdminRole(role)) {
    throw forbidden(
      'Only owners and admins can allow an automation to run a write without approval, or withdraw that.',
    );
  }
}

/** The name of the automation a change names. */
function automationOf(change: SettingsChange): string {
  const id = identityOf('automation-approval', change.id, undefined, ID_FORM);
  try {
    if (assertAutomationName(id) === id) return id;
  } catch (error) {
    if (!(error instanceof AutomationError)) throw error;
  }
  throw new SettingsRefusalError(
    'SETTINGS_ID_INVALID',
    `"${id}" is no automation name`,
    { hint: `the id is ${ID_FORM}` },
  );
}

/** What a change does and to which types: the act it runs, and the step
 * types it names, each once. */
function actOf(change: SettingsChange): {
  act: (typeof ACTS)[number];
  types: string[];
} {
  const act = ACTS.find((candidate) => candidate === change.act);
  if (act === undefined) {
    throw new SettingsRefusalError(
      'SETTINGS_INVALID',
      `automation-approval changes by the acts ${ACTS.join(' and ')}`,
      { hint: 'send op act, with the act and args {types: […]}' },
    );
  }
  const { types } = parseSettingsArgs(
    approvalActArgsSchema,
    change.args,
    `the ${act} of ${automationOf(change)}`,
  );
  return { act, types: [...new Set(types)] };
}

/** One automation's allowances as a resource, from the latest version's
 * document as the store read it. */
async function resourceOf(
  ctx: SettingsContext,
  automation: string,
  document: unknown,
  policyOn: (type: string) => ApprovalPolicyNote,
): Promise<SettingsResource> {
  const { organizationId } = ctx.caller;
  const view = await readApprovalAllowanceView(ctx.sql, {
    organizationId,
    automation,
    document,
    policyOn,
  });
  // Whoever allowed a write is named by the door: a name, never an address,
  // and only for someone who still is a member.
  const names = await memberNamesOf(
    ctx.sql,
    organizationId,
    view.grants.map((grant) => grant.grantedBy),
  );
  const config: AutomationApprovalConfig = {
    automation,
    allowed: view.allowed,
    used: view.used,
    requiredByPolicy: view.requiredByPolicy,
    grants: view.grants.map((grant) => ({
      ...grant,
      grantedByName: names.get(grant.grantedBy) ?? null,
    })),
  };
  return {
    id: automation,
    config,
    hash: approvalAllowanceHash(automation, view.allowed),
  };
}

/** The automations as the caller sees them over MCP: one only in projects
 * they cannot read is not found. */
function visibleStore(ctx: SettingsContext) {
  return pgAutomationStore(ctx.sql, {
    organizationId: ctx.caller.organizationId,
    origin: callerOrigin(ctx.caller),
    visibleOnly: true,
  });
}

async function readAutomation(
  ctx: SettingsContext,
  store: ReturnType<typeof visibleStore>,
  automation: string,
  policyOn: (type: string) => ApprovalPolicyNote,
): Promise<SettingsResource | null> {
  const found = await store.get(automation);
  return found === null
    ? null
    : resourceOf(ctx, automation, found.automation, policyOn);
}

export const automationApprovalSettings: SettingsKindHandler = {
  kind: 'automation-approval',
  access: async ({ caller }) => ({
    read: isAdminOrDeveloperRole(caller.role),
    write: isAdminRole(caller.role),
  }),
  identify: automationOf,
  list: async (ctx, query) => {
    assertReader(ctx.caller.role);
    const { organizationId } = ctx.caller;
    const policyOn = await approvalPolicyOn(ctx.sql, organizationId);
    const store = visibleStore(ctx);
    if (query.ids !== undefined) {
      const items: SettingsResource[] = [];
      for (const name of query.ids) {
        const item = await readAutomation(ctx, store, name, policyOn);
        if (item !== null) items.push(item);
      }
      return pageOf(items, query.cursor, PAGE_SIZE);
    }
    // The automations with an allowance: one that has none holds nothing to
    // list, and is read by naming it.
    const visible = new Set(
      (await store.list()).map((automation) => automation.name),
    );
    const names = (
      await automationsWithAllowances(ctx.sql, organizationId)
    ).filter((name) => visible.has(name));
    return pageOfRead(names, query.cursor, PAGE_SIZE, async (name) => {
      const found = await store.get(name);
      return resourceOf(ctx, name, found?.automation ?? null, policyOn);
    });
  },
  read: async (ctx, id) => {
    assertReader(ctx.caller.role);
    return id === null
      ? null
      : readAutomation(
          ctx,
          visibleStore(ctx),
          id,
          await approvalPolicyOn(ctx.sql, ctx.caller.organizationId),
        );
  },
  plan: async (ctx, change, current) => {
    assertGranter(ctx.caller.role);
    const automation = automationOf(change);
    const { act, types } = actOf(change);
    if (current === null) {
      throw new SettingsRefusalError(
        'SETTINGS_NOT_FOUND',
        `no automation ${automation} to change`,
        { status: 404, hint: 'list_automations lists what exists' },
      );
    }
    const config = automationApprovalConfigSchema.parse(current.config);
    const held = new Set(config.allowed);
    // To allow, a write of the catalog; to withdraw, that or one still on
    // file whose action the catalog has since lost.
    const invalid = types.filter(
      (type) =>
        writeActionOf(type) === null && !(act === 'revoke' && held.has(type)),
    );
    if (invalid.length > 0) {
      throw new SettingsRefusalError(
        'APPROVAL_ALLOWANCE_INVALID',
        'Only a write to an outside system can be allowed to run without approval.',
        {
          hint: 'a read, and a write on the platform itself such as creating a task, never waits for approval; name a write of a connector as a step does, <connector>.<action>',
          data: { types: invalid },
        },
      );
    }
    const added =
      act === 'grant' ? types.filter((type) => !held.has(type)) : [];
    const allowed =
      act === 'grant'
        ? [...config.allowed, ...added]
        : config.allowed.filter((type) => !types.includes(type));
    const policyOn = await approvalPolicyOn(ctx.sql, ctx.caller.organizationId);
    // A write a rule of the policy already decides is no one's to remove:
    // the rule still wins at the gate.
    const effects: SettingsEffect[] = added.some(
      (type) => policyOn(type) === null,
    )
      ? ['removes-human-approval']
      : [];
    return {
      after: { ...config, allowed: allowed.toSorted() },
      unchanged: allowed.length === config.allowed.length,
      effects,
    };
  },
  apply: async (ctx, change, expectedHash) => {
    assertGranter(ctx.caller.role);
    const automation = automationOf(change);
    const { act, types } = actOf(change);
    const changed = await changeApprovalAllowances(ctx.sql, {
      organizationId: ctx.caller.organizationId,
      automation,
      act,
      types,
      expectedHash,
      origin: callerOrigin(ctx.caller),
      grantedBy: ctx.caller.userId,
    });
    return { hash: changed.hash };
  },
};
