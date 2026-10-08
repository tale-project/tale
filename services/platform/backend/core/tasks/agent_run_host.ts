'use node';

/**
 * The live lane for TASK agent runs — the task-side twin of the automation
 * `agent_host`. A project agent assigned to a task runs one harness turn in
 * its STANDING sandbox session (`sessionIdForProjectAgent` — the workspace
 * persists across runs, so the agent keeps working state between
 * assignments). The public kick (`tasks/mutations.startTaskAgentRun`) inserts
 * the queued `taskAgentRuns` row and schedules the start here; the
 * self-chaining drive re-attaches in short windows through the shared
 * `drainHarnessWindow` core; the settle harvests `/agent/output`, revokes the
 * turn's gateway key, posts the result as an agent task comment, and parks
 * the task at `in_review` (agents never complete work — the hard rule
 * `agentUpdateTaskStatus` enforces). A failed run keeps the task at
 * `in_progress`: failure is the RUN's state, and the run card offers Retry.
 */

import { randomBytes } from 'node:crypto';

import { buildStdinUserMessage } from '../../../lib/harnesses/parsers/claude-stream-json';
import { isHarnessSlug } from '../../../lib/harnesses/types';
import { agentLanguageGuidance } from '../../../lib/shared/agent-language';
import type { TaskCommentBodies } from '../../../lib/shared/schemas/task-comment';
import {
  liveProgressSink,
  releaseTurnKey,
  stageWorkflowSkills,
} from '../automations/agent_host';
import {
  buildExternalTurnExec,
  classifyHarnessEnd,
  harnessRequiresSubscriptionAccountId,
  isSpendRefusal,
  spendRefusalReason,
  drainHarnessWindow,
  connectorsBridgeUrlForSessions,
  harnessMountsMcp,
  harnessResumesConversations,
  resolveHarnessTurnContextWindow,
  type ExternalTurnServing,
} from '../chat/external_turn_shared';
import { readMandatoryInstructions } from '../chat/guardrails';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { loadHarnesses } from '../lib/providers/load_system_config';
import { resolveTurnImageGeneration } from '../lib/providers/resolve_image_model';
import { resolveTurnVisionModel } from '../lib/providers/resolve_vision_model';
import {
  refuseBlindImageTurn,
  visionUnreadableGuidance,
} from '../lib/providers/subscription_vision';
import type { Id } from '../lib/rows';
import { safePathSegment } from '../lib/safe_path_segment';
import { ensureAgentSession } from '../node_only/sandbox/agent_session';
import {
  isDestroyPendingRefusal,
  queuedWakeAfterMs,
  sandboxCapacityRefusal,
  type CapacityRefusal,
} from '../node_only/sandbox/capacity_refusal';
import type { TurnConnectorCaller } from '../node_only/sandbox/connectors_bridge';
import { provisionSessionGatewayKey } from '../node_only/sandbox/gateway_provisioning';
import {
  isSessionExecLimitResult,
  SessionExecLimitError,
  sessionCancelExec,
  sessionDeleteFiles,
  sessionExecStatus,
  sessionListFiles,
  sessionStageFiles,
  sessionWriteExecStdin,
  type SessionStageFile,
} from '../node_only/sandbox/helpers/session_client';
import { stageUrlForBlobRef } from '../node_only/sandbox/helpers/stage_url';
import {
  hashVirtualKey,
  resolveGatewayRouting,
} from '../node_only/sandbox/llm_gateway_admin';
import { stageBlobCacheKey } from '../node_only/sandbox/managed_stage';
import {
  harvestSessionOutput,
  type HarvestSkippedOutput,
  OUTPUT_DIR,
} from '../node_only/sandbox/session_exec';
import {
  readReserveTurnBudgetResult,
  TurnBudgetExceededError,
} from '../node_only/sandbox/turn_budget';
import { resolveTurnEquipmentEnv } from '../node_only/sandbox/turn_equipment';
import type { BrokerTransportScope } from '../provider_credentials/broker_transport';
import {
  credentialRetryAtMs,
  resolveProviderCredential,
  runFailureMessage,
} from '../provider_credentials/resolve_credential';
import {
  agentWorkTurnDeadlineMs,
  workflowAgentBudgetCents,
} from '../sandbox/agent_deadline';
import { AWAITING_ROOM_RESULT_STATUS } from '../sandbox/session_constants';
import {
  grantedToolsGuidance,
  IMAGE_GENERATION_TOOL,
  imageGenerationGuidance,
  KNOWLEDGE_READ_TOOLS,
  KNOWLEDGE_TOOLS_GUIDANCE,
  memberRunGuidance,
  normalizeToolGrants,
  secretsGuidance,
} from '../sandbox/tool_names';
import { TASK_COMMENT_MAX } from './helpers';
import type { MentionSource } from './mentions';
import { classifyStartFailure } from './start_failure';
import {
  isCredentialRotation,
  type TaskRunFailureCode,
} from './task_auto_retry';
import {
  isTaskInputMissingError,
  TaskInputMissingError,
} from './task_input_missing_error';
import { isValidResumeHandle } from './task_kick_resume';
import { resolveTaskServing, type TaskServing } from './task_serving';

/** The workspace line of a run in the agent's standing session. */
const STANDING_WORKSPACE_GUIDANCE = `Your workspace (/agent/workspace) is a standing area shared across ALL tasks assigned to you — files already there may belong to other tasks. Trust the task brief and its staged inputs over anything found lying around.`;

/** The workspace line of a run a member started: its workspace is the
 * member's own with this agent, kept apart from the standing one. */
const MEMBER_WORKSPACE_GUIDANCE = `Your workspace (/agent/workspace) is kept for the runs this member starts with you — files already there may belong to their other tasks. Trust the task brief and its staged inputs over anything found lying around.`;

/**
 * Whether the turn is confined to its own task — a run a member started
 * (`domains/tasks/run-authority.ts`): it gets none of the agent's secrets
 * or brokered credentials. Judged at every launch and steer restart; a run
 * the question cannot be answered for is treated as confined, since a
 * credential gap only downgrades a turn.
 */
async function isTurnConfined(
  ctx: ActionCtx,
  runId: Id<'projectAgentRuns'>,
): Promise<boolean> {
  const authority: { confined: boolean } | null = await ctx.runQuery(
    internal.tasks.agent_runs.getTaskAgentRunAuthority,
    { runId },
  );
  return authority?.confined !== false;
}

/** The agent's credentials a confined run goes without, by the names the
 * model would look for. */
function withheldCredentials(args: {
  secrets: readonly string[];
  connectors: readonly string[];
}): string[] {
  return [
    ...args.secrets,
    ...(args.connectors.includes('github') ? ['GITHUB_TOKEN'] : []),
  ];
}

interface TurnKeys {
  organizationId: string;
  runId: Id<'projectAgentRuns'>;
  taskId: Id<'tasks'>;
  agentId: Id<'projectAgents'>;
  execId: string;
  sessionId: string;
  harness: string;
  deadlineAt: number;
  sessionCreatedAt?: number;
}

/**
 * Ensure the agent's standing sandbox session exists (AGENT profile), with
 * shared admission and recovery. Unlike the per-run workflow
 * session it is NEVER torn down here — idle stop-and-preserve owns its
 * lifecycle. Returns the live row's `createdAt` — the incarnation stamp the
 * `--resume` binds-check compares — or undefined when this call had to mint
 * a brand-new row (a fresh incarnation holds no prior conversation).
 */
async function ensureProjectAgentSession(
  ctx: ActionCtx,
  organizationId: string,
  agentId: string,
  sessionId: string,
  harness: string,
): Promise<{ liveCreatedAt: number | undefined }> {
  return ensureAgentSession(ctx, {
    organizationId,
    sessionId,
    owner: { type: 'project_agent', agentId },
    agentKind: harness,
  });
}

/** The task's own delivery box inside the agent's STANDING session — the
 * subject-scoped subdir the turn's instructions name, the start sweep
 * clears, and the settle harvests. Scoped per task because the session is
 * per AGENT: without it, concurrent or successive runs of the agent's other
 * tasks would share one box and cross-attach deliverables. */
function taskOutputDir(taskId: string): string {
  return `${OUTPUT_DIR}/${taskId}`;
}

/** The task's read-only INPUTS mirror — where the start stages the user's
 * attachments and the task's current deliverables before every turn, resumed
 * or fresh (attachments and outputs may have changed since the last run
 * either way). Without it a rerun asked to "extend the deck" cannot reliably
 * see the deck it is extending — the delivery box may have been swept, and
 * the shared standing workspace holds other tasks' stale files. Outside
 * `/agent/output` so the box sweep and the settle harvest never touch it. */
function taskInputsDir(taskId: string): string {
  return `/agent/inputs/${taskId}`;
}

/** Whether a LOOSE file at the box root (`/agent/output/` itself — never
 * harvested, contract-violating scratch or legacy junk) is old enough for
 * the start sweep to clear. Age-gated on the agent-turn deadline because
 * the standing session is shared: a concurrent sibling task's live turn may
 * be writing there against instructions, and its files are always younger
 * than its own deadline — hygiene must not race a running turn. Exported
 * for its unit test. */
function isStaleLooseBoxFile(
  entry: { mtimeMs: number },
  nowMs: number,
): boolean {
  return nowMs - entry.mtimeMs > agentWorkTurnDeadlineMs();
}

/** Flatten a stored file name into a single safe path segment for the inputs
 * mirror and dedupe collisions. Attachment names are user input and only
 * length-capped at write time, so separators and dot-tricks must die here
 * (via the shared `safePathSegment`) — a traversal that survived would land
 * inside /agent under an attacker-chosen path. Exported for its unit test. */
function safeInputFileName(raw: string, taken: Set<string>): string {
  const name = safePathSegment(raw);
  let candidate = name;
  for (let suffix = 2; taken.has(candidate); suffix += 1) {
    candidate = `${suffix}-${name}`;
  }
  taken.add(candidate);
  return candidate;
}

/** What `stageTaskInputs` actually landed, for the prompt to name. */
export interface StagedTaskInputs {
  dir: string;
  attachments: string[];
  outputs: string[];
  /** Number of older task outputs retained on the task but omitted from this
   * turn's mirror. Long-lived coordinator tasks can accumulate one receipt
   * per pass, so staging the complete history would eventually make every
   * new run depend on hundreds of blob fetches. */
  omittedOutputs?: number;
}

/** Keep standing-session starts bounded when a long-lived task has accumulated
 * one receipt or deliverable per run. The task's output list remains intact;
 * only the newest entries are mirrored into this turn's read-only inputs. */
export const MAX_STAGED_TASK_OUTPUTS = 64;

export function selectTaskOutputsForStaging<T>(
  outputs: ReadonlyArray<T>,
  maxOutputs = MAX_STAGED_TASK_OUTPUTS,
): { selected: T[]; omitted: number } {
  if (maxOutputs <= 0) return { selected: [], omitted: outputs.length };
  if (outputs.length <= maxOutputs) {
    return { selected: [...outputs], omitted: 0 };
  }
  return {
    selected: outputs.slice(-maxOutputs),
    omitted: outputs.length - maxOutputs,
  };
}

/** One planned input, keyed by the path the daemon's skip report names:
 * which box it belongs to, the name it got on disk (the prompt's and
 * `StagedTaskInputs`' spelling) and the name the task shows the person. */
export interface PlannedTaskInput {
  kind: 'attachments' | 'outputs';
  stagedName: string;
  fileName: string;
}

type TaskInputSkipVerdict =
  | { kind: 'staged'; droppedOutputs: string[] }
  | { kind: 'inputs_missing'; fileNames: string[]; droppedOutputs: string[] }
  | { kind: 'failed'; message: string };

/**
 * What `sessionStageFiles` could not land, read for what it means to the
 * run. `http_404` is the blob door passing the store's own 404 through
 * (`domains/files/sandbox-blob-routes.ts`): the bytes behind a listed input
 * are gone — a deleted file row, a purge, a cleanup outside Tale. A missing
 * ATTACHMENT fails the run by the file's name: it is the person's input, a
 * run that quietly worked without it would deliver the wrong thing, and no
 * retry brings the bytes back (`TaskInputMissingError` → `input_missing`,
 * never auto-retried; whoever can change the task removes the attachment or
 * uploads it again). A missing OUTPUT — an earlier run's deliverable — is
 * dropped from the brief instead: the agent can produce it again, and nobody
 * can put the old bytes back. Any other reason (a dead staging route, a
 * refused fetch, a timeout) is an infra fault and keeps the generic failure,
 * every skip listed with its reason — the run error is the only diagnostic
 * a failed staging leaves behind, and a bare path list reads as "file gone"
 * when the real cause is the route. Exported for its unit test.
 */
export function partitionTaskInputSkips(
  skipped: ReadonlyArray<{ path: string; reason: string }>,
  planned: ReadonlyMap<string, PlannedTaskInput>,
): TaskInputSkipVerdict {
  const missingAttachments: string[] = [];
  const droppedOutputs: string[] = [];
  for (const skip of skipped) {
    const input = planned.get(skip.path);
    if (skip.reason !== 'http_404' || input === undefined) {
      return {
        kind: 'failed',
        message: `staging task inputs failed: ${skipped
          .map((entry) => `${entry.path} (${entry.reason})`)
          .join(', ')}`,
      };
    }
    if (input.kind === 'attachments') missingAttachments.push(input.fileName);
    else droppedOutputs.push(input.stagedName);
  }
  if (missingAttachments.length > 0) {
    return {
      kind: 'inputs_missing',
      fileNames: missingAttachments,
      droppedOutputs,
    };
  }
  return { kind: 'staged', droppedOutputs };
}

