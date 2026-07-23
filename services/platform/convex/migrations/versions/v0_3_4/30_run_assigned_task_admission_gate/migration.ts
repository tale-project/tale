'use node';

/**
 * 0.3.4 / 30 — upgrade `run-assigned-task` off the pre-#2604 ack-then-run
 * graph, org by org.
 *
 * `builtin-configs/workflows/projects/tasks/run-assigned-task.json` (#2604)
 * dropped the workflow's own pre-run `ack` step (which flipped the task to
 * "In progress" BEFORE the agent run was even admitted) and moved that ack
 * inside run admission (`run_on_task`) instead, so a REFUSED run (queued,
 * budget-paused, disabled agent, …) never touches the status at all — no more
 * To do -> In progress -> To do flash. But workflow packs are copied into an
 * org's tree ONCE, at scaffold time, and `syncDefaultWorkflowInstallations`
 * (`workflows/provision_defaults.ts`) skips an org already provisioned for a
 * slug — so every org that installed this workflow before #2604 kept the OLD
 * on-disk graph (and the bug) forever. This migration rewrites each such
 * org's file directly.
 *
 * Detection is narrow and behavioral, not byte-exact: `up` only proceeds when
 * `guard` still points at `ack`, AND `ack`/`check_refused`/`rollback_quiet`
 * still carry their default operation/expression/wiring — an operator who
 * only renamed a step's `name`/`description` is not "customized" for this
 * purpose, but one who changed what `ack`/`rollback_quiet` DO, or extended
 * `check_refused`'s guardrail list, is left untouched (logged) rather than
 * silently overwritten. `guard`/`check_external`/`check_ok` are patched
 * in place (only the one field each needs); `ack`/`check_refused`/
 * `rollback_quiet` are swapped for canonical new-shape content wholesale
 * because their ROLE changes (a stale name after the rewire would mislead).
 *
 * Purely a content rewrite of a file the org already has — nothing is lost:
 * `down` is the exact inverse (re-detected the same way, off the new shape),
 * so `destructive: false` and `snapshot: 'none'`, matching how
 * `12_triage_backlog_start_trigger` treats its own additive, exactly-reversed
 * change to this same pack.
 */

import { resolveWorkflowFilePath } from '../../../../legacy/frozen/workflows_file_utils';
import { defineNodeMigration } from '../../../framework/define';

/** Exported for the sibling `migration.test.ts` (seed + assertions), so the
 *  test never hand-retypes the literal step content it verifies. */
export const WORKFLOW_SLUG = 'projects/tasks/run-assigned-task';

const OLD_CHECK_REFUSED_EXPRESSION =
  "steps.run.output.data.refusedReason == 'queued' || steps.run.output.data.refusedReason == 'budget_paused' || steps.run.output.data.refusedReason == 'task_circuit_breaker' || steps.run.output.data.refusedReason == 'automation_disabled'";
const NEW_CHECK_REFUSED_EXPRESSION = `${OLD_CHECK_REFUSED_EXPRESSION} || steps.run.output.data.refusedReason == 'task_not_found'`;

export const OLD_CHECK_OK_DESCRIPTION =
  "Internal runs park at In review now; external dispatches return immediately and the daemon's completion does it later.";
export const NEW_CHECK_OK_DESCRIPTION = `${OLD_CHECK_OK_DESCRIPTION} The In progress ack happens inside run admission (run_on_task), never before it — a refused run must not flash the status.`;

/** The exact `ack` step the pre-#2604 template shipped. */
export const OLD_ACK_STEP: Record<string, unknown> = {
  stepSlug: 'ack',
  name: 'Acknowledge (In progress)',
  stepType: 'action',
  config: {
    type: 'task',
    parameters: {
      operation: 'update_status',
      taskId: '{{input.task._id}}',
      status: 'in_progress',
    },
  },
  nextSteps: { success: 'run' },
};

/** The exact `rollback_quiet` step the pre-#2604 template shipped. */
export const OLD_ROLLBACK_QUIET_STEP: Record<string, unknown> = {
  stepSlug: 'rollback_quiet',
  name: 'Roll back to To do (guardrail already commented)',
  stepType: 'action',
  config: {
    type: 'task',
    parameters: {
      operation: 'update_status',
      taskId: '{{input.task._id}}',
      status: 'todo',
    },
  },
  nextSteps: { success: 'done' },
};

