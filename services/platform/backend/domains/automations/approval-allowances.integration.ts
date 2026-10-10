/** Real Postgres proof of an automation's writes without approval (0197):
 * an allowance granted through the store lets that automation's write pass
 * the approval gate while every other automation still asks; the General
 * tab's read names the granter; withdrawing it makes the write ask again;
 * deleting the automation removes what is left. The gate is asked in its
 * policy-only form, so no approval card is minted. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { appOrigin } from '../../lib/write-origin.ts';
import { evaluateApprovalGate } from '../approvals/gate.ts';
import {
  readApprovalAllowanceRows,
  setApprovalAllowances,
} from './approval-allowances.ts';
import { deleteAutomationCascade, saveVersion } from './store.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkApprovalAllowances(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const name = `allowance-probe-${suffix}`;
  const other = `allowance-other-${suffix}`;
  const gate = (automation: string) =>
    evaluateApprovalGate(sql, {
      organizationId: orgId,
      source: 'automation',
      resourceKey: `${automation}:post`,
      connector: 'slack',
      action: 'send_message',
      effect: 'write',
      platformInternal: false,
      automation,
      policyOnly: true,
    });
  const remaining = async () =>
    (
      await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM app.automation_approval_allowances
        WHERE org_id = ${orgId} AND automation_name = ${name}
      `
    )[0]?.count ?? -1;

  try {
    for (const automation of [name, other]) {
      await saveVersion(sql, {
        organizationId: orgId,
        name: automation,
        document: {
          version: 1,
          name: automation,
          nodes: [{ id: 'noop', type: 'transform', code: 'return null;' }],
          output: '{{ nodes.noop.output }}',
        },
        origin: appOrigin(userId),
      });
    }
    const granted = await setApprovalAllowances(sql, {
      organizationId: orgId,
      automation: name,
      allowed: ['slack.send_message'],
      origin: appOrigin(userId),
      grantedBy: userId,
    });
    const allowed = await gate(name);
    const asks = await gate(other);
    record(
      'approval allowance: the allowed automation writes without a person, another still asks [APV-R13]',
      granted.granted.join() === 'slack.send_message' &&
        allowed.decision === 'allow' &&
        asks.decision === 'needs-approval',
      `granted=${JSON.stringify(granted)} allowed=${allowed.decision} other=${asks.decision}`,
    );

    const rows = await readApprovalAllowanceRows(sql, {
      organizationId: orgId,
      automation: name,
    });
    const row = rows.find((entry) => entry.type === 'slack.send_message');
    record(
      'approval allowance: the General tab names who allowed it, even with no step using it',
      row !== undefined &&
        !row.used &&
        row.allowance?.grantedBy === userId &&
        typeof row.allowance.grantedByName === 'string',
      JSON.stringify(rows),
    );

    const withdrawn = await setApprovalAllowances(sql, {
      organizationId: orgId,
      automation: name,
      allowed: [],
      origin: appOrigin(userId),
      grantedBy: userId,
    });
    const asksAgain = await gate(name);
    record(
      'approval allowance: withdrawing it makes the write ask again',
      withdrawn.withdrawn.join() === 'slack.send_message' &&
        asksAgain.decision === 'needs-approval' &&
        (await remaining()) === 0,
      `withdrawn=${JSON.stringify(withdrawn)} gate=${asksAgain.decision}`,
    );

    await setApprovalAllowances(sql, {
      organizationId: orgId,
      automation: name,
      allowed: ['slack.send_message'],
      origin: appOrigin(userId),
      grantedBy: userId,
    });
    await deleteAutomationCascade(sql, {
      organizationId: orgId,
      name,
      origin: appOrigin(userId),
    });
    record(
      'approval allowance: deleting the automation removes it',
      (await remaining()) === 0,
      `left=${await remaining()}`,
    );
  } finally {
    for (const automation of [name, other]) {
      await deleteAutomationCascade(sql, {
        organizationId: orgId,
        name: automation,
        origin: appOrigin(userId),
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${automation}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
}
