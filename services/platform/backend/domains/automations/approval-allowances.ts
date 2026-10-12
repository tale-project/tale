import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql, TransactionSql } from 'postgres';

import { findConnector } from '../../../lib/connectors/catalog.ts';
import { resolveApprovalDecision } from '../../core/approvals/policy.ts';
import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import type { WriteOrigin } from '../../lib/write-origin.ts';
import { auditDefinitionWrite } from './audit.ts';
import {
  AutomationError,
  emitDefinitionHint,
  lockAutomationName,
  versionRow,
} from './store.ts';

/**
 * The writes one automation may make without a person approving each run —
 * granted by an owner or admin for ONE automation and ONE write action, read
 * by the approval gate for that automation's steps (`approvals/gate.ts`),
 * where a rule of the organization's `approval_policy` that requires a
 * person for the action still wins.
 *
 * An allowance names a write to an outside system, as an automation's step
 * names it (`slack.send_message`): a read changes nothing and is never
 * gated; a write on the platform's own surface (a `platform`-auth
 * connector: tasks, documents, conversations) runs without a person
 * already, so an allowance could change nothing for it; and an action the
 * catalog does not know cannot run.
 * It outlives the versions that use it — a later version that stops using
 * the action leaves it in place, listed as unused — and is removed with the
 * automation.
 */

type Db = Sql | TransactionSql;

/** One write an automation may make without a person. */
export interface ApprovalAllowance {
  /** `<connector>.<action>`, as a step's type names it. */
  type: string;
  grantedBy: string;
  grantedAt: number;
  note: string | null;
}

/** The connector and action of a step type, when it names a write to an
 * outside system in the shipped catalog. */
export function writeActionOf(
  type: string,
): { connector: string; action: string } | null {
  const dot = type.indexOf('.');
  if (dot <= 0 || dot === type.length - 1) return null;
  const connector = type.slice(0, dot);
  const action = type.slice(dot + 1);
  const definition = findConnector(connector);
  if (definition?.auth.some((method) => method.method === 'platform')) {
    return null;
  }
  const declared = definition?.actions.find(
    (candidate) => candidate.name === action,
  );
  return declared?.effects === 'write' ? { connector, action } : null;
}

/** Whether `automation` may make `connector.action` without a person — the
 * approval gate's read. */
export async function hasApprovalAllowance(
  db: Db,
  args: {
    organizationId: string;
    automation: string;
    connector: string;
    action: string;
  },
): Promise<boolean> {
  const rows = await db<{ found: number }[]>`
    SELECT 1 AS found FROM app.automation_approval_allowances
    WHERE org_id = ${args.organizationId}
      AND automation_name = ${args.automation}
      AND connector = ${args.connector} AND action = ${args.action}
    LIMIT 1
  `;
  return rows.length > 0;
}

/** The allowances of one automation, in the order of their step types. */
export async function listApprovalAllowances(
  db: Db,
  args: { organizationId: string; automation: string },
): Promise<ApprovalAllowance[]> {
  const rows = await db<
    {
      connector: string;
      action: string;
      grantedBy: string;
      grantedAt: number;
      note: string | null;
    }[]
  >`
    SELECT connector, action, granted_by AS "grantedBy",
           granted_at_ms::float8 AS "grantedAt", note
    FROM app.automation_approval_allowances
    WHERE org_id = ${args.organizationId}
      AND automation_name = ${args.automation}
    ORDER BY connector, action
  `;
  return rows.map((row) => ({
    type: `${row.connector}.${row.action}`,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
    note: row.note,
  }));
}

/** The refusal of a name that is no write to an outside system. */
function invalidAllowances(types: readonly string[]): AutomationError {
  return new AutomationError(
    'APPROVAL_ALLOWANCE_INVALID',
    'Only a write to an outside system can be allowed to run without approval.',
    400,
    { types },
  );
}

/**
 * The identity of an automation's allowances, for a change that is made
 * against the set it was read from: the automation and the step types
 * allowed, in no order. A new version of the automation, or an edit of the
 * approval policy, leaves it as it was.
 */