/** The pre-#2604 `check_refused` content ("Guardrail refusal?"). */
export const OLD_CHECK_REFUSED_STEP: Record<string, unknown> = {
  stepSlug: 'check_refused',
  name: 'Guardrail refusal?',
  stepType: 'condition',
  config: {
    expression: OLD_CHECK_REFUSED_EXPRESSION,
    description:
      'Guardrail refusals already posted their own specific comment ' +
      '(queued / budget / breaker) — roll back quietly. Real failures get ' +
      'an explanatory comment.',
  },
  nextSteps: { true: 'rollback_quiet', false: 'fail_comment' },
};

/** The #2604 `check_refused` content ("Did the refusal already explain itself?"). */
export const NEW_CHECK_REFUSED_STEP: Record<string, unknown> = {
  stepSlug: 'check_refused',
  name: 'Did the refusal already explain itself?',
  stepType: 'condition',
  config: {
    expression: NEW_CHECK_REFUSED_EXPRESSION,
    description:
      'Guardrail refusals post their own notices (queued / budget / ' +
      'breaker) and a deleted task has no timeline left — end quietly. ' +
      'Other refusals (agent disabled or not installed) get an explanatory ' +
      'comment; the status stays untouched either way.',
  },
  nextSteps: { true: 'done', false: 'refused_comment' },
};

/** The #2604 `check_admitted` step, new in the upgraded graph. */
export const NEW_CHECK_ADMITTED_STEP: Record<string, unknown> = {
  stepSlug: 'check_admitted',
  name: 'Was the run admitted?',
  stepType: 'condition',
  config: {
    expression: 'steps.run.output.data.runId',
    description:
      'An admitted run (a run row exists) was acked In progress before it ' +
      'failed — explain and roll back. A refused run never touched the ' +
      'status, so there is nothing to roll back.',
  },
  nextSteps: { true: 'fail_comment', false: 'check_refused' },
};

