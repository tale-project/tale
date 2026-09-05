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

/** Owner key for a project agent's standing sandbox (sandboxSessions
 * `ownerId`, with `ownerType: 'project_agent'`). The session id itself is
 * derived by the run ledger (`sessionIdForProjectAgent`, tasks/agent-runs.ts). */
export function projectAgentOwnerId(agentId: string): string {
  return agentId;
}