export function approvalAllowanceHash(
  automation: string,
  types: readonly string[],
): string {
  return configurationHash({
    automation,
    allowed: [...new Set(types)].toSorted(),
  });
}

/**
 * Take the automation's name lock — the one its delete takes, so an
 * allowance is never left behind for an automation deleted meanwhile — and
 * read the step types allowed under it. An automation that does not exist
 * refuses the call.
 */
async function lockedAllowances(
  tx: TransactionSql,
  args: { organizationId: string; automation: string },
): Promise<Set<string>> {
  await lockAutomationName(tx, args.organizationId, args.automation);
  const exists = await tx<{ found: number }[]>`
    SELECT 1 AS found FROM app.automations
    WHERE org_id = ${args.organizationId} AND name = ${args.automation}
    LIMIT 1
  `;
  if (exists.length === 0) {
    throw new AutomationError(
      'AUTOMATION_NOT_FOUND',
      'The automation no longer exists.',
      404,
    );
  }
  return new Set(
    (await listApprovalAllowances(tx, args)).map((allowance) => allowance.type),
  );
}

/**
 * Make the stored allowances `wanted`, inside the caller's transaction and
 * under the automation's name lock: grant what is new, withdraw what is
 * gone, one audit row each, and tell every open editor and General tab of
 * the automation.
 */
async function reconcileAllowances(
  tx: TransactionSql,
  args: {
    organizationId: string;
    automation: string;
    origin: WriteOrigin;
    grantedBy: string;
  },
  current: ReadonlySet<string>,
  wanted: readonly string[],
): Promise<{ granted: string[]; withdrawn: string[] }> {
  const granted = wanted.filter((type) => !current.has(type));
  const withdrawn = [...current].filter((type) => !wanted.includes(type));
  const now = Date.now();
  for (const type of granted) {
    const write = writeActionOf(type);
    if (write === null) continue;
    await tx`
      INSERT INTO app.automation_approval_allowances (
        org_id, automation_name, connector, action, granted_by,
        granted_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.automation}, ${write.connector},
        ${write.action}, ${args.grantedBy}, ${now}
      )
      ON CONFLICT DO NOTHING
    `;
    await auditDefinitionWrite(tx, {
      organizationId: args.organizationId,
      origin: args.origin,
      action: 'automation.approval_allowance.granted',
      name: args.automation,
      newState: { type },
    });
  }
  for (const type of withdrawn) {
    const dot = type.indexOf('.');
    await tx`
      DELETE FROM app.automation_approval_allowances
      WHERE org_id = ${args.organizationId}
        AND automation_name = ${args.automation}
        AND connector = ${type.slice(0, dot)}
        AND action = ${type.slice(dot + 1)}
    `;
    await auditDefinitionWrite(tx, {
      organizationId: args.organizationId,
      origin: args.origin,
      action: 'automation.approval_allowance.revoked',
      name: args.automation,
      previousState: { type },
    });
  }
  if (granted.length + withdrawn.length > 0) {
    await emitDefinitionHint(tx, args.organizationId, args.automation);
  }
  return { granted, withdrawn };
}

/** The automations of an organization that hold at least one allowance, by
 * name. */
export async function automationsWithAllowances(
  db: Db,
  organizationId: string,
): Promise<string[]> {
  const rows = await db<{ name: string }[]>`
    SELECT DISTINCT automation_name AS name
    FROM app.automation_approval_allowances
    WHERE org_id = ${organizationId}
  `;
  return rows.map((row) => row.name).toSorted();
}

/**
 * Make the automation's allowances exactly `allowed` (step types): grant
 * what is new, withdraw what is gone, one audit row each, in one
 * transaction under the automation's name. A type that is not a write
 * action of the catalog refuses the whole call, and so does an automation
 * that does not exist.
 */
