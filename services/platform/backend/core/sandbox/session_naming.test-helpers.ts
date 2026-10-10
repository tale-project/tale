// Agent worker ids by number, for the suites that name a worker directly:
// built from the shipped derivations in `session_naming.ts`, which name a
// worker from its family's base. Test-only: never imported by shipped code.

import {
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
  workerSessionId,
} from './session_naming.ts';

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