/**
 * Mirror the task's inputs into the standing session: the user's attachments
 * under `<dir>/attachments/`, the task's current deliverables (earlier runs'
 * harvested outputs) under `<dir>/outputs/`. Re-mirrored from scratch every
 * turn — attachments and outputs may have changed since the last run, and a
 * stale mirror would mislead worse than none. A ref of the retired `_storage`
 * backend skips that file (mirroring `stageWorkflowFiles`); what the store
 * no longer holds and what failed to stage is sorted by
 * `partitionTaskInputSkips` — a gone attachment fails the run by name, a
 * gone deliverable leaves the brief, an infra fault throws with the real
 * reason instead of quietly proceeding blind.
 */
async function stageTaskInputs(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    taskId: string;
    attachments: Array<{ fileId: string; fileName: string }>;
    outputs: Array<{ fileId: string; fileName: string }>;
  },
): Promise<StagedTaskInputs> {
  const dir = taskInputsDir(args.taskId);
  const outputSelection = selectTaskOutputsForStaging(args.outputs);
  const staged: StagedTaskInputs = {
    dir,
    attachments: [],
    outputs: [],
    ...(outputSelection.omitted > 0
      ? { omittedOutputs: outputSelection.omitted }
      : {}),
  };
  if (outputSelection.omitted > 0) {
    console.warn(
      `[task-agent] omitted ${outputSelection.omitted} older deliverables from task ${args.taskId} input staging; keeping the newest ${outputSelection.selected.length} to bound start latency`,
    );
  }
  const toStage: SessionStageFile[] = [];
  const planned = new Map<string, PlannedTaskInput>();
  for (const [kind, files] of [
    ['attachments', args.attachments],
    ['outputs', outputSelection.selected],
  ] as const) {
    const taken = new Set<string>();
    for (const file of files) {
      const url = await stageUrlForBlobRef(file.fileId, args.organizationId);
      if (url === null) continue; // a retired backend's ref — skip, don't fail
      const name = safeInputFileName(file.fileName, taken);
      const path = `${dir}/${kind}/${name}`;
      toStage.push({
        path,
        url,
        sourceId: stageBlobCacheKey(args.organizationId, file.fileId),
      });
      planned.set(path, {
        kind,
        stagedName: name,
        fileName: file.fileName === '' ? name : file.fileName,
      });
      staged[kind].push(name);
    }
  }
  const result = await sessionStageFiles(args.sessionId, toStage, {
    replaceRoots: [dir],
  });
  const verdict = partitionTaskInputSkips(result.skipped, planned);
  if (verdict.kind === 'failed') throw new Error(verdict.message);
  if (verdict.droppedOutputs.length > 0) {
    console.warn(
      `[task-agent] earlier deliverables of task ${args.taskId} are no longer in storage and were left out of the brief: ${verdict.droppedOutputs.join(', ')}`,
    );
    const dropped = new Set(verdict.droppedOutputs);
    staged.outputs = staged.outputs.filter((name) => !dropped.has(name));
  }
  if (verdict.kind === 'inputs_missing') {
    throw new TaskInputMissingError(verdict.fileNames);
  }
  if (verdict.droppedOutputs.length > 0) {
    // A missing old deliverable is allowed, but its former on-disk copy must
    // not survive. The first stage intentionally never prunes after a miss.
    const missing = new Set(result.skipped.map((file) => file.path));
    const reconciled = await sessionStageFiles(
      args.sessionId,
      toStage.filter((file) => !missing.has(file.path)),
      { replaceRoots: [dir] },
    );
    if (reconciled.skipped.length > 0) {
      throw new Error(
        `reconciling task inputs failed: ${reconciled.skipped.map((file) => file.path).join(', ')}`,
      );
    }
  }
  return staged;
}

/**
 * Who put the agent to work when no person pressed Start
 * (`domains/tasks/delegated-start.ts`): an automation's `task.start_agent`
 * step or another agent of the project. The prompt names it, and says the
 * message it passed comes from an automation or an agent — never from a
 * person's review, which a person still gives at In review.
 */
export interface KickRequester {
  kind: 'automation' | 'agent';
  /** The automation's name, or the agent's display name. */
  name: string;
}

function requesterPhrase(requester: KickRequester): string {
  return requester.kind === 'automation'
    ? `the automation "${requester.name}"`
    : `${requester.name}, another agent of this project,`;
}

/** The line that says who started a run no person started, when it carried
 * no message of its own. */
function requesterStartLine(requester: KickRequester): string {
  return (
    `This run was started by ${requesterPhrase(requester)} rather than by a ` +
    'person.'
  );
}

/** The message an automation or an agent passed, phrased as theirs: it
 * leads the work, but a person's word — the description, a comment —
 * outranks it. */
function requesterFeedbackSection(
  requester: KickRequester,
  feedbackText: string,
): string {
  return (
    `This run was started by ${requesterPhrase(requester)} with this ` +
    `message — address it before anything else:\n${feedbackText}\n\n` +
    `It comes from ${requester.kind === 'automation' ? 'an automation' : 'an agent'}, ` +
    'not from a person: where it contradicts the task description or a ' +
    "person's comment, those win."
  );
}

/** Phrase a FRESH conversation's prompt from the task brief (a bound rerun
 * resumes the previous conversation instead — `buildResumeKickPrompt`).
 * Exported for its unit test. `feedback` is the @mention comment that kicked
 * a rerun — it leads the brief's work section so the agent treats it as the
 * delta to address, not as one more line of context (the same comment closes
 * the discussion tail, so it is dropped from there rather than said twice).
 * A description mention passes none: the Description below IS what named
 * the agent, read as it stands now (`buildKickPrompts`).
 * `discussion` is a fresh conversation's only memory of earlier runs.
 * `inputs` names what `stageTaskInputs` landed, and the same-file-name rule
 * makes a revision REPLACE the task's deliverable instead of piling a
 * renamed sibling next to it. `outputDir` is the task's OWN delivery box:
 * named in the user prompt (not only the system addendum) because a resumed
 * standing-session conversation happily reuses last turn's path from memory,
 * and a deliverable written outside the box is not collected. */
export function buildTaskPrompt(
  brief: {
    title: string;
    description?: string;
    labels?: string[];
    identifier?: string;
    projectName?: string;
    discussion?: Array<{ author: 'user' | 'agent'; body: string }>;
  },
  feedback?: string,
  outputDir?: string,
  inputs?: StagedTaskInputs,
  requester?: KickRequester,
): string {
  const heading =
    brief.identifier !== undefined
      ? `You are working on task ${brief.identifier}: ${brief.title}`
      : `You are working on this task: ${brief.title}`;
  const feedbackText = feedback?.trim() ?? '';
  let discussion = brief.discussion ?? [];
  const lastEntry = discussion.at(-1);
  if (
    feedbackText !== '' &&
    lastEntry?.author === 'user' &&
    lastEntry.body.trim() === feedbackText
  ) {
    discussion = discussion.slice(0, -1);
  }
  const stagedLines = [
    ...(inputs !== undefined && inputs.attachments.length > 0
      ? [
          `- ${inputs.dir}/attachments/ — files the user attached to the task: ${inputs.attachments.join(', ')}`,
        ]
      : []),
    ...(inputs !== undefined && (inputs.omittedOutputs ?? 0) > 0
      ? [
          `- ${inputs.dir}/outputs/ contains the newest ${inputs.outputs.length} deliverables; ${inputs.omittedOutputs} older retained deliverables were left on the task and omitted from this turn to keep input staging bounded.`,
        ]
      : []),
    ...(inputs !== undefined && inputs.outputs.length > 0
      ? [
          `- ${inputs.dir}/outputs/ — the task's current deliverables, produced by earlier runs: ${inputs.outputs.join(', ')}`,
        ]
      : []),
  ];
  return [
    heading,
    ...(brief.projectName !== undefined
      ? [`Project: ${brief.projectName}`]
      : []),
    ...(brief.labels !== undefined && brief.labels.length > 0
      ? [`Labels: ${brief.labels.join(', ')}`]
      : []),
    ...(brief.description !== undefined && brief.description !== ''
      ? [`Description:\n${brief.description}`]
      : []),
    ...(discussion.length > 0
      ? [
          [
            'Task discussion so far (oldest first — earlier runs of you posted the agent messages):',
            ...discussion.map(
              (entry) =>
                `${entry.author === 'user' ? 'User' : 'You (an earlier run)'}: ${entry.body}`,
            ),
          ].join('\n\n'),
        ]
      : []),
    ...(feedbackText !== ''
      ? [
          requester !== undefined
            ? requesterFeedbackSection(requester, feedbackText)
            : `The task was sent back with reviewer feedback — address it before anything else:\n${feedbackText}`,
        ]
      : requester !== undefined
        ? [requesterStartLine(requester)]
        : []),
    ...(stagedLines.length > 0
      ? [
          [
            `Task inputs — read-only copies staged for this turn:`,
            ...stagedLines,
            ...(inputs !== undefined && inputs.outputs.length > 0
              ? [
                  'To revise an existing deliverable, start from its staged copy and write the updated file into the delivery box under the SAME file name — it replaces the previous version on the task.',
                ]
              : []),
          ].join('\n'),
        ]
      : []),
    ...(outputDir !== undefined
      ? [
          `Deliverables: write every file you produce into ${outputDir}/ (create it if needed). Only files in that exact directory are collected and attached to this task — anything written elsewhere, including /agent/output/ itself, is discarded.`,
        ]
      : []),
    'When you are done, end with a short report of what you did and what you produced — that report is posted back to the task for human review.',
  ].join('\n\n');
}

/** The opening prompt of a RESUMED later kick — same task, same harness
 * conversation, next user turn (Retry, request-changes, an idle-agent
 * mention). Status-agnostic on purpose: the predecessor may have settled
 * cleanly (reviewer sent it back) or died mid-work (Retry) — either way the
 * conversation continues and finished work is not redone. `discussion` is
 * the delta posted since the predecessor's own brief was read (bounded at
 * its start): the turn may have already seen some of them mid-run — a
 * duplicate is harmless, a silently dropped comment is not. `feedback` is
 * the comment that kicked this run, kept out of `discussion` by the caller
 * so it is not said twice — or, for a description mention
 * (`mentionSource: 'description'`), the description as it reads at this
 * start: a resumed conversation does not re-read the brief, so the edit
 * that named the agent reaches it here, said as an edit and not as a review
 * that sent finished work back. Every other resumed kick gets the current
 * description too, including an explicit empty state, so a changed brief
 * replaces the one the conversation remembers. Names `outputDir` explicitly:
 * a resumed conversation happily reuses last turn's path from memory. When
 * the start SWEPT the box (settled predecessor), says so and names the staged
 * read-only copies: the conversation remembers writing files the sweep just
 * removed, and without the pointer it would rediscover (or worse, redo)
 * them. */
function buildResumeKickPrompt(args: {
  outputDir: string;
  description?: string;
  feedback?: string;
  mentionSource?: MentionSource;
  /** Who started the run when no person did; see {@link KickRequester}. */
  requester?: KickRequester;
  discussion?: Array<{ author: 'user' | 'agent'; body: string }>;
  /** What `stageTaskInputs` landed for THIS turn — same shape as the fresh
   * brief's block, because attachments and deliverables may have changed
   * since the conversation last looked. */
  inputs?: StagedTaskInputs;
  /** True when the start cleared the delivery box before this turn (the
   * settled-predecessor path). Never claim a cleared box on the failed /
   * cancelled path — there the box still holds the unpublished work. */
  boxCleared?: boolean;
}): string {
  const feedbackText = args.feedback?.trim() ?? '';
  const descriptionText = args.description ?? '';
  let discussion = args.discussion ?? [];
  const lastEntry = discussion.at(-1);
  if (
    feedbackText !== '' &&
    lastEntry?.author === 'user' &&
    lastEntry.body.trim() === feedbackText
  ) {
    // The kicking comment closes the delta — the feedback section below
    // already carries it, so it is dropped here rather than said twice
    // (same rule as buildTaskPrompt).
    discussion = discussion.slice(0, -1);
  }
  const inputs = args.inputs;
  const stagedLines = [
    ...(inputs !== undefined && inputs.attachments.length > 0
      ? [
          `- ${inputs.dir}/attachments/ — files the user attached to the task: ${inputs.attachments.join(', ')}`,
        ]
      : []),
    ...(inputs !== undefined && (inputs.omittedOutputs ?? 0) > 0
      ? [
          `- ${inputs.dir}/outputs/ contains the newest ${inputs.outputs.length} deliverables; ${inputs.omittedOutputs} older retained deliverables were left on the task and omitted from this turn to keep input staging bounded.`,
        ]
      : []),
    ...(inputs !== undefined && inputs.outputs.length > 0
      ? [
          `- ${inputs.dir}/outputs/ — the task's current deliverables, produced by earlier runs: ${inputs.outputs.join(', ')}`,
        ]
      : []),
  ];
  return [
    'You are continuing the SAME task in the SAME conversation — your previous turn ended, and this is the next one. Do NOT redo work that is already done; pick up from where the conversation left off.',
    ...(descriptionText.trim() === ''
      ? [
          'This task currently has no description. Do not keep following an earlier task description; continue from the current task discussion and feedback below.',
        ]
      : args.mentionSource !== 'description'
        ? [
            `Current task description:\n${descriptionText}\n\nThis replaces any earlier task description. Act on what remains to be done under it without repeating completed work.`,
          ]
        : []),
    ...(discussion.length > 0
      ? [
          [
            'Task discussion since your previous turn began (oldest first — you may have already seen some of these mid-turn):',
            ...discussion.map(
              (entry) =>
                `${entry.author === 'user' ? 'User' : 'Agent'}: ${entry.body}`,
            ),
          ].join('\n\n'),
        ]
      : []),
    ...(feedbackText !== ''
      ? [
          args.mentionSource === 'description'
            ? `The task description was edited to mention you. It now reads:\n${feedbackText}\n\nAct on what it asks that this conversation has not done yet. Where it contradicts anything earlier in this conversation, the current description wins (earlier tool results may be stale).`
            : args.requester !== undefined
              ? requesterFeedbackSection(args.requester, feedbackText)
              : `The task was sent back with reviewer feedback — address it before anything else:\n${feedbackText}\n\nThis feedback is authoritative: where it contradicts anything earlier in this conversation, the feedback wins (earlier tool results may be stale).`,
        ]
      : args.requester !== undefined
        ? [requesterStartLine(args.requester)]
        : []),
    ...(stagedLines.length > 0
      ? [
          [
            `Task inputs — read-only copies staged for this turn:`,
            ...stagedLines,
            ...(args.boxCleared === true
              ? [
                  'Your delivery box was emptied after your last turn settled — its files are already attached to the task, and the staged copies above are their current versions. Do not trust remembered box paths.',
                ]
              : []),
            ...(inputs !== undefined && inputs.outputs.length > 0
              ? [
                  'To revise an existing deliverable, start from its staged copy and write the updated file into the delivery box under the SAME file name — it replaces the previous version on the task.',
                ]
              : []),
          ].join('\n'),
        ]
      : []),
    `Deliverables: write every file you produce into ${args.outputDir}/ (create it if needed). Only files in that exact directory are collected and attached to this task — anything written elsewhere, including /agent/output/ itself, is discarded.`,
    'When you are done, end with a short report of what you did and what you produced — that report is posted back to the task for human review.',
  ].join('\n\n');
}

