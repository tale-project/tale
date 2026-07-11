// @vitest-environment node

/**
 * Seeds the exact pre-#2604 `run-assigned-task.json` graph (guard -> ack ->
 * run; a "Guardrail refusal?" gate that rolls back quietly) and drives the
 * REAL up/down through the harness. Beyond the standard ritual (up applies,
 * idempotent replay, down restores byte-for-byte), `cases` cover the two
 * branches the standard ritual can't reach on its own: a file whose
 * `ack`/`check_refused` don't match their known defaults (left untouched),
 * and `down` invoked on an org that was never upgraded (no-op).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
} from '../../../testing/harness.testkit';
import {
  NEW_CHECK_ADMITTED_STEP,
  NEW_CHECK_OK_DESCRIPTION,
  NEW_CHECK_REFUSED_STEP,
  NEW_REFUSED_COMMENT_STEP,
  OLD_ACK_STEP,
  OLD_CHECK_OK_DESCRIPTION,
  OLD_CHECK_REFUSED_STEP,
  OLD_ROLLBACK_QUIET_STEP,
  WORKFLOW_SLUG,
} from './migration';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_3_4/30_run_assigned_task_admission_gate';

const START_STEP = {
  stepSlug: 'start',
  name: 'start',
  stepType: 'start',
  config: {},
  nextSteps: { success: 'guard' },
};
const GUARD_STEP = (target: string) => ({
  stepSlug: 'guard',
  name: 'Skip terminal or archived tasks',
  stepType: 'condition',
  config: {
    expression:
      "input.task.status != 'done' && input.task.status != 'cancelled' && !input.task.archivedAt && input.assigneeId",
    description:
      'Assignment events on closed/archived tasks (e.g. bulk edits) must not start agent work.',
  },
  nextSteps: { true: target, false: 'done' },
});
const RUN_STEP = {
  stepSlug: 'run',
  name: 'Run the assigned agent',
  stepType: 'action',
  config: {
    type: 'agent',
    parameters: {
      operation: 'run_on_task',
      agentSlug: '{{input.assigneeId}}',
      taskId: '{{input.task._id}}',
      trigger: 'assignment',
      instructions:
        'You have been assigned this task on the project board. Do the work it describes to the best of your ability with the tools available, then post your final result as a task comment. Keep the result concise and reviewable — a human will review it next.',
    },
  },
  nextSteps: { success: 'check_ok' },
};
const CHECK_OK_STEP = (description: string) => ({
  stepSlug: 'check_ok',
  name: 'Did the run succeed?',
  stepType: 'condition',
  config: {
    expression:
      'steps.run.output.data.ok == true && steps.run.output.data.external != true',
    description,
  },
  nextSteps: { true: 'to_review', false: 'check_external' },
});
const CHECK_EXTERNAL_STEP = (falseTarget: string) => ({
  stepSlug: 'check_external',
  name: 'Dispatched to an external runtime?',
  stepType: 'condition',
  config: {
    expression:
      'steps.run.output.data.ok == true && steps.run.output.data.external == true',
    description:
      'External work is asynchronous — leave the task In progress; the daemon completes it to In review (or the dispatch watchdog rolls it back).',
  },
  nextSteps: { true: 'done', false: falseTarget },
});
const TO_REVIEW_STEP = {
  stepSlug: 'to_review',
  name: 'Park at In review (human gate)',
  stepType: 'action',
  config: {
    type: 'task',
    parameters: {
      operation: 'update_status',
      taskId: '{{input.task._id}}',
      status: 'in_review',
    },
  },
  nextSteps: { success: 'done' },
};
const FAIL_COMMENT_STEP = {
  stepSlug: 'fail_comment',
  name: 'Explain the failure',
  stepType: 'action',
  config: {
    type: 'task',
    parameters: {
      operation: 'comment',
      taskId: '{{input.task._id}}',
      body: "[automated] ⚠️ {{input.assigneeId}} could not complete this task: {{steps.run.output.data.error || 'unknown error'}} — returned to To do.",
    },
  },
  nextSteps: { success: 'rollback' },
};
const ROLLBACK_STEP = {
  stepSlug: 'rollback',
  name: 'Roll back to To do',
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
const DONE_STEP = {
  stepSlug: 'done',
  name: 'Done',
  stepType: 'output',
  config: {},
  nextSteps: {},
};

/** The exact pre-#2604 graph: guard -> ack -> run; check_refused rolls back quietly. */
function oldShapeSteps(): unknown[] {
  return [
    START_STEP,
    GUARD_STEP('ack'),
    OLD_ACK_STEP,
    RUN_STEP,
    CHECK_OK_STEP(OLD_CHECK_OK_DESCRIPTION),
    CHECK_EXTERNAL_STEP('check_refused'),
    TO_REVIEW_STEP,
    OLD_CHECK_REFUSED_STEP,
    FAIL_COMMENT_STEP,
    ROLLBACK_STEP,
    OLD_ROLLBACK_QUIET_STEP,
    DONE_STEP,
  ];
}

