// Shared session-id + owner-key derivation for every sandbox session lane
// (automation agent runs, crawler renders, project agents). Writers and
// readers must agree on each deterministic id, so the derivations live here
// rather than private to any caller.

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

/** Deterministic session id for an ephemeral crawler RENDER — one throwaway
 * sandbox per render, created + torn down within the render. The caller passes a
 * unique render key so concurrent renders never collide on the id. */
export function sessionIdForRender(renderKey: string): string {
  const suffix = fnv1a64Hex(renderKey);
  return `rnd-${suffix}`.slice(0, 64);
}

/** Deterministic spawner session id for an automation run's sandbox — one
 * workspace per execution, shared by every agent node of the run and torn
 * down when the execution completes. The hash suffix folds the execution id
 * into the ≤64-char ID_ALPHABET_RE budget and keeps the id stable across a
 * resume, so the run dialog can derive the session from the run id alone
 * (`getAgentNodeSandboxOp`) with no join table. */
export function sessionIdForWorkflowExecution(executionId: string): string {
  const suffix = fnv1a64Hex(`${executionId}:@workflow`);
  return `wf-${executionId.slice(0, 24)}-${suffix}`.slice(0, 64);
}

/** Owner key for an automation run's sandbox (sandboxSessions `ownerId`,
 * with `ownerType: 'workflow_run'`). */
export function workflowExecutionOwnerId(executionId: string): string {
  return `${executionId}:@workflow`;
}

/** Owner key for a project agent's sandboxes (sandboxSessions `ownerId`,
 * with `ownerType: 'project_agent'`) — its standing workspace and the
 * workspaces of runs members start alike, told apart by session id. */
export function projectAgentOwnerId(agentId: string): string {
  return agentId;
}

/** The project agent's STANDING session: the workspace every run a project
 * editor (or an automation) starts shares across tasks, persisting between
 * runs so the agent keeps its working state. */
export function standingSessionIdForProjectAgent(agentId: string): string {
  return `pa-${agentId}`;
}

/**
 * The session a project agent's runs work in when they were started by a
 * member who may not edit the project — one per (agent, member). Such a run
 * acts on its own task alone and holds none of the agent's secrets; its own
 * workspace keeps anything it leaves behind away from the standing one,
 * where a later run started by an editor would find it with the secrets and
 * the project-wide tools in hand. The id stays inside the ≤64-char budget:
 * an agent id too long to keep verbatim is folded into a hash.
 */
export function memberSessionIdForProjectAgent(
  agentId: string,
  memberKey: string,
): string {
  const member = `-m${fnv1a64Hex(`${agentId}:${memberKey}`)}`;
  const standing = standingSessionIdForProjectAgent(agentId);
  return standing.length + member.length <= 64
    ? `${standing}${member}`
    : `pa-${fnv1a64Hex(agentId)}${member}`;
}

/** Whether a project agent's run works in its standing session, rather than
 * a workspace of runs a member started. */
export function isStandingProjectAgentSession(
  agentId: string,
  sessionId: string,
): boolean {
  return sessionId === standingSessionIdForProjectAgent(agentId);
}

/** Whether a session id is one of a project agent's: its standing session,
 * or the workspace of any member's runs with it — the inverse of the two
 * derivations above, for a session no row names any more. */
export function isProjectAgentSession(
  agentId: string,
  sessionId: string,
): boolean {
  if (isStandingProjectAgentSession(agentId, sessionId)) return true;
  // `memberSessionIdForProjectAgent`: the member suffix is `-m` + 16 hex.
  const suffixLength = 18;
  const standing = standingSessionIdForProjectAgent(agentId);
  const prefix =
    standing.length + suffixLength <= 64
      ? standing
      : `pa-${fnv1a64Hex(agentId)}`;
  return (
    sessionId.length === prefix.length + suffixLength &&
    sessionId.startsWith(`${prefix}-m`)
  );
}
