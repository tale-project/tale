import type { SandboxCapacity } from '@/app/lib/backend/contract/sandbox';

/** Missing in a successful inventory means stopped; a failed probe says nothing. */
export function sandboxRuntimeState(
  capacity: SandboxCapacity | undefined,
  sessionId: string,
): 'running' | 'starting' | 'stopped' | 'unknown' {
  if (capacity?.status !== 'available') return 'unknown';
  return (
    capacity.runtimeSessions.find((session) => session.sessionId === sessionId)
      ?.state ?? 'stopped'
  );
}
