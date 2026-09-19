/**
 * The starter of a run — `automation_runs.started_by` and
 * `project_agent_runs.started_by` — names the DOOR that started it, in the
 * format the REST contract publishes on `startedBy`:
 *
 *   `user:<userId>`       a start from the product: the run list, the
 *                         builder, the chat capability, a task's comment
 *   `api-key:<userId>`    a start through the REST API or the MCP endpoint;
 *                         `<userId>` is the key's owner or, on an act-as
 *                         request, the member acted for
 *   `trigger:<triggerId>` a schedule, a webhook or an event firing
 *   `<userId>`            a bare id: every project-agent run, and automation
 *                         runs the builder recorded before it prefixed them
 *
 * The door is not the billing subject. Every reader that needs the PERSON
 * behind a starter — the usage ledger, the budget gate, erasure — goes
 * through this parser, so the format is read in exactly one place; a
 * `split(':')` on a starter anywhere else is a defect. Writers keep the
 * format as it is: the contract, the trigger fire ledger and erasure all
 * read it.
 */
export type RunStarter =
  | { kind: 'user'; userId: string }
  | { kind: 'api-key'; userId: string }
  | { kind: 'trigger'; triggerId: string }
  /** A starter that names nobody usable: an empty value, an empty id behind
   * a prefix, or a form this parser does not know. */
  | { kind: 'unknown'; raw: string };

const USER_PREFIX = 'user:';
const API_KEY_PREFIX = 'api-key:';
const TRIGGER_PREFIX = 'trigger:';

export function parseRunStarter(startedBy: string): RunStarter {
  const unknown: RunStarter = { kind: 'unknown', raw: startedBy };
  if (startedBy.startsWith(USER_PREFIX)) {
    const userId = startedBy.slice(USER_PREFIX.length);
    return userId === '' ? unknown : { kind: 'user', userId };
  }
  if (startedBy.startsWith(API_KEY_PREFIX)) {
    const userId = startedBy.slice(API_KEY_PREFIX.length);
    return userId === '' ? unknown : { kind: 'api-key', userId };
  }
  if (startedBy.startsWith(TRIGGER_PREFIX)) {
    const triggerId = startedBy.slice(TRIGGER_PREFIX.length);
    return triggerId === '' ? unknown : { kind: 'trigger', triggerId };
  }
  // A bare id names a person directly; a value carrying a separator is a
  // door this parser does not know, never a user id.
  if (startedBy === '' || startedBy.includes(':')) return unknown;
  return { kind: 'user', userId: startedBy };
}

/** The person a starter names — `null` for a trigger or an unusable value. */
export function runStarterUserId(startedBy: string): string | null {
  const starter = parseRunStarter(startedBy);
  return starter.kind === 'user' || starter.kind === 'api-key'
    ? starter.userId
    : null;
}
