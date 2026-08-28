import type { Sql } from 'postgres';
import { z } from 'zod';

import { stepRunImpl } from '../../convex/automations/stepper.ts';
import { removeOrgSubtree } from '../../convex/organizations/scaffold.ts';
import { startTaskAgentTurnImpl } from '../../convex/tasks/agent_run_host.ts';
import { automationShimHandlers } from '../domains/automations/shim.ts';
import {
  pollParkedRun,
  sweepOverdueRuns,
} from '../domains/automations/store.ts';
import { scanScheduledTriggers } from '../domains/automations/triggers.ts';
import { indexUploadedFile } from '../domains/knowledge/service.ts';
import { scaffoldNewOrganization } from '../domains/organizations/scaffold.ts';
import { agentTurnShimHandlers } from '../domains/tasks/agent-turn-shim.ts';
import { createCtxShim } from '../lib/convex-shim.ts';

/** One task handler; `payload` is a job row — external input, re-validate. */
export type TaskHandler = (payload: unknown) => Promise<void>;

export type BackendTaskList = Record<string, TaskHandler>;

const orgScaffoldSchema = z.object({
  orgSlug: z.string().min(1),
  cleanFirst: z.boolean().optional(),
});

const orgCleanupSchema = z.object({
  orgSlug: z.string().min(1),
});

export interface TaskDeps {
  sql: Sql;
}

/**
 * The production task list. Handlers are registered here as domains land;
 * every identifier must exist in `TaskPayloads` (tasks.ts), every handler is
 * idempotent (at-least-once delivery), and every payload is re-validated at
 * the boundary.
 */