export async function setApprovalAllowances(
  sql: Sql,
  args: {
    organizationId: string;
    automation: string;
    allowed: readonly string[];
    /** Who grants, and through which door (`write-origin.ts`). */
    origin: WriteOrigin;
    /** The person's user id, recorded as the granter. */
    grantedBy: string;
  },
): Promise<{ granted: string[]; withdrawn: string[] }> {
  const wanted = [...new Set(args.allowed)];
  const invalid = wanted.filter((type) => writeActionOf(type) === null);
  if (invalid.length > 0) throw invalidAllowances(invalid);
  return sql.begin(async (tx) =>
    reconcileAllowances(tx, args, await lockedAllowances(tx, args), wanted),
  );
}

/**
 * Allow the automation more writes, or withdraw some, against the set a
 * caller read: `expectedHash` is that set's {@link approvalAllowanceHash},
 * and a set that is another by the time the name lock is held refuses the
 * change (`CONFIG_VERSION_CONFLICT`), so two callers never change one
 * another's set unseen. The other allowances stay as they are. To allow, a
 * type must be a write action of the catalog; to withdraw, it must be that
 * or one still on file whose action the catalog has since lost. Answers the
 * hash of the set afterwards.
 */
export async function changeApprovalAllowances(
  sql: Sql,
  args: {
    organizationId: string;
    automation: string;
    act: 'grant' | 'revoke';
    types: readonly string[];
    expectedHash: string | null;
    /** Who changes it, and through which door (`write-origin.ts`). */
    origin: WriteOrigin;
    /** The person's user id, recorded as the granter. */
    grantedBy: string;
  },
): Promise<{ granted: string[]; withdrawn: string[]; hash: string }> {
  const named = [...new Set(args.types)];
  if (args.act === 'grant') {
    const invalid = named.filter((type) => writeActionOf(type) === null);
    if (invalid.length > 0) throw invalidAllowances(invalid);
  }
  return sql.begin(async (tx) => {
    const current = await lockedAllowances(tx, args);
    assertExpectedHash(
      approvalAllowanceHash(args.automation, [...current]),
      args.expectedHash,
    );
    if (args.act === 'revoke') {
      const invalid = named.filter(
        (type) => !current.has(type) && writeActionOf(type) === null,
      );
      if (invalid.length > 0) throw invalidAllowances(invalid);
    }
    const wanted =
      args.act === 'grant'
        ? [...new Set([...current, ...named])]
        : [...current].filter((type) => !named.includes(type));
    return {
      ...(await reconcileAllowances(tx, args, current, wanted)),
      hash: approvalAllowanceHash(args.automation, wanted),
    };
  });
}

/** One write action as the automation's General tab lists it. */
export interface ApprovalAllowanceRow {
  /** `<connector>.<action>`. */
  type: string;
  /** Whether a step of the latest version makes it. */
  used: boolean;
  /** What the organization's approval policy decides for it whatever the
   * allowance says — a rule that `requires` a person, or one that already
   * `allows` it — or null when no rule speaks and the allowance decides. */
  policy: 'requires' | 'allows' | null;
  /** Who allowed it to run without a person, and when; null while it asks. */
  allowance: {
    grantedBy: string;
    /** The granter's name or email; null for someone erased or gone. */
    grantedByName: string | null;
    grantedAt: number;
  } | null;
}

/** What the organization's approval policy decides for a write action
 * whatever an allowance says: see {@link ApprovalAllowanceRow.policy}. */
export type ApprovalPolicyNote = ApprovalAllowanceRow['policy'];

/**
 * The organization's approval policy as it stands, as what it decides for a
 * step type. Read leniently: a file that does not parse stops every write at
 * the gate, and here it only leaves a list without its policy notes.
 */
export async function approvalPolicyOn(
  db: Db,
  organizationId: string,
): Promise<(type: string) => ApprovalPolicyNote> {
  const policy = await readGovernancePolicyForOrg(
    db,
    organizationId,
    'approval_policy',
  ).catch((error: unknown) => {
    console.warn(
      '[automations] approval policy unreadable for the allowance list:',
      error instanceof Error ? error.message : error,
    );
    return null;
  });
  return (type) => {
    const dot = type.indexOf('.');
    const decide = (allowance: boolean) =>
      resolveApprovalDecision({
        connector: type.slice(0, dot),
        action: type.slice(dot + 1),
        platformInternal: false,
        policy,
        allowance,
      });
    if (decide(true).requirement === 'require') return 'requires';
    const without = decide(false);
    return without.requirement === 'allow' && without.by === 'rule'
      ? 'allows'
      : null;
  };
}