function workflowFile(steps: unknown[]): string {
  return JSON.stringify(
    {
      version: '1.0.0',
      metadata: { labels: ['Tasks', 'Automation'], autoInstall: true },
      triggers: {
        events: [
          {
            eventType: 'task.assigned',
            eventFilter: { assigneeType: 'agent' },
          },
        ],
      },
      config: {
        timeout: 600_000,
        variables: { workflowId: 'tasks_agent_assignment' },
      },
      steps,
    },
    null,
    2,
  );
}

function filePathFor(world: WorldHandle, slug: string): string {
  return (
    path.join(
      world.configRoot,
      slug,
      'workflows',
      ...WORKFLOW_SLUG.split('/'),
    ) + '.json'
  );
}

async function writeWorkflow(
  world: WorldHandle,
  slug: string,
  steps: unknown[],
): Promise<string> {
  const filePath = filePathFor(world, slug);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, workflowFile(steps), 'utf-8');
  return filePath;
}

async function stepsOf(
  filePath: string,
): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(filePath, 'utf-8');
  return (JSON.parse(raw) as { steps: Array<Record<string, unknown>> }).steps;
}

defineMigrationTest({
  id: '0.3.4/30_run_assigned_task_admission_gate',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // org2 with no run-assigned-task.json exercises the per-org no-op path.
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const dir = path.join(root, orgs[0].slug, 'workflows', 'projects', 'tasks');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'run-assigned-task.json'),
      workflowFile(oldShapeSteps()),
      'utf-8',
    );
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const steps = await stepsOf(filePathFor(world, org1.slug));
    const bySlug = new Map(steps.map((s) => [s.stepSlug, s]));

    expect(bySlug.has('ack')).toBe(false);
    expect(bySlug.has('rollback_quiet')).toBe(false);
    expect(bySlug.get('guard')?.nextSteps).toMatchObject({ true: 'run' });
    expect(bySlug.get('check_external')?.nextSteps).toMatchObject({
      false: 'check_admitted',
    });
    expect(bySlug.get('check_admitted')).toEqual(NEW_CHECK_ADMITTED_STEP);
    expect(bySlug.get('check_refused')).toEqual(NEW_CHECK_REFUSED_STEP);
    expect(bySlug.get('refused_comment')).toEqual(NEW_REFUSED_COMMENT_STEP);
    const checkOkConfig = bySlug.get('check_ok')?.config as
      | { description: string }
      | undefined;
    expect(checkOkConfig?.description).toBe(NEW_CHECK_OK_DESCRIPTION);
    // fail_comment/rollback are untouched by the rewire.
    expect(bySlug.get('fail_comment')).toEqual(FAIL_COMMENT_STEP);
    expect(bySlug.get('rollback')).toEqual(ROLLBACK_STEP);

    // org2 never had the file — nothing appears for it.
    expect(await readFileSafe(filePathFor(world, org2.slug))).toBeNull();
  },

  cases: {
    // Uses org1 (the fleet's registered org) and OVERWRITES the file seedFs
    // already placed for it — only a registered org is visited by the node
    // fleet loop at all, so a fixture org the auth component never heard of
    // would silently prove nothing.
    "leaves an org's customized ack step untouched": async (world) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const customAck = {
          ...OLD_ACK_STEP,
          config: {
            type: 'task',
            parameters: {
              operation: 'update_status',
              taskId: '{{input.task._id}}',
              // Operator repurposed the ack step for a different status.
              status: 'blocked',
            },
          },
        };
        const steps = oldShapeSteps().map((s) =>
          (s as { stepSlug: string }).stepSlug === 'ack' ? customAck : s,
        );
        const filePath = await writeWorkflow(world, world.orgs[0].slug, steps);
        const before = await readFile(filePath, 'utf-8');

        await world.applyUpOnly();

        expect(await readFile(filePath, 'utf-8')).toBe(before);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('customized?'),
        );
      } finally {
        warn.mockRestore();
      }
    },

    'down on an org that was never upgraded is a no-op': async (world) => {
      // org1 already carries the OLD shape from seedFs — up was never called.
      const filePath = filePathFor(world, world.orgs[0].slug);
      const before = await readFile(filePath, 'utf-8');

      await world.applyDownOnly();

      expect(await readFile(filePath, 'utf-8')).toBe(before);
    },

    'up on an org already carrying the new shape is a no-op': async (world) => {
      const alreadyNewSteps = [
        START_STEP,
        GUARD_STEP('run'),
        RUN_STEP,
        CHECK_OK_STEP(NEW_CHECK_OK_DESCRIPTION),
        CHECK_EXTERNAL_STEP('check_admitted'),
        TO_REVIEW_STEP,
        NEW_CHECK_ADMITTED_STEP,
        FAIL_COMMENT_STEP,
        ROLLBACK_STEP,
        NEW_CHECK_REFUSED_STEP,
        NEW_REFUSED_COMMENT_STEP,
        DONE_STEP,
      ];
      const filePath = await writeWorkflow(
        world,
        world.orgs[0].slug,
        alreadyNewSteps,
      );
      const before = await readFile(filePath, 'utf-8');

      await world.applyUpOnly();

      expect(await readFile(filePath, 'utf-8')).toBe(before);
    },
  },
});