/** Prefixed to the rebuilt brief when a later kick could NOT continue the
 * previous conversation (no handle, a foreign incarnation, or a `--resume`
 * that failed to launch) and the box was left unswept: the fresh
 * conversation must know the leftovers exist, or it redoes the work. */
const FRESH_KICK_RESTART_NOTE =
  "A previous run of this task could not be continued as the same conversation, so you are starting fresh. Your workspace (/agent/workspace) and this task's delivery box may already hold work from earlier runs — inspect them and continue that work rather than starting over.";

/** A kick's two opening prompts over the brief this start just read — the
 * fresh one, and the one a resumed conversation gets. Exported for its unit
 * test. A comment mention's text is the run's stored `feedback`. A
 * description mention (`mentionSource: 'description'`) delivers the
 * description as it reads NOW, never a copy taken at kick time: an edit
 * that lands between the kick and this start (a queued run, a capacity
 * park) names nobody new, fires nothing, and must not be contradicted by
 * the text it replaced. A fresh conversation reads that description as its
 * brief; every resumed one gets the current description too, phrased as
 * the edit that named the agent only for a description mention. */
export function buildKickPrompts(args: {
  brief: {
    title: string;
    description?: string;
    labels?: string[];
    identifier?: string;
    projectName?: string;
    discussion: Array<{ author: 'user' | 'agent'; body: string; at: number }>;
  };
  feedback?: string;
  mentionSource?: MentionSource;
  /** Who started the run when no person did; see {@link KickRequester}. */
  requester?: KickRequester;
  outputDir: string;
  inputs: StagedTaskInputs;
  resumeDiscussionSince?: number;
  sweep?: boolean;
  inspectNote?: boolean;
}): { fresh: string; resume: string } {
  const fromDescription = args.mentionSource === 'description';
  const base = buildTaskPrompt(
    args.brief,
    fromDescription ? undefined : args.feedback,
    args.outputDir,
    args.inputs,
    args.requester,
  );
  // The resumed conversation's own memory covers everything before its
  // predecessor's brief was read — carry the discussion posted after the
  // predecessor STARTED (a mid-turn duplicate is harmless).
  const since = args.resumeDiscussionSince;
  const delta =
    since !== undefined
      ? args.brief.discussion.filter((entry) => entry.at > since)
      : [];
  const feedback = fromDescription ? args.brief.description : args.feedback;
  return {
    fresh:
      (args.inspectNote ?? false)
        ? [FRESH_KICK_RESTART_NOTE, base].join('\n\n')
        : base,
    resume: buildResumeKickPrompt({
      outputDir: args.outputDir,
      ...(args.brief.description !== undefined
        ? { description: args.brief.description }
        : {}),
      ...(feedback !== undefined ? { feedback } : {}),
      ...(args.mentionSource !== undefined
        ? { mentionSource: args.mentionSource }
        : {}),
      ...(args.requester !== undefined ? { requester: args.requester } : {}),
      ...(delta.length > 0 ? { discussion: delta } : {}),
      // The conversation remembers writing into the box; when this start
      // swept it (settled predecessor), the prompt must say so and point at
      // the staged read-only copies instead.
      inputs: args.inputs,
      boxCleared: args.sweep ?? true,
    }),
  };
}

/** What one turn's exec authenticates with, minted per lane. */
interface PreparedServing {
  serving: ExternalTurnServing;
  /** The model the exec drives: a gateway ref, or the vendor-native id. */
  execModel: string;
  /** `${provider}/${model}` for the session op row. */
  modelRef: string;
  /** VK id for the op row + settle spend/revoke; absent on subscription. */
  mintedKeyId?: string;
  /** sha256 of the exec's bearer, for the session-token row. */
  tokenHash: string;
  /** The session-token scope's model allowlist (gateway refs). */
  allowedModels: string[];
  /** The scope's budget; 0 on the subscription lane (vendor flat-rate). */
  budgetCents: number;
  /** The gateway model of the sandbox's vision lane (`tale-vision`,
   * `tale-vision-transcribe`), when one resolved. */
  visionModelRef?: string;
  /** The serving model cannot see images: the harness polyfills its own
   * image and PDF reads through `visionModelRef` (text-only serving). */
  visionPolyfillReads?: boolean;
  /** Opaque broker-scoped selected-account hash (subscription-broker only) —
   * stamped on the run row so a retry's vend can exclude it. */
  brokerTokenHash?: string;
}

/**
 * Mint what the resolved lane authenticates with — called late (after the
 * session ensure and staging) so a parked or failed start never leaks a
 * minted key. GATEWAY: the session virtual key over serving + vision
 * models, exactly the pre-subscription flow. SUBSCRIPTION: redeem the
 * pinned provider's default subscription credential (broker failures carry
 * their typed, actionable messages into the run error) and mint NO virtual
 * key — the vendor token serves inference, while a random session token
 * keeps the capability bridge reachable; there is no gateway spend to
 * meter, and nothing to revoke at settle. Shared by the fresh start and the
 * steer restart so the two lanes can never drift.
 */
async function mintTurnServing(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    /** The exec the minted key serves — the reservation's op row. */
    execId: string;
    harness: string;
    /** Broker-token hashes the failure streak already burned — the vend
     * advances past them (`resolveProviderCredential`). */
    excludeBrokerTokenHashes?: string[];
  },
  resolved: TaskServing,
  brokerTransport?: BrokerTransportScope,
): Promise<PreparedServing> {
  if (resolved.lane === 'gateway') {
    // Claude Code + a connector with a native Anthropic harness endpoint
    // (DeepSeek) rides that endpoint's distinct record; the flag must reach the
    // execModel routing, the provision, and the mint identically or they drift.
    const anthropicHarnessLane = resolved.anthropicHarnessLane === true;
    const target = {
      providerSlug: resolved.providerSlug,
      modelId: resolved.modelId,
      anthropicHarnessLane,
    };
    const routing = resolveGatewayRouting(
      args.organizationId,
      target.providerSlug,
      target.modelId,
      { anthropicHarnessLane },
    );
    // Every gateway turn gets the org's vision model for the sandbox's vision
    // lane; a text-only serving model additionally has its own image reads
    // (task attachments, scanned PDFs) polyfilled through it instead of
    // 404ing the turn. Resolved once: the harness needs it, and — when it
    // polyfills — the op row records it so the run's viewers can see which
    // model did the reading after the fact.
    const vision = await resolveTurnVisionModel(
      ctx,
      args.organizationId,
      target,
    );
    const visionModelRef =
      vision !== null
        ? resolveGatewayRouting(
            args.organizationId,
            vision.model.providerSlug,
            vision.model.modelId,
          ).gatewayModel
        : undefined;
    // The org's spend cap sizes the key: the deployment default, capped by
    // what remains under every cost rule binding the run's starter after
    // the spend booked this period and every unsettled turn's reservation —
    // and a cap already reached refuses the start (`budget_exceeded`).
    const reservation = readReserveTurnBudgetResult(
      await ctx.runMutation(
        internal.sandbox.session_mutations.reserveTurnBudget,
        {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          execId: args.execId,
          kind: 'task-agent',
          defaultBudgetCents: workflowAgentBudgetCents(),
          modelRef: `${target.providerSlug}/${routing.gatewayModel}`,
          harness: args.harness,
        },
      ),
    );
    if (!reservation.allowed) {
      throw new TurnBudgetExceededError(reservation.reason);
    }
    const budgetCents = reservation.budgetCents;
    const key = await provisionSessionGatewayKey(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      allowedModels: [target, ...(vision !== null ? [vision.model] : [])],
      budgetCents,
    });
    return {
      serving: { kind: 'gateway', token: key.token },
      execModel: routing.gatewayModel,
      modelRef: `${target.providerSlug}/${routing.gatewayModel}`,
      mintedKeyId: key.keyId,
      tokenHash: key.keyHash,
      allowedModels: [routing.gatewayModel],
      budgetCents,
      ...(visionModelRef !== undefined ? { visionModelRef } : {}),
      ...(vision !== null ? { visionPolyfillReads: vision.polyfillReads } : {}),
    };
  }
  // A subscription turn costs the organization nothing per call, but it is a
  // request: it holds one while it runs, and is refused before any
  // credential is vended once a request or token cap that binds its run is
  // reached. Cost caps cannot bind it — it adds no cost.
  const reservation = readReserveTurnBudgetResult(
    await ctx.runMutation(
      internal.sandbox.session_mutations.reserveTurnBudget,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
        kind: 'task-agent',
        defaultBudgetCents: 0,
        costFree: true,
        modelRef: `${resolved.providerSlug}/${resolved.modelId}`,
        harness: args.harness,
      },
    ),
  );
  if (!reservation.allowed) {
    throw new TurnBudgetExceededError(reservation.reason);
  }
  const credential = await resolveProviderCredential(
    ctx,
    {
      organizationId: args.organizationId,
      providerSlug: resolved.providerSlug,
      requireBrokerAccountId: harnessRequiresSubscriptionAccountId(
        args.harness,
      ),
      ...(args.excludeBrokerTokenHashes !== undefined &&
      args.excludeBrokerTokenHashes.length > 0
        ? { excludeBrokerTokenHashes: args.excludeBrokerTokenHashes }
        : {}),
    },
    brokerTransport,
  );
  if (
    credential.authMethod !== 'subscription-key' &&
    credential.authMethod !== 'subscription-broker'
  ) {
    // The default credential changed shape between resolution and redeem.
    throw new Error(
      `provider "${resolved.providerSlug}"'s default credential is no longer a subscription — retry the run`,
    );
  }
  const secret =
    credential.authMethod === 'subscription-broker'
      ? credential.token
      : credential.secret;
  const bridgeToken = `tale-sub-${randomBytes(24).toString('base64url')}`;
  return {
    serving: {
      kind: 'subscription',
      secret,
      baseUrl:
        (credential.authMethod === 'subscription-broker'
          ? credential.endpointUrl
          : undefined) ?? resolved.apiBaseUrl,
      bridgeToken,
      ...(credential.targetEnvVar !== undefined
        ? { targetEnvVar: credential.targetEnvVar }
        : {}),
      ...(credential.authMethod === 'subscription-broker' &&
      credential.accountId !== undefined
        ? { accountId: credential.accountId }
        : {}),
    },
    execModel: resolved.modelId,
    modelRef: `${resolved.providerSlug}/${resolved.modelId}`,
    tokenHash: hashVirtualKey(bridgeToken),
    allowedModels: [],
    budgetCents: 0,
    ...(credential.authMethod === 'subscription-broker'
      ? { brokerTokenHash: credential.brokerTokenHash }
      : {}),
  };
}

/**
 * Write the turn's session-token row: the capability the in-sandbox bridges
 * authenticate. It carries the connectors and tools the agent was EQUIPPED
 * with and, when it has connectors, the exec whose task run its connector
 * calls act through: the bridge acts for that run's starter while the run is
 * live. A turn the organization lets generate images also gets
 * `generate_image` and the op it serves (`turnOp`), which books the images
 * under the run's starter and delivers them into this task's box. The first
 * start and a steer restart both write through here, so a restarted turn can
 * never lose what its first exec could do.
 */
