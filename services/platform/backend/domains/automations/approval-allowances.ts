import type { Sql, TransactionSql } from 'postgres';

import { findConnector } from '../../../lib/connectors/catalog.ts';
import { resolveApprovalDecision } from '../../core/approvals/policy.ts';
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

/**
 * Make the automation's allowances exactly `allowed` (step types): grant
 * what is new, withdraw what is gone, one audit row each, in one
 * transaction under the automation's name — the lock its delete takes, so
 * an allowance is never left behind for an automation deleted meanwhile.
 * A type that is not a write action of the catalog refuses the whole call,
 * and so does an automation that does not exist.
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
  if (invalid.length > 0) {
    throw new AutomationError(
      'APPROVAL_ALLOWANCE_INVALID',
      'Only a write to an outside system can be allowed to run without approval.',
      400,
      { types: invalid },
    );
  }
  return sql.begin(async (tx) => {
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
    const current = new Set(
      (
        await listApprovalAllowances(tx, {
          organizationId: args.organizationId,
          automation: args.automation,
        })
      ).map((allowance) => allowance.type),
    );
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
    // Every open editor and General tab of the automation reads the set.
    if (granted.length + withdrawn.length > 0) {
      await emitDefinitionHint(tx, args.organizationId, args.automation);
    }
    return { granted, withdrawn };
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
  const document = latest?.document;
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
  // The policy as it stands, read leniently: a file that does not parse
  // stops every write at the gate, and here it only leaves the rows
  // without a policy note.
  const policy = await readGovernancePolicyForOrg(
    db,
    args.organizationId,
    'approval_policy',
  ).catch((error: unknown) => {
    console.warn(
      '[automations] approval policy unreadable for the allowance list:',
      error instanceof Error ? error.message : error,
    );
    return null;
  });
  const policyOn = (type: string): ApprovalAllowanceRow['policy'] => {
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