/** The #2604 `refused_comment` step, new in the upgraded graph. */
export const NEW_REFUSED_COMMENT_STEP: Record<string, unknown> = {
  stepSlug: 'refused_comment',
  name: 'Explain why the run never started',
  stepType: 'action',
  config: {
    type: 'task',
    parameters: {
      operation: 'comment',
      taskId: '{{input.task._id}}',
      body:
        '[automated] ⚠️ {{input.assigneeId}} could not start this task: ' +
        "{{steps.run.output.data.error || 'unknown error'}} The task status " +
        'was left unchanged. If the agent is not installed or enabled, ' +
        'enable it on the Agents page — connecting an integration alone ' +
        'does not enable its bundled agents.',
    },
  },
  nextSteps: { success: 'done' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

type Step = Record<string, unknown>;

function findStep(steps: Step[], slug: string): Step | undefined {
  return steps.find((s) => isRecord(s) && s.stepSlug === slug);
}

function ackMatchesDefault(step: Step): boolean {
  const config = record(step.config);
  const params = config && record(config.parameters);
  const next = record(step.nextSteps);
  return (
    config?.type === 'task' &&
    params?.operation === 'update_status' &&
    params.status === 'in_progress' &&
    next?.success === 'run'
  );
}

function rollbackQuietMatchesDefault(step: Step): boolean {
  const config = record(step.config);
  const params = config && record(config.parameters);
  const next = record(step.nextSteps);
  return (
    config?.type === 'task' &&
    params?.operation === 'update_status' &&
    params.status === 'todo' &&
    next?.success === 'done'
  );
}

function checkRefusedIsOldShape(step: Step): boolean {
  const config = record(step.config);
  const next = record(step.nextSteps);
  return (
    config?.expression === OLD_CHECK_REFUSED_EXPRESSION &&
    next?.true === 'rollback_quiet' &&
    next.false === 'fail_comment'
  );
}

function checkRefusedIsNewShape(step: Step): boolean {
  const config = record(step.config);
  const next = record(step.nextSteps);
  return (
    config?.expression === NEW_CHECK_REFUSED_EXPRESSION &&
    next?.true === 'done' &&
    next.false === 'refused_comment'
  );
}

function checkAdmittedMatchesDefault(step: Step): boolean {
  const config = record(step.config);
  const next = record(step.nextSteps);
  return (
    config?.expression === 'steps.run.output.data.runId' &&
    next?.true === 'fail_comment' &&
    next.false === 'check_refused'
  );
}

function refusedCommentMatchesDefault(step: Step): boolean {
  const config = record(step.config);
  const params = config && record(config.parameters);
  const next = record(step.nextSteps);
  return (
    config?.type === 'task' &&
    params?.operation === 'comment' &&
    typeof params.body === 'string' &&
    next?.success === 'done'
  );
}

/** True when `steps` still carries the pre-#2604 ack-then-run graph. */
function isPreFixShape(steps: Step[]): boolean {
  const guard = findStep(steps, 'guard');
  const ack = findStep(steps, 'ack');
  const checkExternal = findStep(steps, 'check_external');
  const checkRefused = findStep(steps, 'check_refused');
  const rollbackQuiet = findStep(steps, 'rollback_quiet');
  if (!guard || !ack || !checkExternal || !checkRefused || !rollbackQuiet) {
    return false;
  }
  return (
    record(guard.nextSteps)?.true === 'ack' &&
    ackMatchesDefault(ack) &&
    record(checkExternal.nextSteps)?.false === 'check_refused' &&
    checkRefusedIsOldShape(checkRefused) &&
    rollbackQuietMatchesDefault(rollbackQuiet)
  );
}

/** True when `steps` already carries the #2604 no-flash admission graph. */
function isPostFixShape(steps: Step[]): boolean {
  const guard = findStep(steps, 'guard');
  const checkExternal = findStep(steps, 'check_external');
  const checkAdmitted = findStep(steps, 'check_admitted');
  const checkRefused = findStep(steps, 'check_refused');
  const refusedComment = findStep(steps, 'refused_comment');
  if (
    !guard ||
    !checkExternal ||
    !checkAdmitted ||
    !checkRefused ||
    !refusedComment
  ) {
    return false;
  }
  return (
    record(guard.nextSteps)?.true === 'run' &&
    record(checkExternal.nextSteps)?.false === 'check_admitted' &&
    checkAdmittedMatchesDefault(checkAdmitted) &&
    checkRefusedIsNewShape(checkRefused) &&
    refusedCommentMatchesDefault(refusedComment)
  );
}

async function readSteps(
  filePath: string,
  orgSlug: string,
  migrationId: string,
  helpers: { readFileSafe(filePath: string): Promise<string | null> },
): Promise<{ parsed: Record<string, unknown>; steps: Step[] } | null> {
  const content = await helpers.readFileSafe(filePath);
  if (content === null) return null; // org never provisioned this workflow

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.warn(
      `[${migrationId}] ${orgSlug}: unparseable ${WORKFLOW_SLUG}.json, leaving untouched:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    console.warn(
      `[${migrationId}] ${orgSlug}: ${WORKFLOW_SLUG}.json has no steps array, leaving untouched`,
    );
    return null;
  }
  return { parsed, steps: parsed.steps as Step[] };
}

export const migration = defineNodeMigration({
  title: 'Upgrade run-assigned-task to the no-flash admission gate',
  description:
    'For every org whose run-assigned-task.json still carries the ' +
    'pre-#2604 ack-then-run graph (guard -> ack -> run; a "Guardrail ' +
    'refusal?" gate that rolls back quietly), drops the ack step, rewires ' +
    'guard/check_external, and swaps in the check_admitted/refused_comment ' +
    'steps so a refused run never flashes To do -> In progress -> To do. ' +
    'Skips (and warns on) a file whose ack/check_refused/rollback_quiet ' +
    "steps don't match their known defaults — an operator customization is " +
    'left alone. down re-detects the upgraded shape the same way and ' +
    'reconstructs the exact pre-#2604 graph.',
  destructive: false,
  snapshot: 'none',
  subjects: { domains: ['workflows'] },

  async up(_ctx, org, helpers) {
    const filePath = resolveWorkflowFilePath(org.slug, WORKFLOW_SLUG);
    const found = await readSteps(
      filePath,
      org.slug,
      helpers.migrationId,
      helpers,
    );
    if (!found) return;
    const { parsed, steps } = found;

    if (isPostFixShape(steps)) return; // already upgraded — idempotent replay

    if (!isPreFixShape(steps)) {
      console.warn(
        `[${helpers.migrationId}] ${org.slug}: ${WORKFLOW_SLUG}.json does ` +
          'not match the known pre-#2604 shape (customized?), leaving untouched',
      );
      return;
    }

    const next = steps.filter(
      (s) => s.stepSlug !== 'ack' && s.stepSlug !== 'rollback_quiet',
    );

    const guard = findStep(next, 'guard');
    if (guard) (guard.nextSteps as Record<string, unknown>).true = 'run';

    const checkOk = findStep(next, 'check_ok');
    const checkOkConfig = checkOk && record(checkOk.config);
    if (checkOkConfig?.description === OLD_CHECK_OK_DESCRIPTION) {
      checkOkConfig.description = NEW_CHECK_OK_DESCRIPTION;
    }

    const checkExternal = findStep(next, 'check_external');
    if (checkExternal) {
      (checkExternal.nextSteps as Record<string, unknown>).false =
        'check_admitted';
    }

    const checkRefusedIndex = next.findIndex(
      (s) => s.stepSlug === 'check_refused',
    );
    if (checkRefusedIndex !== -1) {
      next[checkRefusedIndex] = structuredClone(NEW_CHECK_REFUSED_STEP);
      next.splice(
        checkRefusedIndex + 1,
        0,
        structuredClone(NEW_REFUSED_COMMENT_STEP),
      );
    }

    const checkExternalIndex = next.findIndex(
      (s) => s.stepSlug === 'check_external',
    );
    if (checkExternalIndex !== -1) {
      next.splice(
        checkExternalIndex + 1,
        0,
        structuredClone(NEW_CHECK_ADMITTED_STEP),
      );
    }

    parsed.steps = next;
    await helpers.atomicWrite(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(
      `[${helpers.migrationId}] ${org.slug}: upgraded ${WORKFLOW_SLUG}.json to the no-flash admission gate`,
    );
  },

  async down(_ctx, org, helpers) {
    const filePath = resolveWorkflowFilePath(org.slug, WORKFLOW_SLUG);
    const found = await readSteps(
      filePath,
      org.slug,
      helpers.migrationId,
      helpers,
    );
    if (!found) return;
    const { parsed, steps } = found;

    if (isPreFixShape(steps)) return; // never upgraded (or already rolled back)

    if (!isPostFixShape(steps)) {
      console.warn(
        `[${helpers.migrationId}] ${org.slug}: ${WORKFLOW_SLUG}.json does ` +
          'not match the upgraded shape (customized after up?), leaving untouched',
      );
      return;
    }

    const next = steps.filter(
      (s) =>
        s.stepSlug !== 'check_admitted' && s.stepSlug !== 'refused_comment',
    );

    const guard = findStep(next, 'guard');
    if (guard) (guard.nextSteps as Record<string, unknown>).true = 'ack';

    const checkOk = findStep(next, 'check_ok');
    const checkOkConfig = checkOk && record(checkOk.config);
    if (checkOkConfig?.description === NEW_CHECK_OK_DESCRIPTION) {
      checkOkConfig.description = OLD_CHECK_OK_DESCRIPTION;
    }

    const checkExternal = findStep(next, 'check_external');
    if (checkExternal) {
      (checkExternal.nextSteps as Record<string, unknown>).false =
        'check_refused';
    }

    const checkRefusedIndex = next.findIndex(
      (s) => s.stepSlug === 'check_refused',
    );
    if (checkRefusedIndex !== -1) {
      next[checkRefusedIndex] = structuredClone(OLD_CHECK_REFUSED_STEP);
    }

    const rollbackIndex = next.findIndex((s) => s.stepSlug === 'rollback');
    if (rollbackIndex !== -1) {
      next.splice(
        rollbackIndex + 1,
        0,
        structuredClone(OLD_ROLLBACK_QUIET_STEP),
      );
    }

    const guardIndex = next.findIndex((s) => s.stepSlug === 'guard');
    if (guardIndex !== -1) {
      next.splice(guardIndex + 1, 0, structuredClone(OLD_ACK_STEP));
    }

    parsed.steps = next;
    await helpers.atomicWrite(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(
      `[${helpers.migrationId}] ${org.slug}: restored ${WORKFLOW_SLUG}.json to the pre-#2604 graph`,
    );
  },
});