export async function insertTaskTurnSessionToken(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    /** The exec the token serves (a steer restart's rotated one). */
    execId: string;
    harness: string;
    connectors: readonly string[];
    tools: readonly string[];
    /** The organization's image generation is on and a model resolved. */
    imageGeneration: boolean;
    deadlineAt: number;
    prepared: Pick<
      PreparedServing,
      'tokenHash' | 'mintedKeyId' | 'allowedModels' | 'budgetCents'
    >;
  },
): Promise<void> {
  // Only a turn with connectors mounts the bridge that reads the caller.
  const connectorCaller: TurnConnectorCaller | undefined =
    args.connectors.length > 0
      ? { kind: 'task-run', execId: args.execId }
      : undefined;
  await ctx.runMutation(internal.sandbox.session_mutations.insertSessionToken, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    tokenHash: args.prepared.tokenHash,
    ...(args.prepared.mintedKeyId !== undefined
      ? { llmGatewayKeyId: args.prepared.mintedKeyId }
      : {}),
    scope: {
      agentKind: args.harness,
      allowedModels: args.prepared.allowedModels,
      connectorGrants: [...args.connectors],
      budgetCents: args.prepared.budgetCents,
      // Baseline knowledge retrieval (visibility derives from THIS
      // session's project binding at dispatch, so the grant alone never
      // widens what the run can read) PLUS the agent's configured tool
      // grants — writes included, since an explicit grant IS the
      // standing authorization on this async lane — PLUS image generation
      // while the organization's policy offers it.
      toolGrants: [
        ...KNOWLEDGE_READ_TOOLS,
        ...normalizeToolGrants(args.tools),
        ...(args.imageGeneration ? [IMAGE_GENERATION_TOOL] : []),
      ],
      // Read by the connectors bridge alone, and it names the exec, never
      // the person. It is not `userId`: the workspace tools read that one as
      // a user-keyed session, and would fall back to reading org-wide as the
      // starter wherever this session's project binding stops resolving.
      ...(connectorCaller !== undefined ? { connectorCaller } : {}),
      // The run this turn serves, for the workspace tools: they judge each
      // call by the live run on this exec — a run a member started acts on
      // its own task alone.
      taskRun: { execId: args.execId },
      // Read by `generate_image` alone; names the exec, never the person.
      ...(args.imageGeneration
        ? { turnOp: { kind: 'task-agent' as const, execId: args.execId } }
        : {}),
    },
    expiresAt: args.deadlineAt,
  });
}

/** How long a start waits for a cancelled predecessor to actually be gone
 * before launching beside it. runnerd's cancel is a process-group SIGTERM
 * with a 5 s SIGKILL grace, so a live predecessor is gone well inside this;
 * past it the launch proceeds anyway (a start must never wedge on a reap). */
const PREDECESSOR_REAP_WAIT_MS = 15_000;
const PREDECESSOR_REAP_POLL_MS = 500;

/**
 * Cancel a predecessor exec and wait (bounded) until runnerd no longer
 * reports it running. Best-effort end to end: a spawner error on the cancel
 * or a status probe is logged and the launch goes ahead — the usual case is a
 * long-dead exec that answers `exited`/`gone` on the first probe.
 */
async function reapPredecessorExec(
  sessionId: string,
  execId: string,
): Promise<void> {
  try {
    await sessionCancelExec(sessionId, execId);
  } catch (err) {
    console.warn(
      `[task-agent] predecessor ${execId} reap failed (continuing):`,
      err,
    );
    return;
  }
  const deadline = Date.now() + PREDECESSOR_REAP_WAIT_MS;
  for (;;) {
    let liveness;
    try {
      liveness = await sessionExecStatus(sessionId, execId);
    } catch (err) {
      console.warn(
        `[task-agent] predecessor ${execId} status probe failed (continuing):`,
        err,
      );
      return;
    }
    if (liveness.state !== 'running') return;
    if (Date.now() >= deadline) {
      console.warn(
        `[task-agent] predecessor ${execId} still running ${PREDECESSOR_REAP_WAIT_MS}ms after cancel — launching anyway`,
      );
      return;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, PREDECESSOR_REAP_POLL_MS),
    );
  }
}

/** The start's full argument shape — `turnArgs` plus the kick shaping. */
export interface StartTaskAgentTurnArgs extends TurnKeys {
  model: string;
  modelProvider?: string;
  instructions?: string;
  skills: string[];
  connectors: string[];
  tools: string[];
  secrets: string[];
  feedback?: string;
  /** Which text named the agent on a `mention` kick; `'description'` is
   * read from the brief at this start instead of from `feedback`. */
  mentionSource?: MentionSource;
  /** Who started the run when no person did — named in the prompt. */
  requester?: KickRequester;
  resume?: string;
  resumeSessionCreatedAt?: number;
  resumeDiscussionSince?: number;
  /** See `TaskKickStartPlanArgs.predecessorExecId`. */
  predecessorExecId?: string;
  sweep?: boolean;
  inspectNote?: boolean;
  excludeBrokerTokenHashes?: string[];
}

/** The start as a PLAIN exported function — the internalAction above wraps
 * it, and the 0.5 backend's `task.agent_turn` job runs it on the ctx shim
 * (same pattern as `chat/turn_action.executeTurn`). */
