import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import {
  composeTaskBrief,
  NATIVE_DELIVERY,
  nativeInputsBlock,
} from '../../../lib/agent/task-brief.ts';
import { taskAgentFor } from '../../../lib/agent/task-persona.ts';
import type { TurnOutcome, TurnStore } from '../../../lib/chat/turn.ts';
import { agentLanguageGuidance } from '../../../lib/shared/agent-language.ts';
import {
  type ChatErrorCode,
  classifyChatErrorCode,
  describeChatError,
} from '../../../lib/shared/chat-errors.ts';
import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import { executeTurn } from '../../core/chat/turn_action.ts';
import { SkillUnavailableError } from '../../core/skills/skill_unavailable_error.ts';
import { buildSettleComments } from '../../core/tasks/settle_comments.ts';
import { classifyStartFailure } from '../../core/tasks/start_failure.ts';
import type { TaskRunFailureCode } from '../../core/tasks/task_auto_retry.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { assertChatTurnBudget } from '../chat/budget-admission.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { createPgTurnStore, createPgUsageLedger } from '../chat/store.ts';
import { embeddingMeter } from '../knowledge/embedding-meter.ts';
import { eligibleProjectAgentHarnesses } from '../projects/service.ts';
import { releaseLightSession } from '../sandbox/light-sessions.ts';
import { loadAgentLanguageContext } from './agent-language.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import {
  type AgentRunHandoff,
  failAgentRunFromTurn,
  launchAgentRun,
} from './agent-runs.ts';
import { agentRunWorkDeadline } from './agent-workers.ts';
import {
  attachRunThread,
  listRunFiles,
  moveRunToHarnessInTx,
} from './native-runs.ts';
import { missingEquippedSkills, nativeWorkTools } from './native-work-tools.ts';
import { readTaskBrief } from './task-brief-read.ts';

/**
 * A task run on the native engine — the same loop a chat reply runs on,
 * working a task.
 *
 * `executeTurn` is the one engine: the person's model access, the guardrail
 * chain, the retrieval tools, the work tools, the loop with its holds and its
 * ledger. This host brings a task to it: the run's own transcript thread to
 * write into, the task's brief as the message, the project agent as the
 * persona, the task's files and the agent's equipped skills as what the work
 * tools reach. It acts for the person who started the run, scoped to the
 * run's project — the identity a chat tool has, so nothing a chat could not
 * do is done.
 *
 * It then settles the run exactly as a harness run settles: the files the
 * tools made become the task's deliverables, the closing message is the
 * report posted to the task, and the task moves to review. A run that needs
 * more than the light tier — a repository, a browser, hours — hands itself to
 * the agent's harness with a brief (`use_workspace`), and the harness carries
 * on from the files already delivered.
 *
 * A native run starts only for a person's own door and only for an agent
 * the engine can serve in full; anything else is routed to the harness here,
 * before anything runs.
 */

export interface NativeTurnInput {
  organizationId: string;
  runId: string;
  execId: string;
}

export interface NativeTurnOptions {
  /** The job's shutdown signal: a worker being stopped ends the turn. */
  signal?: AbortSignal;
  /** The engine that runs the turn — `executeTurn`. A probe over a real
   * database passes a scripted one, so the whole host (gate, launch,
   * transcript, work tools, settle) runs without a model. */
  engine?: typeof executeTurn;
}

/** The longest a native run works, however many rounds it takes. A turn is
 * twelve tool rounds at most, each a model call and a sandbox call of up to
 * three minutes, so this is a ceiling a healthy run never meets. */
const NATIVE_TURN_MAX_MS = 50 * 60_000;

interface NativeRun {
  taskId: string;
  agentId: string;
  projectId: string;
  startedBy: string;
  apiKeyId: string | null;
  harness: string;
  model: string;
  modelProvider: string | null;
  feedback: string | null;
  mentionSource: 'comment' | 'description' | null;
  deadlineAt: number;
  startedAt: number;
  launchedAt: number | null;
  status: string;
  execId: string;
  engine: string;
}

interface NativeAgent {
  instructions: string | null;
  skills: string[];
  connectors: string[];
  tools: string[];
  secrets: string[];
}

/** Why a native run ended without a report. */
export interface NativeFailure {
  code: TaskRunFailureCode;
  reason: string;
}

const FAILURE_BY_CHAT_ERROR: Partial<
  Record<ChatErrorCode, TaskRunFailureCode>
