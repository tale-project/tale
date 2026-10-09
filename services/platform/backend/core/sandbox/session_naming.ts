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

/** The first worker of the project agent's STANDING family: the workspaces
 * of the runs a project editor (or an automation) starts, persisting between
 * runs so the agent keeps its working state. Each run working at the same
 * time as another has a worker of its own ({@link workerSessionId}). */
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

/** A worker number's `-w<n>` suffix: canonical only, so `-w1`, `-w0` and
 * leading zeros never name a worker (worker 1 carries no suffix). */
const WORKER_SUFFIX_RE = /-w([1-9][0-9]*)$/;

/** The `-m` part of a member's workspace id: `-m` and 16 hex. */
const MEMBER_SUFFIX_RE = /-m[0-9a-f]{16}$/;

/**
 * The session of worker `worker` (1-based) of one of the agent's workspace
 * families, whose worker 1 is `base` — the agent's standing session or one
 * member's workspace with it. Each run of an agent working at the same time
 * as another works in a worker of its own: worker 1 keeps the family's own
 * id, so every workspace that existed before workers did is worker 1; worker
 * n >= 2 appends `-w<n>`. The id stays inside the <=64-char budget: a base
 * too long to keep verbatim with the suffix has its agent part folded into
 * a hash, as {@link memberSessionIdForProjectAgent} folds it.
 */
export function workerSessionId(
  agentId: string,
  base: string,
  worker: number,
): string {
  if (!Number.isInteger(worker) || worker < 1) {
    throw new RangeError(`worker ${worker} is not a worker number`);
  }
  if (worker === 1) return base;
  const suffix = `-w${worker}`;
  if (base.length + suffix.length <= 64) return `${base}${suffix}`;
  const standing = standingSessionIdForProjectAgent(agentId);
  const rest = base.startsWith(standing) ? base.slice(standing.length) : '';
  return `pa-${fnv1a64Hex(agentId)}${rest}${suffix}`;
}

/** Worker `worker` of the agent's standing family. */
export function standingWorkerSessionId(
  agentId: string,
  worker: number,
): string {
  return workerSessionId(
    agentId,
    standingSessionIdForProjectAgent(agentId),
    worker,
  );
}

/** Worker `worker` of one member's family with the agent. */
export function memberWorkerSessionId(
  agentId: string,
  memberKey: string,
  worker: number,
): string {
  return workerSessionId(
    agentId,
    memberSessionIdForProjectAgent(agentId, memberKey),
    worker,
  );
}

/** Which of the agent's workspace families a session id belongs to — its
 * standing one (`agent`) or one member's (`member`) — which worker of it the
 * id names, and the family's base (its worker 1); null when the id is none
 * of the agent's. Canonical ids only: an id no derivation above yields for
 * this agent is not the agent's, whatever it starts with. */
export function projectAgentWorker(
  agentId: string,
  sessionId: string,
): { scope: 'agent' | 'member'; worker: number; base: string } | null {
  const standing = standingSessionIdForProjectAgent(agentId);
  const suffix = WORKER_SUFFIX_RE.exec(sessionId);
  const worker = suffix === null ? 1 : Number(suffix[1]);
  if (!Number.isSafeInteger(worker)) return null;
  if (workerSessionId(agentId, standing, worker) === sessionId) {
    return { scope: 'agent', worker, base: standing };
  }
  const head = suffix === null ? sessionId : sessionId.slice(0, suffix.index);
  const member = MEMBER_SUFFIX_RE.exec(head);
  if (member === null) return null;
  // `memberSessionIdForProjectAgent`: the agent part is kept verbatim while
  // the id fits, else folded.
  const base =
    standing.length + member[0].length <= 64
      ? `${standing}${member[0]}`
      : `pa-${fnv1a64Hex(agentId)}${member[0]}`;
  return workerSessionId(agentId, base, worker) === sessionId
    ? { scope: 'member', worker, base }
    : null;
}

/** The first worker of the workspace family a session id belongs to — the
 * id a run names while it holds no worker (a kick, a park, a wake) — or the
 * id itself when it is none of the agent's workers. */
export function workerFamilyBase(agentId: string, sessionId: string): string {
  return projectAgentWorker(agentId, sessionId)?.base ?? sessionId;
}

/** Whether a project agent's run works in one of its standing workers,
 * rather than in a workspace of runs a member started. */
export function isStandingProjectAgentSession(
  agentId: string,
  sessionId: string,
): boolean {
  return projectAgentWorker(agentId, sessionId)?.scope === 'agent';
}

/** Whether a session id is one of a project agent's: any worker of its
 * standing family, or of any member's family with it — the inverse of the
 * derivations above, for a session no row names any more. */
export function isProjectAgentSession(
  agentId: string,
  sessionId: string,
): boolean {
  return projectAgentWorker(agentId, sessionId) !== null;
}