export async function startTaskAgentTurnImpl(
  ctx: ActionCtx,
  args: StartTaskAgentTurnArgs,
  execution?: { signal?: AbortSignal },
): Promise<null> {
  {
    // Idempotency gate: the kick, the capacity wake, and the watchdog retry
    // can each schedule a start; only a run still at `queued` under THIS
    // execId gets one. Without it a second start mints a second gateway key
    // and a second exec — the spawner does not dedupe execIds.
    const runRow = await ctx.runQuery(
      internal.tasks.agent_runs.getTaskAgentRunForDrive,
      { runId: args.runId },
    );
    if (
      runRow === null ||
      runRow.status !== 'queued' ||
      runRow.execId !== args.execId
    ) {
      console.warn(
        `[task-agent] start for ${args.execId} skipped (run ${runRow?.status ?? 'gone'})`,
      );
      return null;
    }
    try {
      // Resolve early (a bad model/pin fails before the session even
      // ensures); mint late (a parked start must not leak a minted key).
      const resolved = await resolveTaskServing(ctx, {
        organizationId: args.organizationId,
        model: args.model,
        ...(args.modelProvider !== undefined
          ? { modelProvider: args.modelProvider }
          : {}),
        harness: args.harness,
      });

      const { liveCreatedAt } = await ensureProjectAgentSession(
        ctx,
        args.organizationId,
        args.agentId,
        args.sessionId,
        args.harness,
      );
      // This turn's keys, carrying the incarnation it actually runs on — the
      // settle stamps it (with the conversation handle) for the NEXT kick's
      // binds-check.
      const keys: TurnKeys = {
        ...args,
        ...(liveCreatedAt !== undefined
          ? { sessionCreatedAt: liveCreatedAt }
          : {}),
      };

      // Re-check the resume handle against the incarnation the ensure landed
      // on: the session can be destroyed and recreated between the kick's
      // decision and this start. A stamped handle must match exactly; an
      // op-recovered one (no stamp) at least predate the predecessor's
      // start. A mismatch is not a failure — the fresh brief on the
      // preserved files is the designed fallback.
      let resume = args.resume;
      if (resume !== undefined) {
        const bound =
          liveCreatedAt !== undefined &&
          (args.resumeSessionCreatedAt !== undefined
            ? args.resumeSessionCreatedAt === liveCreatedAt
            : args.resumeDiscussionSince !== undefined &&
              liveCreatedAt <= args.resumeDiscussionSince);
        if (!bound) {
          console.warn(
            `[task-agent] resume handle for ${args.execId} no longer binds (session incarnation changed) — starting fresh`,
          );
          resume = undefined;
        }
      }
      if (args.predecessorExecId !== undefined) {
        // Reap the predecessor's exec before this turn launches — resumed or
        // not. A cancel-then-Retry can reach here while the old CLI is still
        // inside its kill grace, a drain that died on a transport failure
        // settled its run with the CLI still alive, and a harness switch
        // starts a fresh conversation beside it: two processes must never
        // write one workspace, one conversation, or one delivery box. Same
        // posture as the steer restart lane's kill-before-resume; idempotent
        // for the common long-dead case, best-effort like it — and the
        // launch waits (bounded) for the predecessor to actually be gone,
        // since runnerd's cancel is a SIGTERM with a kill grace.
        await reapPredecessorExec(args.sessionId, args.predecessorExecId);
      }

      // The STANDING session serves every task of this agent, so the
      // delivery box is PER TASK — /agent/output/<taskId>/ — and the harvest
      // reads only that subdir: another task's run (even a CONCURRENT one —
      // the live-run mutex is per task, not per agent) can never leak its
      // deliverables here. Before the turn, sweep this task's own subdir
      // (the settle must attach exactly what THIS run produced) plus STALE
      // loose files at the box root, which are never harvested and would
      // only accumulate — age-gated, because a concurrent sibling task's
      // run may be using the root as (contract-violating) scratch and a
      // live turn's files are always younger than its own deadline. Skipped
      // entirely when the scheduler decided the box holds the only copy of
      // a failed predecessor's unpublished work (`sweep: false`). A settled
      // predecessor sweeps even on resume: leftovers are already on
      // `task.outputs`, and re-harvesting them every review cycle would
      // spend the per-run harvest cap on stale files. Best-effort: a sweep
      // failure costs precision, not the run.
      const outputDir = taskOutputDir(args.taskId);
      if (args.sweep ?? true) {
        try {
          const now = Date.now();
          const leftovers: string[] = [];
          for (const entry of (await sessionListFiles(
            args.sessionId,
            outputDir,
          )) ?? []) {
            if (entry.type === 'file') {
              leftovers.push(`${outputDir}/${entry.name}`);
            }
          }
          for (const entry of (await sessionListFiles(
            args.sessionId,
            OUTPUT_DIR,
          )) ?? []) {
            if (entry.type === 'file' && isStaleLooseBoxFile(entry, now)) {
              leftovers.push(`${OUTPUT_DIR}/${entry.name}`);
            }
          }
          if (leftovers.length > 0) {
            await sessionDeleteFiles(args.sessionId, leftovers);
          }
        } catch (err) {
          console.warn(
            '[task-agent] output-box sweep failed (continuing):',
            err,
          );
        }
      }

      // A project agent's equipment is the PROJECT's: team skills resolve
      // against the project's teams, never against whoever configured the
      // agent or whoever triggers the run.
      const [projectScope, brief] = await Promise.all([
        ctx.runQuery(
          internal.projects.internal_queries.getProjectAgentSkillScope,
          { agentId: args.agentId },
        ),
        ctx.runQuery(internal.tasks.agent_runs.getTaskBriefForAgentRun, {
          taskId: args.taskId,
        }),
      ]);
      if (brief === null) throw new Error('the task no longer exists');
      // Disjoint managed directories can stage together. Finish both before
      // failure releases the session; credentials are minted only afterwards.
      const [skillsResult, inputsResult] = await Promise.allSettled([
        stageWorkflowSkills(
          ctx,
          args.organizationId,
          args.sessionId,
          args.skills,
          projectScope === null
            ? { kind: 'org' }
            : { kind: 'project', teamIds: projectScope.teamIds },
        ),
        stageTaskInputs(ctx, {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          taskId: args.taskId,
          attachments: brief.attachments,
          outputs: brief.outputs,
        }),
      ]);
      if (skillsResult.status === 'rejected') throw skillsResult.reason;
      if (inputsResult.status === 'rejected') throw inputsResult.reason;
      const skillsAddendum = skillsResult.value;
      const inputs = inputsResult.value;
      // A subscription serving that cannot see images must not run blind
      // over image inputs: refuse with the reason (the run fails visibly,
      // naming the fix) before anything is minted; a turn without image
      // inputs carries the guidance instead.
      if (resolved.lane === 'subscription') {
        refuseBlindImageTurn(resolved.vision, [
          ...inputs.attachments,
          ...inputs.outputs,
        ]);
      }
      const visionGuidance =
        resolved.lane === 'subscription'
          ? visionUnreadableGuidance(resolved.vision)
          : '';

      // Added transport waiting is only for an unconfined fresh start.
      // Member starts and steer retain their existing single-shot behavior.
      const brokerTransport: BrokerTransportScope | undefined =
        resolved.lane === 'subscription' &&
        !(await isTurnConfined(ctx, args.runId))
          ? {
              deadlineAt: args.deadlineAt,
              ...(execution?.signal !== undefined
                ? { signal: execution.signal }
                : {}),
              assertCurrent: async () => {
                const confined = await isTurnConfined(ctx, args.runId);
                const current = await ctx.runQuery(
                  internal.tasks.agent_runs.getTaskAgentRunForDrive,
                  { runId: args.runId },
                );
                if (
                  current === null ||
                  current.status !== 'queued' ||
                  current.execId !== args.execId ||
                  current.sessionId !== args.sessionId ||
                  current.organizationId !== args.organizationId ||
                  Date.now() >= args.deadlineAt ||
                  confined
                ) {
                  throw new Error(
                    'The task no longer authorizes this credential request.',
                  );
                }
              },
            }
          : undefined;
      const prepared = await mintTurnServing(
        ctx,
        args,
        resolved,
        brokerTransport,
      );
      // Clear a predecessor's account when this launch uses another lane.
      // Fenced on THIS exec, like the selected-account stamp itself.
      await ctx.runMutation(
        internal.tasks.agent_runs.stampTaskAgentRunBrokerToken,
        {
          runId: args.runId,
          execId: args.execId,
          brokerTokenHash: prepared.brokerTokenHash ?? null,
        },
      );
      // Offered only on a harness that mounts the bridge, while the
      // organization's policy is on AND a model resolves — an absent tool,
      // not a dead instruction, otherwise.
      const imageModel = harnessMountsMcp(args.harness)
        ? await resolveTurnImageGeneration(ctx, args.organizationId)
        : null;
      await insertTaskTurnSessionToken(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
        harness: args.harness,
        connectors: args.connectors,
        tools: args.tools,
        imageGeneration: imageModel !== null,
        deadlineAt: args.deadlineAt,
        prepared,
      });
      await ctx.runMutation(
        internal.sandbox.session_mutations.upsertSessionOp,
        {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          execId: args.execId,
          kind: 'task-agent',
          status: 'running',
          modelRef: prepared.modelRef,
          harness: args.harness,
          deadlineMs: args.deadlineAt,
          heartbeatAt: Date.now(),
          ...(prepared.mintedKeyId !== undefined
            ? { mintedKeyId: prepared.mintedKeyId }
            : {}),
        },
      );
      const launched = await ctx.runMutation(
        internal.tasks.agent_runs.setTaskAgentRunRunning,
        { runId: args.runId, execId: args.execId },
      );
      if (launched !== true) {
        // The flip is exec-fenced. Between the gate above and here (a cold
        // session create plus input staging legitimately takes minutes) the
        // queued-run recovery may have rotated the run onto a fresh exec and
        // re-kicked it, or a cancel landed. Spawning now would double-drive
        // the run — or leave a live exec the next drive window reaps as an
        // orphan — so this start stands down exactly like an orphaned drive:
        // its op row finalizes as cancelled, its minted key is revoked.
        console.warn(
          `[task-agent] start for ${args.execId} lost the run before launch (rotated or terminal) — standing down without a spawn`,
        );
        await releaseTurnKey(ctx, {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          execId: args.execId,
          status: 'cancelled',
        });
        // The session slot belongs to whoever holds the run NOW. A rotated
        // run has a successor start on this very session, possibly past
        // its ensure but before its own op row — stopping the session under
        // it would run that turn on a slot no budget counts, and its later
        // release would be a no-op. Only a run nobody drives any more (a
        // cancel landed) leaves this start as the one to free the slot.
        const after = await ctx.runQuery(
          internal.tasks.agent_runs.getTaskAgentRunForDrive,
          { runId: args.runId },
        );
        const liveUnderSuccessor =
          after !== null &&
          (after.status === 'queued' || after.status === 'running') &&
          after.execId !== args.execId;
        if (!liveUnderSuccessor) {
          await releaseProjectAgentSlotAfterSettle(ctx, args);
        }
        return null;
      }

      const toolsGuidance = grantedToolsGuidance(
        normalizeToolGrants(args.tools),
      );
      const mandatoryInstructions = await readMandatoryInstructions(
        ctx,
        args.organizationId,
        '[task-agent]',
      );
      // A run a member started holds none of the agent's credentials.
      const confined = await isTurnConfined(ctx, args.runId);
      const instructions = [
        // The organization's Custom instructions lead, as on a chat turn.
        ...(mandatoryInstructions !== undefined ? [mandatoryInstructions] : []),
        ...(args.instructions !== undefined && args.instructions !== ''
          ? [args.instructions]
          : []),
        agentLanguageGuidance(
          await ctx.runQuery(
            internal.tasks.agent_runs.getAgentLanguageContext,
            {
              organizationId: args.organizationId,
              taskId: args.taskId,
            },
          ),
        ),
        ...(skillsAddendum !== '' ? [skillsAddendum] : []),
        `Write every file you produce to ${outputDir}/ (this task's own delivery box — never plain /agent/output/) — files there are collected when your turn ends and attached to the task.`,
        confined ? MEMBER_WORKSPACE_GUIDANCE : STANDING_WORKSPACE_GUIDANCE,
        KNOWLEDGE_TOOLS_GUIDANCE,
        ...(toolsGuidance !== undefined ? [toolsGuidance] : []),
        ...(imageModel !== null ? [imageGenerationGuidance(outputDir)] : []),
        ...(visionGuidance !== '' ? [visionGuidance] : []),
        ...(confined
          ? [memberRunGuidance(withheldCredentials(args))]
          : secretsGuidance(args.secrets)),
      ].join('\n\n');

      // Per-exec credential env: the agent's referenced secrets + any
      // brokerable connector (github). Dies with the exec, so a revoked grant
      // is gone next turn; harness env wins on collision (extraEnv is under).
      // A confined run gets none of it.
      const extraEnv = confined
        ? {}
        : await resolveTurnEquipmentEnv(ctx, {
            organizationId: args.organizationId,
            sessionId: args.sessionId,
            connectors: args.connectors,
            secrets: args.secrets,
          });

      // The serving model's window, so the harness compacts before the
      // prompt outgrows what the model serves; unknown leaves it to the
      // harness.
      const contextWindow = await resolveHarnessTurnContextWindow(ctx, {
        organizationId: args.organizationId,
        providerSlug: resolved.providerSlug,
        modelId: resolved.modelId,
        sessionId: args.sessionId,
        execId: args.execId,
        kind: 'task-agent',
      });

      // Everything of the exec except the prompt/resume pair, shared by the
      // resume attempt and its same-execId fresh fallback so the two can
      // never drift.
      const execBase = {
        harness: args.harness,
        gatewayModel: prepared.execModel,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        serving: prepared.serving,
        instructions,
        execId: args.execId,
        // Always mounted: the knowledge pair rides the bridge, so every
        // task turn gets the shim even when the agent has no connectors.
        bridgeUrl: connectorsBridgeUrlForSessions(),
        ...(Object.keys(extraEnv).length > 0 ? { extraEnv } : {}),
        ...(prepared.visionModelRef !== undefined
          ? {
              vision: {
                model: prepared.visionModelRef,
                polyfillReads: prepared.visionPolyfillReads === true,
              },
            }
          : {}),
      };
      const prompts = buildKickPrompts({
        brief,
        ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
        ...(args.mentionSource !== undefined
          ? { mentionSource: args.mentionSource }
          : {}),
        ...(args.requester !== undefined ? { requester: args.requester } : {}),
        outputDir,
        inputs,
        ...(args.resumeDiscussionSince !== undefined
          ? { resumeDiscussionSince: args.resumeDiscussionSince }
          : {}),
        ...(args.sweep !== undefined ? { sweep: args.sweep } : {}),
        ...(args.inspectNote !== undefined
          ? { inspectNote: args.inspectNote }
          : {}),
      });

      const progress = liveProgressSink(
        ctx,
        args,
        'task-agent',
        prepared.visionPolyfillReads === true
          ? prepared.visionModelRef
          : undefined,
      );
      let window = await drainHarnessWindow({
        sessionId: args.sessionId,
        execId: args.execId,
        harness: args.harness,
        start: buildExternalTurnExec({
          ...execBase,
          prompt: resume !== undefined ? prompts.resume : prompts.fresh,
          ...(resume !== undefined ? { resume } : {}),
        }),
        onText: progress.onText,
        onTimeline: progress.onTimeline,
      });
      throwIfExecPlacesTaken(window, args);
      if (resume !== undefined && isResumeLaunchFailure(window, resume)) {
        // A dead handle does not throw: the CLI launches, emits one error
        // result (echoing the id back), and exits — a terminal, errored
        // window with no content. Relaunch FRESH under the same execId
        // (runnerd refuses duplicate ids only while an exec is live; this
        // one exited), reusing the minted key, session token, op row, and
        // staged inputs — after re-checking the run is still this exec's to
        // drive: a cancel landing between the attempts must abort, not
        // double-drive. Failing the run instead would burn a Retry on a
        // handle the user cannot see.
        const live = await ctx.runQuery(
          internal.tasks.agent_runs.getTaskAgentRunForDrive,
          { runId: args.runId },
        );
        if (
          live !== null &&
          (live.status === 'queued' || live.status === 'running') &&
          live.execId === args.execId
        ) {
          console.warn(
            `[task-agent] --resume launch for ${args.execId} failed — restarting fresh on the preserved files`,
          );
          resume = undefined;
          window = await drainHarnessWindow({
            sessionId: args.sessionId,
            execId: args.execId,
            harness: args.harness,
            start: buildExternalTurnExec({
              ...execBase,
              prompt: prompts.fresh,
            }),
            onText: progress.onText,
            onTimeline: progress.onTimeline,
          });
          throwIfExecPlacesTaken(window, args);
        }
      }
      await progress.flush();
      await continueOrSettle(ctx, keys, window, resume);
    } catch (err) {
      // No room is not a failure: the organization's session budget is
      // spent, the sandbox host is at capacity or short of memory, or the
      // workspace's runtime already runs its maximum of live execs. Park
      // the run and let the next slot release (or the watchdog backstop,
      // every two minutes) restart it — or, when the host keeps a line and
      // said when the run's place comes up, a wake at that moment; a run
      // whose exec found no live-exec place wakes when another turn of its
      // workspace ends. A workspace an administrator is destroying parks
      // the run too: the Destroy's settle is a release edge, and the run
      // starts afresh after it. Everything else settles as a failure with
      // the REAL reason.
      const noRoom = sandboxCapacityRefusal(err);
      if (noRoom !== null || isDestroyPendingRefusal(err)) {
        console.warn(
          noRoom === null
            ? `[task-agent] the sandbox workspace for ${args.execId} is being destroyed — parking the run until the Destroy settles`
            : `[task-agent] no ${capacityShortOf(noRoom.scope)} for ${args.execId} — parking the run until one frees`,
        );
        // The runtime refuses an exec only after the launch: the run reads
        // `running`, with a key minted and an op row open for an exec that
        // never ran. The park takes the run back to `queued` on a fresh
        // exec, so its next start mints its own and the wait counts as no
        // executed time; the refused exec's key and op row then close as
        // cancelled (the key revoked, nothing spent), marked as a room wait:
        // no harness turn ran, so the external-turn metrics must not count
        // the refusal, or each re-wake into a still-full workspace, as a
        // cancelled turn — as the automation lane marks its room waits.
        const execRefused = noRoom?.scope === 'session';
        const wakeAfterMs =
          noRoom !== null ? queuedWakeAfterMs(noRoom) : undefined;
        await ctx.runMutation(
          internal.tasks.agent_runs.parkTaskAgentRunForCapacity,
          {
            runId: args.runId,
            execId: args.execId,
            ...(wakeAfterMs !== undefined ? { wakeAfterMs } : {}),
            ...(execRefused ? { execRefused: true } : {}),
          },
        );
        if (execRefused) {
          await releaseTurnKey(ctx, {
            organizationId: args.organizationId,
            sessionId: args.sessionId,
            execId: args.execId,
            status: 'cancelled',
            agentResultStatus: AWAITING_ROOM_RESULT_STATUS,
          }).catch((releaseErr: unknown) => {
            console.warn(
              `[task-agent] closing the refused exec ${args.execId} failed:`,
              releaseErr,
            );
          });
        }
        return null;
      }
      console.error('[task-agent] turn start failed:', err);
      // A cap refusal is the org's decision and a missing skill the agent's
      // configuration — neither a fault, neither retried; the rest is
      // `start_failed` and retries by default, once a broker pool that was
      // cooling down has an account back (`classifyStartFailure`).
      await settleTaskAgentTurn(ctx, args, {
        errored: true,
        ...classifyStartFailure(err),
        text: '',
      });
    }
    return null;
  }
}

/** One drive window as a PLAIN exported function (see the start's twin). */
export async function driveTaskAgentTurnImpl(
  ctx: ActionCtx,
  args: TurnKeys,
  options: {
    /** Ends this window early with the turn still running — its server is
     * stopping — so the next window, on another process, drains on. */
    signal?: AbortSignal;
  } = {},
): Promise<null> {
  {
    // Orphan check: the run may have been cancelled or already settled. An
    // orphan turn is cut, its key revoked, and nothing else touched.
    const run = await ctx.runQuery(
      internal.tasks.agent_runs.getTaskAgentRunForDrive,
      {
        runId: args.runId,
      },
    );
    const live =
      run !== null &&
      (run.status === 'queued' || run.status === 'running') &&
      run.execId === args.execId;
    if (!live) {
      await sessionCancelExec(args.sessionId, args.execId).catch(() => {
        console.warn('[task-agent] orphan exec reap failed (already gone?)');
      });
      await releaseTurnKey(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        execId: args.execId,
        status: 'cancelled',
      });
      await releaseProjectAgentSlotAfterSettle(ctx, args);
      return null;
    }

    if (Date.now() > args.deadlineAt) {
      await sessionCancelExec(args.sessionId, args.execId).catch((err) =>
        console.warn('[task-agent] deadline exec cancel failed:', err),
      );
      await settleTaskAgentTurn(ctx, args, {
        errored: true,
        reason: 'the agent run ran past its time limit and was stopped',
        text: '',
        failureCode: 'deadline',
      });
      return null;
    }

    const progress = liveProgressSink(ctx, args, 'task-agent');
    let window;
    try {
      window = await drainHarnessWindow({
        sessionId: args.sessionId,
        execId: args.execId,
        harness: args.harness,
        onText: progress.onText,
        onTimeline: progress.onTimeline,
        ...(options.signal !== undefined && { signal: options.signal }),
      });
    } catch (err) {
      console.error('[task-agent] drive window threw:', err);
      await progress.flush();
      // The run settles failed below, so the process must not keep working
      // unobserved: a drain that died on a transport failure (an exhausted
      // re-attach budget) says nothing about the CLI, which is typically
      // still alive — and a Retry would otherwise launch beside it on the
      // same workspace and delivery box. Best-effort, like every reap.
      await sessionCancelExec(args.sessionId, args.execId).catch((cancelErr) =>
        console.warn(
          '[task-agent] exec cancel after drive failure failed:',
          cancelErr,
        ),
      );
      await settleTaskAgentTurn(ctx, args, {
        errored: true,
        reason: 'the agent run stopped unexpectedly',
        text: '',
        failureCode: 'turn_crashed',
      });
      return null;
    }
    await progress.flush();
    await continueOrSettle(ctx, args, window);
    return null;
  }
}