export function createTaskList(deps: TaskDeps): BackendTaskList {
  return {
    noop: (payload) => {
      console.debug(`[backend] noop task executed: ${JSON.stringify(payload)}`);
      return Promise.resolve();
    },
    'org.scaffold': async (payload) => {
      const input = orgScaffoldSchema.parse(payload);
      const result = await scaffoldNewOrganization(input);
      if (!result.ok) {
        // Throw so pg-boss retries — scaffold is idempotent per domain.
        throw new Error(`org scaffold failed: ${result.error}`);
      }
    },
    'maintenance.rate_limit_gc': async () => {
      // Any row idle for 7 days is past every window/refill horizon.
      const cutoff = Date.now() - 7 * 24 * 3_600_000;
      const deleted = await deps.sql`
        DELETE FROM app.rate_limits WHERE ts < ${cutoff}
      `;
      console.log(`[maintenance] rate_limit_gc removed ${deleted.count} rows`);
    },
    'maintenance.login_attempts_ttl': async () => {
      const attemptsCutoff = Date.now() - 30 * 24 * 3_600_000;
      const countersCutoff = Date.now() - 90 * 24 * 3_600_000;
      const attempts = await deps.sql`
        DELETE FROM app.login_attempts
        WHERE last_failure_at < ${attemptsCutoff}
      `;
      const counters = await deps.sql`
        DELETE FROM app.login_block_counters
        WHERE window_start < ${countersCutoff}
      `;
      console.log(
        `[maintenance] login_attempts_ttl removed ${attempts.count} attempts, ${counters.count} counters`,
      );
    },
    'rag.index_file': async (payload) => {
      const input = z.object({ fileId: z.string().min(1) }).parse(payload);
      await indexUploadedFile(deps.sql, input.fileId);
    },
    'org.cleanup_files': async (payload) => {
      const input = orgCleanupSchema.parse(payload);
      const configRoot = process.env.TALE_CONFIG_DIR;
      if (!configRoot) {
        throw new Error(
          'TALE_CONFIG_DIR is unset — cannot clean up the org config subtree',
        );
      }
      // Guarded two-phase rename-then-delete (slug validation, traversal +
      // symlink defenses) — reused from the 0.4 module unchanged.
      await removeOrgSubtree(configRoot, input.orgSlug);
    },
    'automation.step': async (payload) => {
      const input = z
        .object({ organizationId: z.string().min(1), runId: z.string().min(1) })
        .parse(payload);
      // The REUSED 0.4 stepper on the ctx shim. Claim-fenced and idempotent:
      // a retried job either wins a fresh claim or no-ops.
      const shim = createCtxShim(automationShimHandlers(deps.sql));
      await stepRunImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 stepper; every ctx facility it touches is covered by automationShimHandlers
        shim as unknown as Parameters<typeof stepRunImpl>[0],
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runId is the row id; the Convex Id type is a branded string
        input as unknown as Parameters<typeof stepRunImpl>[1],
      );
    },
    'automation.trigger_scan': async () => {
      const result = await scanScheduledTriggers(deps.sql);
      if (result.fired > 0) {
        console.log(
          `[automations] trigger scan fired ${result.fired}/${result.examined}`,
        );
      }
    },
    'automation.liveness': async () => {
      const swept = await sweepOverdueRuns(deps.sql);
      if (swept > 0) {
        console.log(`[automations] liveness sweep re-poked ${swept} runs`);
      }
    },
    'task.agent_turn': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          execId: z.string().min(1),
        })
        .parse(payload);
      const runs = await deps.sql<
        {
          taskId: string;
          agentId: string;
          sessionId: string;
          harness: string;
          model: string;
          modelProvider: string | null;
          feedback: string | null;
          deadlineAt: number;
          status: string;
          execId: string;
        }[]
      >`
        SELECT task_id AS "taskId", agent_id AS "agentId",
               session_id AS "sessionId", harness, model,
               model_provider AS "modelProvider", feedback,
               deadline_at_ms::float8 AS "deadlineAt", status,
               exec_id AS "execId"
        FROM app.project_agent_runs
        WHERE id = ${input.runId} AND org_id = ${input.organizationId}
        LIMIT 1
      `;
      const run = runs[0];
      if (!run || run.status !== 'queued' || run.execId !== input.execId) {
        console.warn(
          `[task-agent] turn job for ${input.execId} skipped (run ${run?.status ?? 'gone'})`,
        );
        return;
      }
      const agents = await deps.sql<
        {
          instructions: string | null;
          skills: string[];
          connectors: string[];
          tools: string[];
          secrets: string[];
        }[]
      >`
        SELECT instructions, skills, connectors, tools, secrets
        FROM app.project_agents
        WHERE id = ${run.agentId} AND org_id = ${input.organizationId}
        LIMIT 1
      `;
      const agent = agents[0];
      if (!agent) {
        console.warn(
          `[task-agent] turn job for ${input.execId} skipped (agent gone)`,
        );
        return;
      }
      // The REUSED 0.4 turn host on the ctx shim — the whole start: session
      // ensure, staging, key mint, exec, drain, settle choreography.
      const shim = createCtxShim(agentTurnShimHandlers(deps.sql));
      await startTaskAgentTurnImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by agentTurnShimHandlers
        shim as unknown as Parameters<typeof startTaskAgentTurnImpl>[0],
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- row ids are the branded Convex Id types' runtime shape (strings)
        {
          organizationId: input.organizationId,
          runId: input.runId,
          taskId: run.taskId,
          agentId: run.agentId,
          execId: input.execId,
          sessionId: run.sessionId,
          harness: run.harness,
          deadlineAt: run.deadlineAt,
          model: run.model,
          ...(run.modelProvider !== null
            ? { modelProvider: run.modelProvider }
            : {}),
          ...(agent.instructions !== null
            ? { instructions: agent.instructions }
            : {}),
          skills: agent.skills,
          connectors: agent.connectors,
          tools: agent.tools,
          secrets: agent.secrets,
          ...(run.feedback !== null ? { feedback: run.feedback } : {}),
        } as unknown as Parameters<typeof startTaskAgentTurnImpl>[1],
      );
    },
    'automation.poll': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          seq: z.number().int(),
          pollMs: z.number().int().min(1),
        })
        .parse(payload);
      await pollParkedRun(deps.sql, input);
    },
  };
}
