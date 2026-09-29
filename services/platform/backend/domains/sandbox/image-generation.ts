import type { Sql, TransactionSql } from 'postgres';

import {
  AUTOMATION_SUBJECT_ID,
  isAutomationSubject,
} from '../../../lib/shared/constants/usage.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import {
  findBudgetViolation,
  loadBudgetSubject,
  type OrgBudgetSubject,
} from '../governance/budget-gate.ts';
import { budgetRefusalMessage } from '../governance/budget-refusal.ts';
import { readInFlightReservations } from '../governance/budget-reservations.ts';
import { incrementUsageLedger } from '../governance/service.ts';
import {
  resolveSessionOpAttribution,
  type SessionOpAttribution,
} from './op-attribution.ts';

/**
 * The Postgres side of the `generate_image` workspace tool
 * (`core/node_only/sandbox/workspace_image_tool.ts`): whose turn a call
 * belongs to, whether a budget cap still has room, and the ledger booking —
 * the seams the tool dispatch reaches through the sandbox tool shim.
 *
 * The person is the run's starter, read through the one resolver the
 * managed turns book their own spend with (`resolveSessionOpAttribution`),
 * so a turn's images and its tokens land under the same person and agent
 * (`domains/governance/README.md`); a run a trigger started books under
 * `__automation__`.
 */

/** The billing subject of one generation, as the tool carries it. */
export interface ImageSubject {
  userId: string;
  agentSlug?: string;
  apiKeyId?: string;
}

export type ImageTurnContext =
  | { status: 'live'; outputDir: string; subject: ImageSubject }
  | { status: 'ended' };

function subjectOf(attribution: SessionOpAttribution | null): ImageSubject {
  if (attribution === null || attribution.userId === '') {
    // No person started this work: the spend is nobody's, booked under the
    // sentinel and measured against the organization's caps alone.
    return { userId: AUTOMATION_SUBJECT_ID };
  }
  return {
    userId: attribution.userId,
    ...(attribution.agentSlug !== undefined
      ? { agentSlug: attribution.agentSlug }
      : {}),
    ...(attribution.apiKeyId !== undefined
      ? { apiKeyId: attribution.apiKeyId }
      : {}),
  };
}

/**
 * The turn a token names, if it is still running: a task run must be live
 * on that exec (queued or running) and delivers into its task's own box; an
 * automation agent step's op must still be running and delivers into the
 * run's `/agent/output`. Anything else has ended — a token that outlives its
 * run generates nothing.
 */
export async function resolveImageTurnContext(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sessionId: string;
    kind: 'task-agent' | 'workflow-agent';
    execId: string;
  },
): Promise<ImageTurnContext> {
  let outputDir: string;
  if (args.kind === 'task-agent') {
    const runs = await sql<{ taskId: string }[]>`
      SELECT task_id AS "taskId"
      FROM app.project_agent_runs
      WHERE org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND exec_id = ${args.execId}
        AND status IN ('queued', 'running')
      ORDER BY seq DESC
      LIMIT 1
    `;
    const run = runs[0];
    if (run === undefined) return { status: 'ended' };
    outputDir = `/agent/output/${run.taskId}`;
  } else {
    const ops = await sql<{ id: string }[]>`
      SELECT id
      FROM app.sandbox_session_ops
      WHERE org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND exec_id = ${args.execId}
        AND kind = 'workflow-agent'
        AND status = 'running'
        AND finalized_at_ms IS NULL
      LIMIT 1
    `;
    if (ops.length === 0) return { status: 'ended' };
    outputDir = '/agent/output';
  }
  const attribution = await resolveSessionOpAttribution(sql, args);
  return { status: 'live', outputDir, subject: subjectOf(attribution) };
}

/**
 * Whether `images` more generations fit under every cap that binds the
 * subject — the person as they are now (teams, role), or for nobody's spend
 * the organization's caps and the key's. Counts what every OTHER piece of
 * work in flight holds (this turn's own gateway hold is not image spend),
 * and each image as one request, so a request cap reads as an image cap.
 */
export async function checkImageGenerationBudget(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    subject: ImageSubject;
    images: number;
  },
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const apiKey =
    args.subject.apiKeyId !== undefined
      ? { apiKeyId: args.subject.apiKeyId }
      : {};
  const subject: OrgBudgetSubject =
    args.subject.userId === '' || isAutomationSubject(args.subject.userId)
      ? {
          organizationId: args.organizationId,
          userId: args.subject.userId,
          userTeamIds: [],
          impersonal: true,
          ...apiKey,
        }
      : await loadBudgetSubject(sql, {
          organizationId: args.organizationId,
          userId: args.subject.userId,
          ...apiKey,
        });
  const violation = await findBudgetViolation(sql, subject, {
    reservations: await readInFlightReservations(sql, subject, {
      op: { sessionId: args.sessionId, execId: args.execId },
    }),
    // The gate refuses at `used + prospective >= cap`, the first image being
    // the request it measures: room for N images is N - 1 more.
    prospectiveRequests: Math.max(0, args.images - 1),
  });
  if (violation === null) return { allowed: true };
  return { allowed: false, message: budgetRefusalMessage(violation) };
}

/** Book one generated image under the turn's person and agent. */
export async function recordImageGenerationUsage(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    subject: ImageSubject;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    timestamp: number;
  },
): Promise<void> {
  await incrementUsageLedger(sql, {
    organizationId: args.organizationId,
    userId: args.subject.userId,
    ...(args.subject.agentSlug !== undefined
      ? { agentSlug: args.subject.agentSlug }
      : {}),
    ...(args.subject.apiKeyId !== undefined
      ? { apiKeyId: args.subject.apiKeyId }
      : {}),
    provider: args.provider,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    costEstimateCents: args.costCents,
    timestamp: args.timestamp,
  });
}

/** The three seams, by the names the tool dispatch addresses them with. */
export function imageGenerationShimHandlers(sql: Sql): ShimHandlers {
  return {
    'sandbox/image_generation:getImageTurnContext': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof resolveImageTurnContext>[1];
      return resolveImageTurnContext(sql, args);
    },
    'sandbox/image_generation:checkImageGenerationBudget': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof checkImageGenerationBudget>[1];
      return checkImageGenerationBudget(sql, args);
    },
    'sandbox/image_generation:recordImageGenerationUsage': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof recordImageGenerationUsage>[1];
      await recordImageGenerationUsage(sql, args);
      return null;
    },
  };
}
