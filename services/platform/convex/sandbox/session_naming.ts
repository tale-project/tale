// Shared session-id derivation. The external-agent action and the public
// progress query must agree on the deterministic per-thread session id, so it
// lives here rather than private to either caller.

/** Deterministic spawner session id for a thread (ID_ALPHABET_RE-safe). Kept
 * for the no-user fallback; the primary owner is the user (sessionIdForUser). */
export function sessionIdForThread(threadId: string): string {
  return `thr-${threadId}`.slice(0, 64);
}

/** 64-bit FNV-1a, hex — a tiny, sync, runtime-agnostic hash to fold a composite
 * key into the sandbox session-id length budget. Not cryptographic; only needs
 * deterministic uniqueness across (org, user) pairs. */
function fnv1a64Hex(input: string): string {
  // 64-bit FNV-1a via two 32-bit halves (no BigInt — keep it cheap + portable).
  let h1 = 0x811c9dc5; // low 32
  let h2 = 0xcbf29ce4; // high 32
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    // multiply 64-bit accumulator by the FNV prime (0x100000001b3) in halves
    const l1 = (h1 & 0xffff) * 0x1b3;
    const l2 = (h1 >>> 16) * 0x1b3;
    const h1n = (h2 * 0x1b3 + (h1 >>> 16) * 0x100 + (l2 >>> 16)) >>> 0;
    h1 = (l1 + ((l2 & 0xffff) << 16)) >>> 0;
    h2 = h1n >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h2) + hex(h1);
}

/** Deterministic spawner session id for a (org, user) — one persistent sandbox
 * per user PER ORGANIZATION (a user in two orgs gets two isolated sandboxes; an
 * org-A workspace must never be reachable from org B). ID_ALPHABET_RE-safe and
 * ≤64 chars: a readable user-id prefix + an org-scoped hash suffix so the same
 * user in different orgs maps to distinct session ids. */
export function sessionIdForUser(
  organizationId: string,
  userId: string,
): string {
  const suffix = fnv1a64Hex(`${organizationId}:${userId}`);
  return `usr-${userId.slice(0, 24)}-${suffix}`.slice(0, 64);
}

/** Composite owner key for a per-org-user sandbox — used as sandboxSessions
 * `ownerId` so the by_owner reuse + per-owner cap lookups are naturally scoped
 * to (org, user), not just user. */
export function userOwnerId(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

/** Deterministic spawner session id for an EPHEMERAL workflow `sandbox` step
 * run — one throwaway sandbox per (execution, step), torn down at step end. The
 * hash suffix folds the composite key into the ≤64-char ID_ALPHABET_RE budget
 * and keeps the id stable across a step retry (so a colliding orphan is reaped,
 * not duplicated). */
export function sessionIdForWorkflowRun(
  executionId: string,
  stepSlug: string,
): string {
  const suffix = fnv1a64Hex(`${executionId}:${stepSlug}`);
  return `wf-${executionId.slice(0, 24)}-${suffix}`.slice(0, 64);
}

/** Composite owner key for an ephemeral workflow-run sandbox (sandboxSessions
 * `ownerId`), scoped to the (execution, step) so retries reuse/reap the same
 * row and distinct steps never collide. */
export function workflowRunOwnerId(
  executionId: string,
  stepSlug: string,
): string {
  return `${executionId}:${stepSlug}`;
}

/** Deterministic session id for an ephemeral crawler RENDER — one throwaway
 * sandbox per render, created + torn down within the render. The caller passes a
 * unique render key so concurrent renders never collide on the id. */
export function sessionIdForRender(renderKey: string): string {
  const suffix = fnv1a64Hex(renderKey);
  return `rnd-${suffix}`.slice(0, 64);
}

/** Sandbox session scope for workflow `sandbox` steps. */
export type SandboxSessionScope = 'step' | 'workflow';

/** Deterministic spawner session id for a WORKFLOW-SCOPED sandbox — one shared
 * workspace per workflow execution, reused across steps that opt into
 * `sessionScope: "workflow"`. Torn down when the execution completes. The `@`
 * in the hash input keeps it disjoint from every `sessionIdForWorkflowRun`
 * derivation: step slugs can never contain `@` (STEP_SLUG_PATTERN), so a step
 * literally named `workflow` cannot collide with the shared session. */
export function sessionIdForWorkflowExecution(executionId: string): string {
  const suffix = fnv1a64Hex(`${executionId}:@workflow`);
  return `wf-${executionId.slice(0, 24)}-${suffix}`.slice(0, 64);
}

/** Composite owner key for a workflow-scoped sandbox (sandboxSessions
 * `ownerId`). Stays inside the `${executionId}:` range that
 * `listAutomationRunSessionsForExecution` sweeps; the `@` keeps it disjoint
 * from every `${executionId}:<stepSlug>` step owner (slugs never contain `@`). */
export function workflowExecutionOwnerId(executionId: string): string {
  return `${executionId}:@workflow`;
}

/** Per-step durable checkpoint key. Workflow-scoped sessions share one spawner
 * sessionId but each step keeps its own checkpoint row. */
export function agentCheckpointKey(
  spawnerSessionId: string,
  stepSlug: string,
  sessionScope: SandboxSessionScope = 'step',
): string {
  return sessionScope === 'workflow'
    ? `${spawnerSessionId}::${stepSlug}`
    : spawnerSessionId;
}

/** Resolve spawner session id, admission owner id, and checkpoint key. */
export function resolveWorkflowSandboxSession(args: {
  executionId: string;
  stepSlug: string;
  sessionScope?: SandboxSessionScope;
}): {
  sessionId: string;
  ownerId: string;
  checkpointKey: string;
  sessionScope: SandboxSessionScope;
} {
  const sessionScope = args.sessionScope ?? 'step';
  if (sessionScope === 'workflow') {
    const sessionId = sessionIdForWorkflowExecution(args.executionId);
    return {
      sessionId,
      ownerId: workflowExecutionOwnerId(args.executionId),
      checkpointKey: agentCheckpointKey(sessionId, args.stepSlug, 'workflow'),
      sessionScope,
    };
  }
  const sessionId = sessionIdForWorkflowRun(args.executionId, args.stepSlug);
  return {
    sessionId,
    ownerId: workflowRunOwnerId(args.executionId, args.stepSlug),
    checkpointKey: sessionId,
    sessionScope,
  };
}