> = {
  // A cap that binds the starter is used up: nothing about a retry changes it.
  budget_exceeded: 'budget_exceeded',
  // The model is overloaded: the retry waits a minute, as a harness run's does.
  rate_limited: 'model_capacity',
  // The agent's model is gone or not licensed: configuration, not a fault.
  model_not_found: 'agent_model_missing',
  model_not_entitled: 'agent_model_missing',
  thread_busy: 'turn_crashed',
};

/**
 * What a failed native turn is, as a run's failure code and reason: the
 * classification a chat reply's error gets, mapped onto the codes the run
 * ledger and its auto-retry know. Every provider failure retries by default;
 * the ones a retry cannot change do not.
 */
export function classifyNativeFailure(error: unknown): NativeFailure {
  const reason = describeChatError(error, 'the model response failed');
  const chat = classifyChatErrorCode(error);
  return {
    code: FAILURE_BY_CHAT_ERROR[chat] ?? 'harness_error',
    reason,
  };
}

/** The failure a turn that ended without answering is: what refused it, and
 * where. */
export function failureOfRefusal(
  outcome: Extract<TurnOutcome, { status: 'refused' }>,
): NativeFailure {
  if (
    outcome.step === 'input-guardrails' ||
    outcome.step === 'output-guardrails'
  ) {
    // Before the pipeline wrote anything, a refusal is the person's model
    // access or the like; once it wrote, it is a guardrail of the organization.
    return outcome.persisted
      ? { code: 'policy_refused', reason: outcome.reason }
      : { code: 'agent_model_missing', reason: outcome.reason };
  }
  return classifyNativeFailure(outcome.reason);
}

/**
 * The message the turn opens with: the task's brief, worded for an engine
 * whose tools read files by ref and deliver files by making them.
 */
export function nativeTaskPrompt(args: {
  brief: Awaited<ReturnType<typeof readTaskBrief>> & object;
  feedback: string | null;
  mentionSource: 'comment' | 'description' | null;
}): string {
  const { brief } = args;
  // A description mention carries no copy of its own: the brief's description
  // IS what named the agent, read as it stands now.
  const feedback =
    args.mentionSource === 'description'
      ? undefined
      : (args.feedback ?? undefined);
  const inputs = nativeInputsBlock({
    attachments: brief.attachments.map((file) => ({
      ref: file.fileId,
      name: file.fileName,
    })),
    outputs: brief.outputs.map((file) => ({
      ref: file.fileId,
      name: file.fileName,
    })),
  });
  return composeTaskBrief({
    brief,
    ...(feedback !== undefined ? { feedback } : {}),
    ...(inputs !== undefined ? { inputsBlock: inputs } : {}),
    delivery: NATIVE_DELIVERY,
  });
}