/** The write actions the steps of a document make, as step types: each one
 * a write to an outside system of the catalog, once. */
export function writeTypesUsedBy(document: unknown): Set<string> {
  const nodes =
    document !== null &&
    typeof document === 'object' &&
    'nodes' in document &&
    Array.isArray(document.nodes)
      ? (document.nodes as unknown[])
      : [];
  const used = new Set<string>();
  for (const node of nodes) {
    if (node === null || typeof node !== 'object' || !('type' in node))
      continue;
    if (typeof node.type === 'string' && writeActionOf(node.type) !== null) {
      used.add(node.type);
    }
  }
  return used;
}

/**
 * The write actions of an automation as its General tab lists them: each
 * one a step of its latest version makes, and each one allowed without
 * approval that no step makes any more, with who allowed it. Read actions
 * never appear: nothing gates them.
 */
export async function readApprovalAllowanceRows(
  db: Db,
  args: { organizationId: string; automation: string },
): Promise<ApprovalAllowanceRow[]> {
  const latest = await versionRow(
    db,
    args.organizationId,
    args.automation,
    undefined,
  );
  const used = writeTypesUsedBy(latest?.document);
  const allowances = await listApprovalAllowances(db, args);
  const granters = [...new Set(allowances.map((row) => row.grantedBy))];
  const names = new Map(
    (granters.length === 0
      ? []
      : await db<{ id: string; name: string | null; email: string | null }[]>`
          SELECT id, name, email FROM "user" WHERE id = ANY(${granters})
        `
    ).map((user) => [user.id, user.name ?? user.email ?? null]),
  );
  const byType = new Map(allowances.map((row) => [row.type, row]));
  const policyOn = await approvalPolicyOn(db, args.organizationId);
  return [...new Set([...used, ...byType.keys()])].sort().map((type) => {
    const allowance = byType.get(type);
    return {
      type,
      used: used.has(type),
      policy: policyOn(type),
      allowance:
        allowance === undefined
          ? null
          : {
              grantedBy: allowance.grantedBy,
              grantedByName: names.get(allowance.grantedBy) ?? null,
              grantedAt: allowance.grantedAt,
            },
    };
  });
}

/** An automation's allowances as a coding agent reads them: no person's
 * name or address, only who allowed each by the id the door records. */
export interface ApprovalAllowanceView {
  /** The step types allowed to run without approval, in order. */
  allowed: string[];
  /** The write actions the steps of the automation's latest version make. */
  used: string[];
  /** The ones, of those allowed or used, a rule of the approval policy
   * still requires a person for, whatever the allowance says. */
  requiredByPolicy: string[];
  /** Who allowed each of `allowed`, and when. */
  grants: Array<{ type: string; grantedBy: string; grantedAt: number }>;
}

/**
 * The allowances of an automation whose latest version is `document`, as
 * a coding agent reads them (`policyOn`: {@link approvalPolicyOn}, read once
 * for as many automations as are listed together).
 */
export async function readApprovalAllowanceView(
  db: Db,
  args: {
    organizationId: string;
    automation: string;
    document: unknown;
    policyOn: (type: string) => ApprovalPolicyNote;
  },
): Promise<ApprovalAllowanceView> {
  const grants = (await listApprovalAllowances(db, args))
    .map(({ type, grantedBy, grantedAt }) => ({ type, grantedBy, grantedAt }))
    .toSorted((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  const allowed = grants.map((grant) => grant.type);
  const used = [...writeTypesUsedBy(args.document)].toSorted();
  return {
    allowed,
    used,
    requiredByPolicy: [...new Set([...used, ...allowed])]
      .toSorted()
      .filter((type) => args.policyOn(type) === 'requires'),
    grants,
  };
}
