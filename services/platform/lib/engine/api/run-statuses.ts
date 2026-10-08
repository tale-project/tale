/**
 * The statuses a run can be in, as every run listing filters on them — the
 * REST API's `?status=` and MCP's `list_runs {statuses}` read this one list,
 * so a status one door accepts is never refused by the other.
 */
export const RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'success',
  'failed',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** The statuses of a run still in flight: what deleting an automation
 * waits for, and what an agent lists to find the runs to stop first. */
export const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
] as const satisfies readonly RunStatus[];