async function loadRun(
  sql: Sql,
  input: NativeTurnInput,
): Promise<NativeRun | null> {
  const rows = await sql<NativeRun[]>`
    SELECT task_id AS "taskId", agent_id AS "agentId",
           project_id AS "projectId", started_by AS "startedBy",
           api_key_id AS "apiKeyId", harness, model,
           model_provider AS "modelProvider", feedback,
           mention_source AS "mentionSource",
           deadline_at_ms::float8 AS "deadlineAt",
           started_at_ms::float8 AS "startedAt",
           launched_at_ms::float8 AS "launchedAt", status,
           exec_id AS "execId", engine
    FROM app.project_agent_runs
    WHERE id = ${input.runId} AND org_id = ${input.organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadAgent(
  sql: Sql,
  organizationId: string,
  agentId: string,
): Promise<NativeAgent | null> {
  const rows = await sql<NativeAgent[]>`
    SELECT instructions, skills, connectors, tools, secrets
    FROM app.project_agents
    WHERE id = ${agentId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Whether the run is still the live one this exec owns. */
async function runIsLive(sql: Sql, input: NativeTurnInput): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE id = ${input.runId} AND org_id = ${input.organizationId}
      AND exec_id = ${input.execId} AND status = 'running'
  `;
  return rows.length > 0;
}

/**
 * The run's turn store: the chat's, over the run's transcript thread, with
 * one addition. A Stop (or a move of the task) that landed before the turn's
 * generation row existed had no flag to set; the open checks the run once
 * its row is there and, when the run is no longer live, sets the flag itself
 * — so the turn ends at its first boundary instead of working for nobody.
 */
function runTurnStore(sql: Sql, input: NativeTurnInput): TurnStore {
  const base = createPgTurnStore(sql);
  return {
    ...base,
    async beginTurn(setup) {
      const opened = await base.beginTurn(setup);
      if (!(await runIsLive(sql, input))) {
        await sql`
          UPDATE app.generations SET cancel_requested = true
          WHERE thread_id = ${setup.threadId}
            AND org_id = ${setup.organizationId}
        `;
      }
      return opened;
    },
  };
}

/**
 * Run one native task run to its end. The job's whole body: the gate, the
 * turn, the settle. At-most-once like a chat reply — the turn spends, and a
 * lost job is the watchdog's to fail, never a second run of the same exec.
 */
export async function runNativeAgentTurn(
  sql: Sql,
  input: NativeTurnInput,
  options: NativeTurnOptions = {},
): Promise<void> {
  const run = await loadRun(sql, input);
  if (
    run === null ||
    run.status !== 'queued' ||
    run.execId !== input.execId ||
    run.engine !== 'native'
  ) {
    console.warn(
      `[task-agent] native turn for ${input.execId} skipped (run ${run?.status ?? 'gone'}${run !== null && run.engine !== 'native' ? `, ${run.engine}` : ''})`,
    );
    return;
  }
  const fail = (failure: NativeFailure): Promise<boolean> =>
    failAgentRunFromTurn(sql, {
      runId: input.runId,
      execId: input.execId,
      error: failure.reason,
      failureCode: failure.code,
    });

  const agent = await loadAgent(sql, input.organizationId, run.agentId);
  if (agent === null) {
    await fail({
      code: 'agent_deleted',
      reason: 'the agent no longer exists',
    });
    return;
  }
  const userId = runStarterUserId(run.startedBy);
  // The engine acts for a person and serves what a chat can: an agent that
  // needs connectors, tools or secrets, or a run no person started, goes to
  // the harness, which serves all of them.
  if (
    userId === null ||
    agent.connectors.length > 0 ||
    agent.tools.length > 0 ||
    agent.secrets.length > 0
  ) {
    await sql.begin((tx) =>
      moveRunToHarnessInTx(tx, {
        organizationId: input.organizationId,
        runId: input.runId,
        execId: input.execId,
      }),
    );
    return;
  }

  // The agent's equipment is the same on both engines: a skill it equips and
  // cannot reach fails the run as configuration, not as a fault.
  const missing = await missingEquippedSkills(sql, {
    organizationId: input.organizationId,
    agentId: run.agentId,
    skills: agent.skills,
  });
  if (missing[0] !== undefined) {
    const failure = classifyStartFailure(new SkillUnavailableError(missing[0]));
    await fail({ code: failure.failureCode, reason: failure.reason });
    return;
  }

  const launched = await launchAgentRun(sql, {
    runId: input.runId,
    execId: input.execId,
    deadlineAt: agentRunWorkDeadline(run, Date.now()),
  });
  if (!launched) {
    console.warn(
      `[task-agent] native turn for ${input.execId} lost the run before it launched`,
    );
    return;
  }

  try {
    await workRun(sql, input, { run, agent, userId }, options);
  } catch (error) {
    // The turn threw outside its own failure handling: the run must not stay
    // `running` with nobody working it.
    const failure = classifyNativeFailure(error);
    console.error(
      `[task-agent] native turn for ${input.execId} crashed:`,
      error,
    );
    await fail({
      code: failure.code === 'harness_error' ? 'turn_crashed' : failure.code,
      reason: failure.reason,
    });
  } finally {
    // A finished run has no later call to reuse its light sandbox: give the
    // organization's light budget back now, not after the idle window.
    await releaseLightSession(sql, {
      organizationId: input.organizationId,
      ownerKey: input.runId,
    });
  }
}

async function workRun(
  sql: Sql,
  input: NativeTurnInput,
  context: { run: NativeRun; agent: NativeAgent; userId: string },
  options: NativeTurnOptions,
): Promise<void> {
  const { run, agent, userId } = context;
  const fail = (failure: NativeFailure): Promise<boolean> =>
    failAgentRunFromTurn(sql, {
      runId: input.runId,
      execId: input.execId,
      error: failure.reason,
      failureCode: failure.code,
    });

  const brief = await readTaskBrief(sql, run.taskId);
  if (brief === null) {
    // The task is gone: its retirement cancelled this run with it.
    console.warn(`[task-agent] native turn for ${input.execId}: task is gone`);
    return;
  }
  const threadId = await attachRunThread(sql, {
    organizationId: input.organizationId,
    runId: input.runId,
    execId: input.execId,
    userId,
    title: brief.title,
  });
  if (threadId === null) {
    console.warn(
      `[task-agent] native turn for ${input.execId} lost the run before its transcript opened`,
    );
    return;
  }

  try {
    await assertChatTurnBudget(sql, {
      organizationId: input.organizationId,
      userId,
      ...(run.apiKeyId !== null ? { apiKeyId: run.apiKeyId } : {}),
      threadId,
      projectIds: [run.projectId],
    });
  } catch (error) {
    await fail(classifyNativeFailure(error));
    return;
  }

  const language = await loadAgentLanguageContext(sql, {
    organizationId: input.organizationId,
    taskId: run.taskId,
    projectIds: [run.projectId],
  });
  // The hand-over the model may ask for; honoured once the turn has ended.
  let handoff: AgentRunHandoff | undefined;
  const canHandOver = eligibleProjectAgentHarnesses().includes(run.harness);
  const deadline = AbortSignal.timeout(NATIVE_TURN_MAX_MS);
  const signal =
    options.signal !== undefined
      ? AbortSignal.any([options.signal, deadline])
      : deadline;

  const shim = createCtxShim(chatShimHandlers(sql));
  const engine = options.engine ?? executeTurn;
  let outcome: TurnOutcome;
  try {
    outcome = await engine(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused chat host; every ctx facility it touches is covered by chatShimHandlers
      shim as unknown as Parameters<typeof executeTurn>[0],
      {
        organizationId: input.organizationId,
        userId,
        ...(run.apiKeyId !== null ? { apiKeyId: run.apiKeyId } : {}),
        threadId,
        expectedProjectId: run.projectId,
        userText: nativeTaskPrompt({
          brief,
          feedback: run.feedback,
          mentionSource: run.mentionSource,
        }),
        modelId: run.model,
        ...(run.modelProvider !== null
          ? { providerSlug: run.modelProvider, providerStrict: true }
          : {}),
        locale: language.defaultLocale,
      },
      {
        deps: {
          store: runTurnStore(sql, input),
          usage: createPgUsageLedger(sql),
        },
        meterEmbeddings: (subject) =>
          embeddingMeter(sql, {
            organizationId: input.organizationId,
            subject,
          }),
        workTools: () =>
          nativeWorkTools(sql, {
            organizationId: input.organizationId,
            projectId: run.projectId,
            agentId: run.agentId,
            userId,
            ...(run.apiKeyId !== null ? { apiKeyId: run.apiKeyId } : {}),
            runId: input.runId,
            threadId,
            skills: agent.skills,
            taskFiles: [...brief.attachments, ...brief.outputs],
            ...(canHandOver
              ? {
                  escalation: {
                    request: (request) => {
                      handoff = request;
                      return Promise.resolve({ accepted: true as const });
                    },
                  },
                }
              : {}),
          }),
        persona: (loadout) =>
          taskAgentFor({
            agentId: run.agentId,
            instructions: agent.instructions,
            loadout: loadout ?? {
              createFile: false,
              generateImage: false,
              skills: false,
              runCode: false,
            },
            language: agentLanguageGuidance(language),
          }),
        // The person's own standing instructions are theirs in a chat with
        // the assistant; an agent working a task for its project carries
        // none of them.
        personalContext: false,
        signal,
      },
    );
  } catch (error) {
    await fail(classifyNativeFailure(error));
    return;
  }

  if (outcome.status === 'refused') {
    await fail(failureOfRefusal(outcome));
    return;
  }
  if (outcome.cancelled === true) {
    // A Stop or a move of the task already ended the run, and this finds it
    // so (a no-op); a worker being stopped, or the time limit, did not.
    await fail(
      deadline.aborted
        ? {
            code: 'deadline',
            reason: 'the agent run ran past its time limit and was stopped',
          }
        : {
            code: 'turn_crashed',
            reason: 'the worker stopped while the agent was working',
          },
    );
    return;
  }

  const files = await listRunFiles(sql, {
    organizationId: input.organizationId,
    threadId,
  });
  if (handoff !== undefined) {
    const execId = await sql.begin((tx) =>
      moveRunToHarnessInTx(tx, {
        organizationId: input.organizationId,
        runId: input.runId,
        execId: input.execId,
        // The hand-over is only ever recorded for a run that can make it.
        handoff,
        files,
      }),
    );
    if (execId === null) {
      console.warn(
        `[task-agent] native turn for ${input.execId} lost the run before its hand-over`,
      );
    }
    return;
  }

  const resultText = outcome.text.trim();
  if (resultText === '' && files.length === 0) {
    await fail({
      code: 'empty_turn',
      reason: 'the agent finished without a report or a file',
    });
    return;
  }
  const comments = buildSettleComments({
    resultText,
    fileNames: files.map((file) => file.fileName),
    skipped: [],
  });
  await transactSerializable(sql, (tx) =>
    completeAgentRunInTx(tx, {
      organizationId: input.organizationId,
      taskId: run.taskId,
      agentId: run.agentId,
      runId: input.runId,
      execId: input.execId,
      files,
      ...comments,
      resultText,
    }),
  );
}