/** The window shape of a `--resume` that never became a conversation: the
 * CLI launched, reported one error (a missing/foreign conversation id is
 * echoed straight back as an errored result), and produced nothing — no
 * text, no tool activity. `attemptedResume` narrows the no-content case: a
 * REAL resumed conversation announces its id on init, so an errored empty
 * window that announced a DIFFERENT id is a genuine first-response failure
 * (e.g. an immediate 401) of a live conversation — its handle must be
 * stamped, not discarded, or a transient auth blip costs the continuity.
 * Distinct from a resumed turn that worked and THEN failed, whose window
 * carries content and settles normally — and from an empty answer: the
 * conversation launched cleanly (the pinned CLI announces the resumed id
 * itself) and only its model said nothing. Exported for its unit test. */
/** What a parked start waits for, as its log line names it. */
function capacityShortOf(scope: CapacityRefusal['scope']): string {
  if (scope === 'host') return 'sandbox host capacity';
  if (scope === 'session') return 'free live-exec place in its workspace';
  return 'session slot';
}

/** Raise a start window the workspace's runtime refused for want of a
 * live-exec place (`EXEC_LIMIT`) as the capacity refusal it is: the exec
 * never ran, so there is no harness end to settle, only room to wait for. */
function throwIfExecPlacesTaken(
  window: Awaited<ReturnType<typeof drainHarnessWindow>>,
  keys: Pick<TurnKeys, 'sessionId' | 'execId'>,
): void {
  if (window.kind === 'terminal' && isSessionExecLimitResult(window.execResult))
    throw new SessionExecLimitError(keys.sessionId, keys.execId);
}

function isResumeLaunchFailure(
  window: Awaited<ReturnType<typeof drainHarnessWindow>>,
  attemptedResume?: string,
): boolean {
  if (window.kind !== 'terminal') return false;
  const { errored, emptyAnswer } = classifyHarnessEnd(window);
  return (
    errored &&
    !emptyAnswer &&
    // A model-wide capacity refusal says nothing about the resume handle.
    // Keep it for the counted delayed retry instead of launching fresh now.
    window.ended?.providerErrorKind !== 'model_capacity' &&
    window.text === '' &&
    window.timeline.length === 0 &&
    (window.agentSessionId === undefined ||
      window.agentSessionId === attemptedResume)
  );
}

/** Phrase an errored turn's run error from the harness's own final words —
 * `classifyHarnessEnd` yields no reason when the harness itself reported the
 * error (`turn-ended.isError`), and swallowing its text buries the real
 * cause behind a generic line (observed live: a mid-run "401 OAuth access
 * token has been revoked" surfaced as "the agent run failed"). Exported for
 * its unit test. */
function failureReasonFromFinalText(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  // The tail carries the terminal error; the head of a long transcript is
  // work narration. Keep the run row a status row, not a log store.
  const MAX = 500;
  return trimmed.length <= MAX ? trimmed : `… ${trimmed.slice(-MAX)}`;
}

async function continueOrSettle(
  ctx: ActionCtx,
  args: TurnKeys,
  window: Awaited<ReturnType<typeof drainHarnessWindow>>,
  /** The `--resume` handle this window's exec was LAUNCHED with (the start's
   * first window only) — lets the launch-failure guard tell a dead-handle
   * echo from a live conversation's first-response error. */
  attemptedResume?: string,
): Promise<void> {
  if (window.kind === 'running') {
    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: 'task-agent',
      status: 'running',
      heartbeatAt: Date.now(),
      // The harness's own conversation id, announced on turn start and
      // replayed into every window — the restart-steering lane's --resume
      // handle. Patch-only-when-provided keeps an earlier capture.
      ...(window.agentSessionId !== undefined
        ? { agentSessionId: window.agentSessionId }
        : {}),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.tasks.agent_run_host.driveTaskAgentTurn,
      {
        organizationId: args.organizationId,
        runId: args.runId,
        taskId: args.taskId,
        agentId: args.agentId,
        execId: args.execId,
        sessionId: args.sessionId,
        harness: args.harness,
        deadlineAt: args.deadlineAt,
        ...(args.sessionCreatedAt !== undefined
          ? { sessionCreatedAt: args.sessionCreatedAt }
          : {}),
      },
    );
    return;
  }
  if (window.kind === 'gone') {
    await settleTaskAgentTurn(ctx, args, {
      errored: true,
      reason: 'the sandbox session ended before the agent run finished',
      text: '',
      failureCode: 'session_gone',
    });
    return;
  }
  const {
    errored,
    reason: endReason,
    emptyAnswer,
  } = classifyHarnessEnd(window);
  // A `--resume` of a dead conversation echoes the handle back on its error
  // result: stamping THAT would re-arm the dead handle on every Retry
  // forever. A window that errored without producing anything and without
  // announcing a DIFFERENT id proves no conversation — withhold its id from
  // the op snapshot and the run stamp.
  const launchFailed = isResumeLaunchFailure(window, attemptedResume);
  // Final transcript snapshot before the settle stamps the op terminal — the
  // throttled live writes can miss the last window's activity, and this is
  // what the run's Details dialog shows after the turn ends.
  await ctx
    .runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      kind: 'task-agent',
      status: 'running',
      lastEventAt: Date.now(),
      ...(window.text !== '' ? { progressText: window.text } : {}),
      ...(window.agentSessionId !== undefined && !launchFailed
        ? { agentSessionId: window.agentSessionId }
        : {}),
      liveTimeline: window.timeline,
    })
    .catch((err) =>
      console.warn('[task-agent] final progress write failed:', err),
    );
  const ended = window.ended;
  // A SUCCESSFUL end with no final text is not a settle: the model emitted
  // a bare end-of-turn mid-work (observed live: a 1-completion-token
  // response at a 42k-token prompt ended the turn between two file reads),
  // so there is no report to post and the work is not done. Parking the
  // half-done task at in_review as if reported is the worst outcome — fail
  // the run RETRYABLY instead, so the auto-retry resumes the SAME
  // conversation (the handle is stamped below) and asks it to continue.
  // Every parser sets `finalText` only from real final text, so its absence
  // IS the no-report signal; windows that never became a conversation stay
  // with the resume-launch-failure lane. An empty answer (nothing at all
  // from the model, which classify errs on) is the same case, named as such.
  if (
    !launchFailed &&
    (emptyAnswer ||
      (!errored &&
        (ended?.finalText === undefined || ended.finalText.trim() === '')))
  ) {
    await settleTaskAgentTurn(ctx, args, {
      errored: true,
      reason:
        endReason ??
        'the agent ended its turn without a final report — retrying the conversation',
      text: '',
      ...(window.agentSessionId !== undefined
        ? { agentSessionId: window.agentSessionId }
        : {}),
      failureCode: 'empty_turn',
      ...(ended?.usageTotals !== undefined
        ? { usageTotals: ended.usageTotals }
        : {}),
    });
    return;
  }
  const text =
    ended?.finalText !== undefined && ended.finalText !== ''
      ? ended.finalText
      : (window.answerText ?? window.text);
  // The harness's own words ARE the reason when it reported the error
  // itself: the failure it named on its stream (classify carries it), else
  // its last words — never bury a "401 token revoked" behind a generic line.
  // A spend refusal (402) is named as such first, whichever way it arrived.
  const spendRefused = errored && isSpendRefusal(ended);
  const reason = spendRefused
    ? spendRefusalReason(window.harnessError ?? text)
    : (endReason ?? (errored ? failureReasonFromFinalText(text) : undefined));
  await settleTaskAgentTurn(ctx, args, {
    errored,
    ...(reason !== undefined ? { reason } : {}),
    text,
    ...(window.agentSessionId !== undefined && !launchFailed
      ? { agentSessionId: window.agentSessionId }
      : {}),
    // A spend refusal (402) is named as such: the auto-retry must not
    // re-kick it (the key is sized from the same exhausted balance), and
    // the run row should say why.
    ...(errored
      ? {
          failureCode: spendRefused
            ? ('budget_exceeded' as const)
            : ended?.providerErrorKind === 'model_capacity'
              ? ('model_capacity' as const)
              : ('harness_error' as const),
        }
      : {}),
    // The harness-reported provider status (429/401/…) — absent for
    // mid-stream deaths and non-claude harnesses; stamped for observability.
    ...(errored && ended?.apiErrorStatus !== undefined
      ? { apiErrorStatus: ended.apiErrorStatus }
      : {}),
    ...(ended?.usageTotals !== undefined
      ? { usageTotals: ended.usageTotals }
      : {}),
  });
}

/** Keep the agent report in its own language. Runtime delivery facts are a
 * separate, translated system comment, never English appended to that report. */
export function buildSettleComments(args: {
  resultText: string;
  fileNames: readonly string[];
  skipped: readonly HarvestSkippedOutput[];
}): { body?: string; noticeByLocale?: TaskCommentBodies } {
  const report = args.resultText.trim();
  const reportTruncated = report.length > TASK_COMMENT_MAX;
  const body = reportTruncated
    ? `${report.slice(0, TASK_COMMENT_MAX - 1)}…`
    : report;
  const labels = {
    en: {
      delivered: 'Deliverables:',
      skipped: 'Not delivered:',
      noReport: 'The agent finished without a report.',
      truncated: 'The report was shortened. The full text is on the run.',
      listTruncated:
        'The file list was shortened. The task keeps the full list of delivered files.',
    },
    de: {
      delivered: 'Ergebnisse:',
      skipped: 'Nicht bereitgestellt:',
      noReport: 'Der Agent hat den Lauf ohne Bericht beendet.',
      truncated:
        'Der Bericht wurde gekürzt. Der vollständige Text ist beim Lauf verfügbar.',
      listTruncated:
        'Die Dateiliste wurde gekürzt. Die vollständige Liste der bereitgestellten Dateien bleibt an der Aufgabe erhalten.',
    },
    fr: {
      delivered: 'Livrables :',
      skipped: 'Fichiers non remis :',
      noReport: 'L’agent a terminé sans compte rendu.',
      truncated:
        'Le compte rendu a été abrégé. Le texte intégral reste disponible dans l’exécution.',
      listTruncated:
        'La liste des fichiers a été abrégée. La tâche conserve la liste complète des fichiers remis.',
    },
  };
  const render = (locale: keyof typeof labels): string => {
    const text = labels[locale];
    const parts = [
      ...(report === '' ? [text.noReport] : []),
      ...(reportTruncated ? [text.truncated] : []),
      ...(args.fileNames.length > 0
        ? [
            [text.delivered, ...args.fileNames.map((name) => `- ${name}`)].join(
              '\n',
            ),
          ]
        : []),
      ...(args.skipped.length > 0
        ? [
            [
              text.skipped,
              ...args.skipped.map(
                (skip) =>
                  `- ${skip.path.split('/').at(-1) ?? skip.path} — ${skip.reasonByLocale?.[locale] ?? skip.reason}`,
              ),
            ].join('\n'),
          ]
        : []),
    ];
    const full = parts.join('\n\n');
    if (full.length <= TASK_COMMENT_MAX) return full;
    const tail = `\n\n… ${text.listTruncated}`;
    return `${full.slice(0, TASK_COMMENT_MAX - tail.length)}${tail}`;
  };
  const noticeByLocale = {
    en: render('en'),
    de: render('de'),
    fr: render('fr'),
  };
  return {
    ...(body !== '' ? { body } : {}),
    ...(noticeByLocale.en !== '' ? { noticeByLocale } : {}),
  };
}

/**
 * Settle exactly once (the session-op finalize claim elects the winner):
 * harvest `/agent/output`, then on success post the agent's report as a task
 * comment and park the task at `in_review`; on failure record the error on
 * the run row and leave the task where it is.
 */
