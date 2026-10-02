/**
 * What a failed agent run means to the person reading it.
 *
 * A run row keeps two things about its failure: the producer's code
 * (`project_agent_runs.failure_code`, `TaskRunFailureCode`) and the raw
 * reason — the harness's own words, a spawner answer, a provider error. The
 * raw reason is English, often names hosts and payloads, and says nothing
 * about who can do something about it, so it is the detail a person opens,
 * never the sentence a task card or a notification leads with. This module
 * groups the codes by what the reader can do next; each class has one
 * localized sentence (`tasks.agentRun.failure.<class>`) and one notification
 * body (`inbox.agentRunFailed…Body`).
 *
 * The record is keyed by the code union, so a new code fails the build until
 * it is given a class here.
 *
 * Layer A: pure data.
 */

import type { TaskRunFailureCode } from '../../backend/core/tasks/task_auto_retry';

export const TASK_RUN_FAILURE_CLASSES = [
  /** The organization's spending limit refused the run: an admin raises it. */
  'budget',
  /** The agent's own configuration cannot run: a project editor fixes it. */
  'setup',
  /** An attachment's bytes left the object store: whoever can change the
   * task removes it or uploads it again. */
  'input',
  /** The run used up its time window. */
  'time_limit',
  /** No sandbox became free while the run waited for one. */
  'capacity',
  /** The model or its provider failed the turn. */
  'model',
  /** The run never started: the sandbox or the model behind it refused. */
  'start',
  /** The run stopped mid-way on the platform's side. */
  'interrupted',
  /** No code, or one this build does not know. */
  'unknown',
] as const;

export type TaskRunFailureClass = (typeof TASK_RUN_FAILURE_CLASSES)[number];

const CLASS_BY_CODE: Record<TaskRunFailureCode, TaskRunFailureClass> = {
  budget_exceeded: 'budget',
  agent_deleted: 'setup',
  agent_model_missing: 'setup',
  equipment_missing: 'setup',
  input_missing: 'input',
  deadline: 'time_limit',
  park_deadline: 'capacity',
  harness_error: 'model',
  empty_turn: 'model',
  credential_rotated: 'model',
  credential_cooldown: 'model',
  start_failed: 'start',
  session_gone: 'interrupted',
  turn_crashed: 'interrupted',
  harvest_failed: 'interrupted',
  steer_restart_failed: 'interrupted',
};

function isKnownCode(code: string): code is TaskRunFailureCode {
  return Object.hasOwn(CLASS_BY_CODE, code);
}

/** The class of a stored failure code; `unknown` for none or a foreign one. */
export function taskRunFailureClass(
  code: string | null | undefined,
): TaskRunFailureClass {
  if (code == null || !isKnownCode(code)) return 'unknown';
  return CLASS_BY_CODE[code];
}
