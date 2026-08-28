import type { Sql } from 'postgres';

import type { ShimHandlers } from '../../lib/convex-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import {
  claimRun,
  continueRun,
  deployedVersion,
  finishRun,
  heartbeatRun,
  recordProgress,
  suspendRun,
  versionRow,
} from './store.ts';

/**
 * Handler map for the REUSED automation stepper
 * (`convex/automations/stepper.ts` — claim/heartbeat/progress/suspend/
 * continue/finish + the two loads), running the whole run contract over the
 * PG store with pg-boss scheduling. The llm node resolves its serving
 * connector through the same provider/credential seams the chat lane's shim
 * already answers (spread first).
 *
 * Deliberately ABSENT (fail-loud until their domains land): the connector
 * executor (`connectors/execute_action:runConnectorAction` — connector
 * dispatch is retired pending its redesign) and the agent-node hosts.
 * The approval gate allows platform-internal writes and refuses outbound
 * ones with a named reason — outbound effects only exist on connector
 * nodes, which fail earlier anyway.
 */
export function automationShimHandlers(sql: Sql): ShimHandlers {
  return {
    ...chatShimHandlers(sql),

    'automations/mutations:claimRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      return claimRun(sql, args.organizationId, args.runId);
    },
    'automations/mutations:heartbeatRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as {
        organizationId: string;
        runId: string;
        epoch: number;
      };
      return heartbeatRun(sql, args.organizationId, args.runId, args.epoch);
    },
    'automations/mutations:recordProgress': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof recordProgress>[1];
      return recordProgress(sql, args);
    },
    'automations/mutations:suspendRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof suspendRun>[1];
      return suspendRun(sql, args);
    },
    'automations/mutations:continueRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof continueRun>[1];
      return continueRun(sql, args);
    },
    'automations/mutations:finishRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as Parameters<typeof finishRun>[1];
      return finishRun(sql, args);
    },

    'automations/queries:loadRunForStep': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as { organizationId: string; runId: string };
      const rows = await sql<
        {
          id: string;
          organizationId: string;
          name: string;
          version: number;
          status: string;
          mode: 'mock' | 'live';
          startedBy: string;
          input: unknown;
          checkpoints: unknown;
          startedAt: number;
        }[]
      >`
        SELECT id, org_id AS "organizationId", name, version, status, mode,
               started_by AS "startedBy", input, checkpoints,
               started_at_ms::float8 AS "startedAt"
        FROM app.automation_runs
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const run = rows[0];
      if (!run) return null;
      const version = await versionRow(
        sql,
        args.organizationId,
        run.name,
        run.version,
      );
      if (!version) return null;
      return { run, document: version.document };
    },

    'automations/queries:loadAutomationDocument': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper passes exactly this shape
      const args = raw as {
        organizationId: string;
        name: string;
        version?: number;
      };
      const version =
        args.version ??
        (await deployedVersion(sql, args.organizationId, args.name));
      const row = await versionRow(
        sql,
        args.organizationId,
        args.name,
        version,
      );
      return row ? { version: row.version, document: row.document } : null;
    },

    'approvals/gate:evaluateApprovalGate': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the stepper's gate passes exactly this shape
      const args = raw as { platformInternal?: boolean; connector: string };
      if (args.platformInternal === true) {
        return { decision: 'allow' };
      }
      // Outbound live writes wait for the approvals domain; connector nodes
      // fail earlier (the executor is un-shimmed), so this is a backstop.
      throw new Error(
        `[automations] outbound approval for "${args.connector}" needs the approvals domain (not ported yet)`,
      );
    },
  };
}