async function settleTaskAgentTurn(
  ctx: ActionCtx,
  args: TurnKeys,
  result: {
    errored: boolean;
    reason?: string;
    text: string;
    /** The harness conversation id to stamp with the terminal flip — the
     * next kick's `--resume` handle. Callers withhold it from windows that
     * never became a conversation (`isResumeLaunchFailure`). */
    agentSessionId?: string;
    /** Producer-side failure classification — decides whether the failed
     * mark arms an auto-retry. Absent = retryable (the default posture). */
    failureCode?: TaskRunFailureCode;
    /** The harness-reported provider HTTP status, when there was one. */
    apiErrorStatus?: number;
    /** No retry can start before this, epoch ms: the subscription broker's
     * every account was cooling down after a rate limit
     * (`classifyStartFailure`). */
    retryAtMs?: number;
    /** The harness's own token totals, booked alongside the gateway spend. */
    usageTotals?: { inputTokens: number; outputTokens: number };
  },
): Promise<void> {
  const current = await ctx.runQuery(
    internal.tasks.agent_runs.getTaskAgentRunForDrive,
    { runId: args.runId },
  );
  if (
    current === null ||
    current.execId !== args.execId ||
    (current.status !== 'queued' && current.status !== 'running')
  ) {
    await sessionCancelExec(args.sessionId, args.execId).catch((error) =>
      console.warn('[task-agent] cancelled settle exec reap failed:', error),
    );
    await releaseTurnKey(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId: args.execId,
      status: 'cancelled',
    });
    await releaseProjectAgentSlotAfterSettle(ctx, args);
    return;
  }
  const release = await releaseTurnKey(ctx, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    execId: args.execId,
    status: result.errored ? 'failed' : 'completed',
    ...(result.usageTotals !== undefined
      ? { usageTotals: result.usageTotals }
      : {}),
  });
  if (!release.won) {
    // The finalize claim keys on the op row — a start that died BEFORE
    // writing one (model unresolvable, spawner error, staging failure) loses
    // the claim with the run still live, and returning here would strand it
    // at `queued` with the real reason lost (observed live: a quota throw
    // rotted for 4½ minutes, then the watchdog failed it with a wrong
    // message). Mirror of the automation lane's fallback: when this exec
    // still owns a non-terminal run, finish the job — the mark mutations are
    // first-wins, so racing a live winner degrades to a no-op.
    const run = await ctx.runQuery(
      internal.tasks.agent_runs.getTaskAgentRunForDrive,
      { runId: args.runId },
    );
    if (
      run === null ||
      run.execId !== args.execId ||
      run.status === 'settled' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return;
    }
    console.warn(
      `[task-agent] finalize claim for ${args.execId} was burned with the run still live — recording the settle anyway`,
    );
  }

  if (result.errored) {
    if (result.apiErrorStatus === 429 && current.brokerTokenHash) {
      await ctx.runMutation(
        internal.provider_credentials.mutations.recordBrokerFailureInternal,
        {
          organizationId: args.organizationId,
          brokerTokenHash: current.brokerTokenHash,
          apiErrorStatus: result.apiErrorStatus,
        },
      );
    }
    // A 401 on a brokered turn is the broker refreshing the account under
    // it: the token this exec was started with is revoked, the account holds
    // a fresh one. Named as such, the retry vends again and resumes the
    // conversation without spending the budget or excluding the account
    // (`freeCredentialRotations`). The stamp is this exec's, cleared when it
    // served on another lane, so it says how THIS turn was served.
    const failureCode =
      result.failureCode === 'harness_error' &&
      isCredentialRotation({
        apiErrorStatus: result.apiErrorStatus,
        brokerServed: Boolean(current.brokerTokenHash),
      })
        ? ('credential_rotated' as const)
        : result.failureCode;
    await ctx.runMutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      runId: args.runId,
      error: result.reason ?? 'the agent run failed',
      // Exec-guarded: a chain superseded by a restart-steer rotation must
      // not terminal-stamp the run its successor is working on.
      execId: args.execId,
      // A failed turn's conversation is still resumable — the standing
      // workspace holds its state — so the handle is stamped here too.
      ...(result.agentSessionId !== undefined
        ? {
            agentSessionId: result.agentSessionId,
            ...(args.sessionCreatedAt !== undefined
              ? { sessionCreatedAt: args.sessionCreatedAt }
              : {}),
          }
        : {}),
      ...(failureCode !== undefined ? { failureCode } : {}),
      ...(result.apiErrorStatus !== undefined
        ? { apiErrorStatus: result.apiErrorStatus }
        : {}),
      ...(result.retryAtMs !== undefined
        ? { retryAtMs: result.retryAtMs }
        : {}),
    });
    await releaseProjectAgentSlotAfterSettle(ctx, args);
    return;
  }

  let files: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }> = [];
  let fileNames: string[] = [];
  let skipped: HarvestSkippedOutput[] = [];
  try {
    const harvested = await harvestSessionOutput(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      outputDir: taskOutputDir(args.taskId),
      execId: args.execId,
    });
    // Outputs the harvest could not bring back (caps, unreadable, storage
    // rejection) go into the settle comment — the reviewer must see WHAT is
    // missing, not a deliverables list that reads as complete.
    skipped = harvested.harvestSkipped;
    files = harvested.files.map((file) => ({
      fileId: file.storageId,
      fileName: file.path.split('/').at(-1) ?? file.path,
      fileType: file.contentType,
      fileSize: file.size,
    }));
    fileNames = files.map((file) => file.fileName);
  } catch (err) {
    // The turn's work may be done, but its deliverables are gone — parking
    // the task `in_review` with a clean, empty comment would launder an
    // infra fault into "produced nothing" (the class harvestSessionOutput
    // now throws to expose). Fail the run with the real reason instead; a
    // rerun can redo the work, an invisible loss cannot be acted on.
    console.warn('[task-agent] output harvest failed:', err);
    await ctx.runMutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      runId: args.runId,
      error: `output harvest failed: ${err instanceof Error ? err.message : String(err)}`,
      // Exec-guarded: a chain superseded by a restart-steer rotation must
      // not terminal-stamp the run its successor is working on.
      execId: args.execId,
      failureCode: 'harvest_failed',
    });
    await releaseProjectAgentSlotAfterSettle(ctx, args);
    return;
  }

  const resultText = result.text.trim();
  const comments = buildSettleComments({ resultText, fileNames, skipped });

  await ctx.runMutation(internal.tasks.agent_runs.completeTaskAgentRun, {
    organizationId: args.organizationId,
    taskId: args.taskId,
    agentId: args.agentId,
    runId: args.runId,
    files,
    ...comments,
    resultText,
    // Exec-guarded, same reason as the failed mark above.
    execId: args.execId,
    ...(result.agentSessionId !== undefined
      ? {
          agentSessionId: result.agentSessionId,
          ...(args.sessionCreatedAt !== undefined
            ? { sessionCreatedAt: args.sessionCreatedAt }
            : {}),
        }
      : {}),
  });
  await releaseProjectAgentSlotAfterSettle(ctx, args);
}

/**
 * Free the agent's standing-session slot the moment its run ends — the org's
 * whole agent budget otherwise stays held through the ~30-min idle sweep. A
 * sibling task's live turn keeps the session up (the release mutation checks
 * running ops AND live runs of the agent, so a sibling that is admitted but
 * has no exec yet is not uncounted); the workspace is preserved either way.
 * The run's workspace rides along: the ended exec freed one of its live-exec
 * places, which a run parked on that workspace waits for.
 * Best-effort: a failed release costs latency (the task watchdog's orphan
 * backstop gets it), never the settle.
 */
