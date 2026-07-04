import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * One agent-on-demand job: an ephemeral sub-agent run spawned by a primary
 * chat agent via the `spawn_agent` tool. The row is the job's source of
 * truth — spec snapshot, live progress, terminal state, usage — and the chat
 * UI renders it as a job card on the PARENT thread.
 *
 * Status is a closed union sized for M1 (fast path). M2 widens it with
 * `queued`; M3 with `parked_user_input` — both data-safe growth.
 */
export const agentJobStatusValidator = v.union(
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('timed_out'),
  v.literal('cancelled'),
);

/** Typed failure reasons — never free-form provider text (PII/leak guard). */
export const agentJobFailureReasonValidator = v.union(
  v.literal('generation_error'),
  v.literal('deadline_exceeded'),
  v.literal('budget_exhausted'),
  v.literal('orphaned'),
);

export const agentJobProgressItemValidator = v.object({
  id: v.string(),
  content: v.string(),
  status: v.union(
    v.literal('pending'),
    v.literal('in_progress'),
    v.literal('done'),
    v.literal('failed'),
    v.literal('cancelled'),
  ),
  /** One-line outcome note set when the item reaches a terminal status. */
  note: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * The resolved, FROZEN job spec. Snapshotted at spawn so a mid-run edit of a
 * skill or agent config never shifts a running job's context (and so the M2
 * checkpoint re-entry reproduces the identical prompt).
 */
export const agentJobSpecValidator = v.object({
  instructions: v.string(),
  input: v.string(),
  /** Methodology skill eagerly rendered into the job prompt (design §3.1). */
  methodologySlug: v.optional(v.string()),
  methodologyVersionHash: v.optional(v.string()),
  renderedMethodology: v.optional(v.string()),
  requestedTools: v.array(v.string()),
  effectiveTools: v.array(v.string()),
  skills: v.array(v.string()),
  integrations: v.array(v.string()),
  modelTier: v.optional(v.union(v.literal('fast'), v.literal('capable'))),
  model: v.string(),
  provider: v.optional(v.string()),
  /** What the layer-2/3 boundary silently narrowed away from the request —
   *  surfaced on the job card AND returned to the parent so it can adapt. */
  narrowed: v.object({
    tools: v.array(v.string()),
    skills: v.array(v.string()),
    integrations: v.array(v.string()),
    methodology: v.optional(v.string()),
  }),
});

export const agentJobsTable = defineTable({
  organizationId: v.string(),
  /** The PARENT chat thread (authorization scope for the job card). */
  threadId: v.string(),
  /** The job's own fresh Agent-SDK thread (transcript; never reused). */
  jobThreadId: v.string(),
  /**
   * The AI-SDK tool-call id of the `spawn_agent` call that started this job.
   * The SAME id arrives on the client as the streamed tool part's id, so the
   * chat can anchor a LIVE job card to its spawn row while the tool is still
   * executing — before the tool result (which carries the jobId) exists.
   */
  toolCallId: v.optional(v.string()),
  /**
   * @deprecated Never read. Early builds anchored job cards to an assistant
   * message; cards now render inline under their `spawn_agent` tool row
   * (which carries the jobId), so nothing writes or reads this. Kept so
   * rows written by those builds still validate.
   */
  messageId: v.optional(v.string()),
  userId: v.optional(v.string()),
  parentAgentSlug: v.string(),
  name: v.string(),
  description: v.string(),
  status: agentJobStatusValidator,
  failureReason: v.optional(agentJobFailureReasonValidator),
  /** Spec-shape version for M2/M3 evolution. */
  specVersion: v.number(),
  spec: agentJobSpecValidator,
  progress: v.array(agentJobProgressItemValidator),
  activeProgressId: v.optional(v.string()),
  /** Idempotency ring for `update_progress` batches (update_todos pattern). */
  recentOpIds: v.array(v.string()),
  resultText: v.optional(v.string()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  costCents: v.number(),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
})
  // `update_progress` resolves its row from the job's own thread id.
  .index('by_job_thread', ['jobThreadId'])
  // Live job cards subscribe to a PARENT thread's jobs while a turn streams.
  .index('by_thread', ['threadId'])
  // Admission stuck-sweep (prefix eq status='running', range on startedAt is
  // client-side) and GC range scan (terminal status + completedAt cutoff).
  .index('by_org_status_completed', [
    'organizationId',
    'status',
    'completedAt',
  ]);