async function releaseProjectAgentSlotAfterSettle(
  ctx: ActionCtx,
  args: Pick<TurnKeys, 'organizationId' | 'agentId' | 'sessionId'>,
): Promise<void> {
  try {
    await ctx.runMutation(
      internal.sandbox.session_mutations.releaseProjectAgentSessionSlot,
      {
        organizationId: args.organizationId,
        agentId: args.agentId,
        sessionId: args.sessionId,
      },
    );
  } catch (err) {
    console.warn('[task-agent] session-slot release failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Mid-run comment steering — the @mention door's live-engine branch
// ---------------------------------------------------------------------------

/** Which steering lane a harness supports: `stdin` when its YAML declares
 * the steering capability (a held-open NDJSON stdin the CLI keeps reading),
 * else `restart` — the CLI takes no input once launched, so the comment
 * reaches the run by killing the exec and continuing on a fresh
 * incarnation. Exported for its unit test. */
function steerLaneForHarness(harness: string): 'stdin' | 'restart' {
  if (!isHarnessSlug(harness)) return 'restart';
  const def = loadHarnesses().find((h) => h.slug === harness);
  return def?.capabilities.steering === true ? 'stdin' : 'restart';
}

/** The injected line a live turn reads for a mid-run task comment — or,
 * for a description that newly names the agent, for that edit (said as an
 * edit, not as a comment). The CLI queues a mid-step stdin line to its next
 * API boundary, exactly like interactive steering, so the turn absorbs it
 * without losing work. Exported for its unit test. */
export function buildSteerCommentText(
  author: string,
  body: string,
  source: MentionSource = 'comment',
): string {
  return [
    source === 'description'
      ? `${author} edited the task description to mention you while you are working. It now reads:`
      : `Task comment from ${author}, posted while you are working:`,
    body,
    'If this changes what you should do, adjust course now. Otherwise take it into account and cover it in your final report.',
  ].join('\n\n');
}

/** The opening prompt of a RESUMED restart — same task, same conversation,
 * continued on a fresh process with the comment (or the description edit)
 * in hand. Exported for its unit test. */
export function buildResumeSteerPrompt(
  author: string,
  body: string,
  source: MentionSource = 'comment',
): string {
  return [
    source === 'description'
      ? 'Your process was restarted because the task description was edited to mention you while you were working. This is the SAME task and the SAME conversation — continue from where you left off and do NOT redo completed work.'
      : 'Your process was restarted to deliver a task comment that arrived while you were working. This is the SAME task and the SAME conversation — continue from where you left off and do NOT redo completed work.',
    source === 'description'
      ? `${author} edited the task description. It now reads:`
      : `Task comment from ${author}:`,
    body,
    'When you are done, end with a short report of what you did and what you produced — that report is posted back to the task for human review.',
  ].join('\n\n');
}

/** Prefixed to the rebuilt brief when the harness conversation could NOT be
 * resumed (no --resume handle captured yet): the fresh conversation leans on
 * the brief and on the standing workspace, which still holds everything the
 * interrupted attempt produced. */
const FRESH_RESTART_NOTE =
  'You were interrupted mid-run to receive a new task comment, and the previous conversation could not be resumed. Your workspace and delivery box still hold everything already produced — inspect them and continue the work rather than starting over.';

/** The same note when the interruption was a description edit that named
 * the agent: the rebuilt brief's Description IS that edit, so the note
 * points at it instead of at a comment the prompt does not carry. */
const FRESH_RESTART_DESCRIPTION_NOTE =
  'You were interrupted mid-run because the task description was edited to mention you, and the previous conversation could not be resumed. The Description below is its current text — act on what it now asks. Your workspace and delivery box still hold everything already produced — inspect them and continue the work rather than starting over.';

/** Retry ladder while a turn is inside its settle window (finalize claimed,
 * terminal run state imminent): tight at first — a settle is normally
 * seconds — then coarse through a long harvest, until the run goes terminal
 * and the steer degrades to a fresh mention kick. */
const STEER_RETRY_TIGHT_MS = 5_000;
const STEER_RETRY_COARSE_MS = 30_000;
const STEER_TIGHT_ATTEMPTS = 3;
const STEER_MAX_ATTEMPTS = 15;

/**
 * Deliver a mid-run task comment INTO the live turn — scheduled by the
 * @mention door when the mentioned agent is the one already running
 * (`triggerMentionedProjectAgent`). Two lanes by harness capability
 * (`steerLaneForHarness`); every miss degrades and none errors: a run found
 * terminal falls back to a fresh `trigger:'mention'` kick — exactly what
 * the mention means with no live engine — and a turn caught mid-settle is
 * retried until its run settles and takes that same fallback. The comment
 * itself posted long ago; this action only decides HOW it reaches the
 * agent. A description edit that newly names the running agent rides the
 * same lanes (`mentionSource: 'description'`), phrased as an edit, and its
 * fallback kick reads the description as it stands when that run starts.
 */
/** The steer's full argument shape — `turnArgs` plus the comment. */
export interface SteerTaskAgentTurnArgs extends TurnKeys {
  model: string;
  modelProvider?: string;
  instructions?: string;
  skills: string[];
  connectors: string[];
  tools: string[];
  secrets: string[];
  feedback: string;
  /** Which text `feedback` is; absent reads as a comment (a steer queued
   * before the field existed). */
  mentionSource?: MentionSource;
  author: string;
  authorId: string;
  /** The API key the text was written with; absent from a steer queued
   * before it was carried. */
  authorApiKeyId?: string;
  attempt: number;
}

/**
 * The steer as a PLAIN exported function — the internalAction below wraps
 * it, and the 0.5 backend's `task.agent_steer` job runs it on the ctx shim
 * (same pattern as `startTaskAgentTurnImpl`).
 */
export async function steerTaskAgentTurnImpl(
  ctx: ActionCtx,
  args: SteerTaskAgentTurnArgs,
): Promise<null> {
  const retry = async (execId: string): Promise<null> => {
    if (args.attempt >= STEER_MAX_ATTEMPTS) {
      console.warn(
        `[task-agent] steer for ${args.execId} gave up after ${String(args.attempt)} attempts — the comment stays in the discussion for the next run`,
      );
      return null;
    }
    await ctx.scheduler.runAfter(
      args.attempt < STEER_TIGHT_ATTEMPTS
        ? STEER_RETRY_TIGHT_MS
        : STEER_RETRY_COARSE_MS,
      internal.tasks.agent_run_host.steerTaskAgentTurn,
      { ...args, execId, attempt: args.attempt + 1 },
    );
    return null;
  };
  const kickFallback = async (): Promise<null> => {
    await ctx.runMutation(
      internal.tasks.mutations.kickMentionRunAfterSteerMiss,
      {
        // The shim handler binds organizationId into its SQL; omitting it made
        // postgres.js throw UNDEFINED_VALUE, losing every settled-run fallback
        // kick (task.agent_steer has retryLimit 0). TurnKeys carries it.
        organizationId: args.organizationId,
        taskId: args.taskId,
        authorId: args.authorId,
        ...(args.authorApiKeyId !== undefined
          ? { apiKeyId: args.authorApiKeyId }
          : {}),
        feedback: args.feedback,
        mentionSource: args.mentionSource ?? 'comment',
      },
    );
    return null;
  };

  const run: {
    status: string;
    execId: string;
    sessionId: string;
    organizationId: string;
  } | null = await ctx.runQuery(
    internal.tasks.agent_runs.getTaskAgentRunForDrive,
    {
      runId: args.runId,
    },
  );
  if (run === null) return null;
  if (
    run.status === 'settled' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  ) {
    // The engine settled while the comment was in flight — the mention now
    // means what it means with no live run: a fresh run carrying it.
    return await kickFallback();
  }
  if (run.status !== 'running') {
    // Still queued (capacity-parked or start in flight): the start reads
    // the brief AFTER the comment posted, so the turn opens with it.
    return null;
  }
  if (run.execId !== args.execId) {
    // A sibling steer rotated the exec under us — re-aim at the current
    // incarnation.
    return await retry(run.execId);
  }
  if (Date.now() > args.deadlineAt) return null; // the drive's deadline cut owns this turn

  const op = await ctx.runQuery(
    internal.sandbox.session_queries.getOpSteerState,
    { sessionId: args.sessionId, execId: args.execId },
  );
  if (op === null || op.status !== 'running' || op.finalized) {
    // The turn is settling (its result exists; nobody reads new input) —
    // wait for the run to go terminal, then the fallback above kicks.
    return await retry(args.execId);
  }

  if (steerLaneForHarness(args.harness) === 'stdin') {
    const line = buildStdinUserMessage(
      buildSteerCommentText(args.author, args.feedback, args.mentionSource),
    );
    try {
      // buildStdinUserMessage is already newline-terminated, and runnerd
      // fail-closes on anything but exactly one \n-terminated JSON line
      // (a malformed line kills Claude Code's stream-json reader).
      const wrote = await sessionWriteExecStdin(args.sessionId, args.execId, {
        dataBase64: Buffer.from(line, 'utf8').toString('base64'),
      });
      if (!wrote.ok) {
        throw new Error(`stdin write refused: ${wrote.reason ?? 'unknown'}`);
      }
    } catch (err) {
      // Exec just ended, daemon blip — the run re-read on the retry sorts
      // live (re-inject) from settled (fresh kick).
      console.warn('[task-agent] stdin steer failed, retrying:', err);
      return await retry(args.execId);
    }
    console.warn(
      `[task-agent] steered live turn ${args.execId} with a task comment (stdin)`,
    );
    return null;
  }

  // RESTART lane: rotate the run onto a fresh incarnation (the
  // single-winner claim), kill the old exec, and continue the conversation
  // with the comment in hand. The superseded chain orphans itself: its
  // settle marks are exec-guarded and the slot release refuses while the
  // incarnation's op runs.
  // The restarted turn is the steering person's gesture: its spend books to
  // them — and to the key they wrote with — from here on, as a fresh run
  // they kicked would.
  const rotated = await ctx.runMutation(
    internal.tasks.agent_runs.rotateTaskAgentRunExec,
    {
      runId: args.runId,
      fromExecId: args.execId,
      startedBy: args.authorId,
      ...(args.authorApiKeyId !== undefined
        ? { apiKeyId: args.authorApiKeyId }
        : {}),
    },
  );
  if (rotated === null) return await retry(args.execId); // raced a settle/cancel/steer
  const execId = rotated.execId;
  // A rotation, not a Stop: the old exec's own processes end, while what the
  // turn started outside them (a dev server it is testing against) stays up
  // for the restarted turn, which goes on where this one stopped.
  await sessionCancelExec(args.sessionId, args.execId, {
    keepLeftovers: true,
  }).catch((err) =>
    console.warn('[task-agent] steer kill of the old exec failed:', err),
  );
  try {
    // Same order as the fresh start: resolve early, mint late — and the
    // SAME lanes, so a steer restart of a subscription turn re-redeems
    // the vendor token instead of manufacturing a gateway key.
    const resolved = await resolveTaskServing(ctx, {
      organizationId: args.organizationId,
      model: args.model,
      ...(args.modelProvider !== undefined
        ? { modelProvider: args.modelProvider }
        : {}),
      harness: args.harness,
    });
    const projectScope = await ctx.runQuery(
      internal.projects.internal_queries.getProjectAgentSkillScope,
      {
        agentId: args.agentId,
      },
    );
    const skillsAddendum = await stageWorkflowSkills(
      ctx,
      args.organizationId,
      args.sessionId,
      args.skills,
      projectScope === null
        ? { kind: 'org' }
        : { kind: 'project', teamIds: projectScope.teamIds },
    );
    // The reservation belongs to the ROTATED exec, like every stamp below.
    const prepared = await mintTurnServing(ctx, { ...args, execId }, resolved);
    // Stamp or clear under the ROTATED execId: the old id would silently
    // retain a predecessor's account and blame it for the new lane's 429.
    await ctx.runMutation(
      internal.tasks.agent_runs.stampTaskAgentRunBrokerToken,
      {
        runId: args.runId,
        execId,
        brokerTokenHash: prepared.brokerTokenHash ?? null,
      },
    );
    // The same grant set and caller as the first start, for the rotated exec
    // — image generation re-decided against the policy as it is now.
    const imageModel = harnessMountsMcp(args.harness)
      ? await resolveTurnImageGeneration(ctx, args.organizationId)
      : null;
    await insertTaskTurnSessionToken(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId,
      harness: args.harness,
      connectors: args.connectors,
      tools: args.tools,
      imageGeneration: imageModel !== null,
      deadlineAt: args.deadlineAt,
      prepared,
    });

    const outputDir = taskOutputDir(args.taskId);
    // Same handle hygiene as the kick lane: the id is parsed CLI stdout, so
    // a forged value must never reach an argv — an invalid one downgrades
    // to the fresh-restart branch below. So does a harness the platform
    // never resumes (Gemini CLI): the comment reaches it on a fresh
    // conversation over the rebuilt brief.
    const resume =
      harnessResumesConversations(args.harness) &&
      op.agentSessionId !== undefined &&
      isValidResumeHandle(op.agentSessionId)
        ? op.agentSessionId
        : undefined;
    let prompt: string;
    if (resume !== undefined) {
      prompt = buildResumeSteerPrompt(
        args.author,
        args.feedback,
        args.mentionSource,
      );
    } else {
      // Killed before the harness announced its conversation id — restart
      // as a fresh conversation over the rebuilt brief; the standing
      // workspace still holds the interrupted attempt's state.
      const brief = await ctx.runQuery(
        internal.tasks.agent_runs.getTaskBriefForAgentRun,
        {
          taskId: args.taskId,
        },
      );
      if (brief === null) throw new Error('the task no longer exists');
      const inputs = await stageTaskInputs(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        taskId: args.taskId,
        attachments: brief.attachments,
        outputs: brief.outputs,
      });
      // Same rule as the fresh start: a blind serving never runs over
      // image inputs (nothing gateway-side was minted on this lane).
      if (resolved.lane === 'subscription') {
        refuseBlindImageTurn(resolved.vision, [
          ...inputs.attachments,
          ...inputs.outputs,
        ]);
      }
      // A description edit is already the brief's Description, read fresh
      // above: carrying it as feedback too would say it twice.
      prompt =
        args.mentionSource === 'description'
          ? [
              FRESH_RESTART_DESCRIPTION_NOTE,
              buildTaskPrompt(brief, undefined, outputDir, inputs),
            ].join('\n\n')
          : [
              FRESH_RESTART_NOTE,
              buildTaskPrompt(brief, args.feedback, outputDir, inputs),
            ].join('\n\n');
    }
    const visionGuidance =
      resolved.lane === 'subscription'
        ? visionUnreadableGuidance(resolved.vision)
        : '';

    await ctx.runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      execId,
      kind: 'task-agent',
      status: 'running',
      modelRef: prepared.modelRef,
      harness: args.harness,
      deadlineMs: args.deadlineAt,
      heartbeatAt: Date.now(),
      ...(prepared.mintedKeyId !== undefined
        ? { mintedKeyId: prepared.mintedKeyId }
        : {}),
      // Carry the handle forward so a SECOND restart can resume too.
      ...(resume !== undefined ? { agentSessionId: resume } : {}),
    });

    const toolsGuidance = grantedToolsGuidance(normalizeToolGrants(args.tools));
    const mandatoryInstructions = await readMandatoryInstructions(
      ctx,
      args.organizationId,
      '[task-agent]',
    );
    const confined = await isTurnConfined(ctx, args.runId);
    const instructions = [
      // The organization's Custom instructions lead, as on a chat turn.
      ...(mandatoryInstructions !== undefined ? [mandatoryInstructions] : []),
      ...(args.instructions !== undefined && args.instructions !== ''
        ? [args.instructions]
        : []),
      agentLanguageGuidance(
        await ctx.runQuery(internal.tasks.agent_runs.getAgentLanguageContext, {
          organizationId: args.organizationId,
          taskId: args.taskId,
        }),
      ),
      ...(skillsAddendum !== '' ? [skillsAddendum] : []),
      `Write every file you produce to ${outputDir}/ (this task's own delivery box — never plain /agent/output/) — files there are collected when your turn ends and attached to the task.`,
      confined ? MEMBER_WORKSPACE_GUIDANCE : STANDING_WORKSPACE_GUIDANCE,
      KNOWLEDGE_TOOLS_GUIDANCE,
      ...(toolsGuidance !== undefined ? [toolsGuidance] : []),
      ...(imageModel !== null ? [imageGenerationGuidance(outputDir)] : []),
      ...(visionGuidance !== '' ? [visionGuidance] : []),
      ...(confined
        ? [memberRunGuidance(withheldCredentials(args))]
        : secretsGuidance(args.secrets)),
    ].join('\n\n');

    // Judged again for the restart: the steer re-books the run to the person
    // who steered it, and a run in a member's workspace stays confined.
    const extraEnv = confined
      ? {}
      : await resolveTurnEquipmentEnv(ctx, {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          connectors: args.connectors,
          secrets: args.secrets,
        });

    // Same window resolution as the fresh start, under the rotated exec.
    const contextWindow = await resolveHarnessTurnContextWindow(ctx, {
      organizationId: args.organizationId,
      providerSlug: resolved.providerSlug,
      modelId: resolved.modelId,
      sessionId: args.sessionId,
      execId,
      kind: 'task-agent',
    });
    const exec = buildExternalTurnExec({
      harness: args.harness,
      gatewayModel: prepared.execModel,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      serving: prepared.serving,
      instructions,
      prompt,
      execId,
      ...(resume !== undefined ? { resume } : {}),
      // Always mounted: the knowledge pair rides the bridge, so every
      // task turn gets the shim even when the agent has no connectors.
      bridgeUrl: connectorsBridgeUrlForSessions(),
      ...(Object.keys(extraEnv).length > 0 ? { extraEnv } : {}),
      ...(prepared.visionModelRef !== undefined
        ? {
            vision: {
              model: prepared.visionModelRef,
              polyfillReads: prepared.visionPolyfillReads === true,
            },
          }
        : {}),
    });

    console.warn(
      `[task-agent] restarted turn ${args.execId} as ${execId} to take a task comment (${resume !== undefined ? 'resumed conversation' : 'fresh conversation'})`,
    );
    const keys = { ...args, execId };
    const progress = liveProgressSink(
      ctx,
      keys,
      'task-agent',
      prepared.visionModelRef,
    );
    const window = await drainHarnessWindow({
      sessionId: args.sessionId,
      execId,
      harness: args.harness,
      start: exec,
      onText: progress.onText,
      onTimeline: progress.onTimeline,
    });
    await progress.flush();
    await continueOrSettle(ctx, keys, window);
  } catch (err) {
    // A restart that failed to LAUNCH must not strand the run at `running`
    // with no engine: settle it under the NEW exec (first-wins,
    // exec-guarded), so Retry works and the comment heads the next brief.
    console.error('[task-agent] steer restart failed:', err);
    // A broker pool cooling down says when its first account is back: the
    // retry waits for it (`classifyStartFailure`).
    const retryAtMs = credentialRetryAtMs(err);
    await settleTaskAgentTurn(
      ctx,
      { ...args, execId },
      {
        errored: true,
        reason: `the run could not be restarted to take a new comment: ${runFailureMessage(err)}`,
        text: '',
        // Retryable: the retry run's resume prompt carries the comment via
        // the discussion delta, so the steer is not lost with the restart.
        // Except for an attachment the store no longer holds — the restart
        // re-stages the brief, and a retry would meet the same 404.
        failureCode: isTaskInputMissingError(err)
          ? 'input_missing'
          : 'steer_restart_failed',
        ...(retryAtMs !== undefined ? { retryAtMs } : {}),
      },
    );
  }
  return null;
}
