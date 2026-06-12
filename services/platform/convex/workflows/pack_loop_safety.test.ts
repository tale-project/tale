/**
 * Mechanical loop-safety assertions over the task-ops default workflow pack
 * (`examples/default/workflows/tasks/*.json`).
 *
 * The pack is a set of automations that trigger each other through task
 * events; left unchecked, that is a feedback amplifier. These tests assert —
 * from the JSON alone, so any edit to the pack re-proves them — the
 * invariants the design relies on:
 *
 *  (ii)  review-gate is the ONLY workflow that sets a task to `done`;
 *  (iii) automation-authored writes are inert: every path from a mention
 *        trigger (`comment.mentioned` / `task.mentioned`) to an agent run
 *        crosses the workflow-actor guard;
 *  (iv)  every agent run goes through `run_on_task`/`decompose_task`
 *        (admission-gated server-side) — asserted here as the GATE used by
 *        the cycle analysis;
 *  (vi)  cron workflows act through sweeps and guarded loops (empty-array
 *        guard per loop step);
 *  and the headline invariant: in the workflow→event→workflow digraph,
 *  EVERY CYCLE crosses at least one gated edge (a human approval, an
 *  admission-gated agent run, or a guardrail-emitted event). Mechanized as:
 *  the subgraph of UNGATED edges must be acyclic.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';

const PACK_DIR = fileURLToPath(
  new URL('../../../../examples/default/workflows/tasks', import.meta.url),
);

interface Step {
  stepSlug: string;
  stepType: string;
  config: Record<string, unknown>;
  nextSteps: Record<string, string>;
}

interface PackWorkflow {
  file: string;
  name: string;
  workflowId: string;
  events: Array<{ eventType: string; eventFilter?: Record<string, string> }>;
  schedules: Array<{ cron: string }>;
  steps: Step[];
  bySlug: Map<string, Step>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrow an unknown config field to a string ('' when it is not one). */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function loadPack(): PackWorkflow[] {
  const files = readdirSync(PACK_DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThanOrEqual(13);
  return files.map((file) => {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(PACK_DIR, file), 'utf-8'),
    );
    const parsed = workflowJsonSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${file} fails workflowJsonSchema: ${parsed.error}`);
    }
    const doc = parsed.data;
    const steps: Step[] = doc.steps.map((s) => ({
      stepSlug: s.stepSlug,
      stepType: s.stepType,
      config: s.config,
      nextSteps: s.nextSteps,
    }));
    const workflowId = isRecord(doc.config?.variables)
      ? asString(doc.config.variables.workflowId)
      : '';
    return {
      file,
      name: doc.name,
      workflowId,
      events: doc.triggers?.events ?? [],
      schedules: doc.triggers?.schedules ?? [],
      steps,
      bySlug: new Map(steps.map((s) => [s.stepSlug, s])),
    };
  });
}

const pack = loadPack();

/** Action step accessor: {type, parameters.operation}. */
function actionOp(step: Step): { type: string; op: string } | null {
  if (step.stepType !== 'action') return null;
  const type = typeof step.config.type === 'string' ? step.config.type : '';
  const params = isRecord(step.config.parameters) ? step.config.parameters : {};
  const op = typeof params.operation === 'string' ? params.operation : '';
  return { type, op };
}

function actionParams(step: Step): Record<string, unknown> {
  return isRecord(step.config.parameters) ? step.config.parameters : {};
}

/** Steps that gate progression: admission-gated runs + the human review gate. */
function isGateStep(step: Step): boolean {
  const action = actionOp(step);
  if (!action) return false;
  if (action.type === 'agent') {
    return action.op === 'run_on_task' || action.op === 'decompose_task';
  }
  if (action.type === 'approval') return action.op === 'request_review';
  return false;
}

/**
 * Slugs reachable from `start` WITHOUT passing THROUGH a gate step (gate
 * steps are reached but their successors are not expanded). A step absent
 * from this set is "all-paths-gated": nothing it does can happen unless a
 * gate admitted first.
 */
function ungatedReachable(wf: PackWorkflow): Set<string> {
  const reached = new Set<string>();
  const queue = ['start'];
  while (queue.length > 0) {
    const slug = queue.shift();
    if (slug === undefined || reached.has(slug)) continue;
    const step = wf.bySlug.get(slug);
    if (!step) continue;
    reached.add(slug);
    if (isGateStep(step)) continue;
    for (const next of Object.values(step.nextSteps)) queue.push(next);
  }
  return reached;
}

describe('task-ops pack: structure', () => {
  it('every workflow is pack-tagged, auto-installable, and uniquely identified', () => {
    const ids = new Set<string>();
    for (const wf of pack) {
      expect(wf.workflowId, `${wf.file} workflowId`).toMatch(/^tasks_/);
      expect(ids.has(wf.workflowId), `${wf.file} duplicate id`).toBe(false);
      ids.add(wf.workflowId);
      expect(
        wf.events.length + wf.schedules.length,
        `${wf.file} must declare a trigger`,
      ).toBeGreaterThan(0);
    }
  });

  it('every nextSteps target exists and every workflow has start + output', () => {
    for (const wf of pack) {
      expect(wf.bySlug.has('start'), `${wf.file} start`).toBe(true);
      expect(
        wf.steps.some((s) => s.stepType === 'output'),
        `${wf.file} output`,
      ).toBe(true);
      for (const step of wf.steps) {
        for (const [port, target] of Object.entries(step.nextSteps)) {
          expect(
            wf.bySlug.has(target),
            `${wf.file}: ${step.stepSlug}.${port} -> ${target} (missing)`,
          ).toBe(true);
        }
      }
    }
  });

  it('cron schedules are staggered (no two pack crons collide exactly)', () => {
    const crons = pack.flatMap((wf) => wf.schedules.map((s) => s.cron));
    expect(new Set(crons).size).toBe(crons.length);
  });

  it('every loop step has an empty-array guard on its items source', () => {
    for (const wf of pack) {
      for (const step of wf.steps) {
        if (step.stepType !== 'loop') continue;
        const items = asString(step.config.items);
        const root = items.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
        const guarded = wf.steps.some(
          (s) =>
            s.stepType === 'condition' &&
            asString(s.config.expression).includes(`(${root} | length) > 0`),
        );
        expect(guarded, `${wf.file}: loop ${step.stepSlug} unguarded`).toBe(
          true,
        );
      }
    }
  });
});

describe('task-ops pack: loop-safety invariants', () => {
  it("(ii) review-gate is the only workflow that sets a task to 'done'", () => {
    for (const wf of pack) {
      for (const step of wf.steps) {
        const action = actionOp(step);
        if (action?.type !== 'task' || action.op !== 'update_status') continue;
        if (actionParams(step).status === 'done') {
          expect(wf.file).toBe('review-gate.json');
        }
      }
    }
  });

  it('(iii) every path from a mention trigger (comment.mentioned / task.mentioned) to an agent run crosses the workflow-actor guard', () => {
    for (const wf of pack) {
      if (
        !wf.events.some(
          (e) =>
            e.eventType === 'comment.mentioned' ||
            e.eventType === 'task.mentioned',
        )
      ) {
        continue;
      }
      // Reachability without expanding the actor-guard's true side: BFS that
      // does not traverse the guard condition at all. Any run step still
      // reached has a guard-free path — a loop-safety hole.
      const guardSlugs = new Set(
        wf.steps
          .filter(
            (s) =>
              s.stepType === 'condition' &&
              asString(s.config.expression).includes("actorType != 'workflow'"),
          )
          .map((s) => s.stepSlug),
      );
      expect(
        guardSlugs.size,
        `${wf.file} must guard workflow-actor comments`,
      ).toBeGreaterThan(0);

      const reached = new Set<string>();
      const queue = ['start'];
      while (queue.length > 0) {
        const slug = queue.shift();
        if (slug === undefined || reached.has(slug)) continue;
        if (guardSlugs.has(slug)) continue; // do not pass the guard
        const step = wf.bySlug.get(slug);
        if (!step) continue;
        reached.add(slug);
        for (const next of Object.values(step.nextSteps)) queue.push(next);
      }
      for (const step of wf.steps) {
        const action = actionOp(step);
        if (action?.type === 'agent' && action.op === 'run_on_task') {
          expect(
            reached.has(step.stepSlug),
            `${wf.file}: ${step.stepSlug} reachable without actor guard`,
          ).toBe(false);
        }
      }
    }
  });

  it('every pack-authored task comment carries the [automated] prefix', () => {
    for (const wf of pack) {
      for (const step of wf.steps) {
        const action = actionOp(step);
        if (action?.type !== 'task' || action.op !== 'comment') continue;
        const body = asString(actionParams(step).body);
        expect(
          body.startsWith('[automated]'),
          `${wf.file}: ${step.stepSlug} comment must start with [automated]`,
        ).toBe(true);
      }
    }
  });

  it('every workflow→event→workflow cycle crosses a gated edge (ungated subgraph is a DAG)', () => {
    // --- Emissions per workflow -------------------------------------------
    // Static task ops emit known events; agent runs may emit anything an
    // agent can do (comments, mentions, status, creates, assigns) but are
    // admission-gated; guardrail events (slot_freed / budget_exceeded) come
    // from the run lifecycle itself, modeled via a synthetic node.
    interface Emission {
      eventType: string;
      status?: string; // for task.status_changed, when statically known
      gated: boolean;
      wildcard?: boolean; // agent-run emission: matches any task/comment event
    }

    const GUARDRAILS = '<guardrails>';
    const edges: Array<{ from: string; to: string; gated: boolean }> = [];

    const emissionsOf = (wf: PackWorkflow): Emission[] => {
      const ungated = ungatedReachable(wf);
      const list: Emission[] = [];
      for (const step of wf.steps) {
        const action = actionOp(step);
        if (!action) continue;
        const gated = !ungated.has(step.stepSlug);
        const params = actionParams(step);
        if (action.type === 'task') {
          switch (action.op) {
            case 'create':
            case 'upsert_external':
              // Workflow-actor creates may also emit task.mentioned
              // (description @mentions), but every pack subscriber of that
              // event guards the workflow actor (asserted in (iii)) — inert,
              // skip. External upserts never extract mentions at all.
              list.push({ eventType: 'task.created', gated });
              break;
            case 'update_status':
              list.push({
                eventType: 'task.status_changed',
                status:
                  typeof params.status === 'string' ? params.status : undefined,
                gated,
              });
              break;
            case 'assign':
              list.push({ eventType: 'task.assigned', gated });
              break;
            case 'comment': {
              // Workflow-actor comments: comment.created has no pack
              // subscriber; comment.mentioned subscribers guard the workflow
              // actor (asserted above) — these emissions are INERT, skip.
              break;
            }
            default:
              break;
          }
        }
        if (
          action.type === 'agent' &&
          (action.op === 'run_on_task' || action.op === 'decompose_task')
        ) {
          // Agent-actor activity: anything task_write allows. Always gated
          // (transactional admission). Runs also feed the guardrail events.
          list.push({ eventType: '*', gated: true, wildcard: true });
        }
        if (action.type === 'agent' && action.op === 'reassign_or_unassign') {
          list.push({ eventType: 'task.assigned', gated });
          list.push({
            eventType: 'task.status_changed',
            status: 'todo',
            gated,
          });
        }
        if (action.type === 'agent' && action.op === 'requeue_queued_runs') {
          list.push({ eventType: 'agent.slot_freed', gated });
        }
      }
      return list;
    };

    const subscribes = (wf: PackWorkflow, emission: Emission): boolean => {
      return wf.events.some((event) => {
        if (emission.wildcard) {
          // Agent runs can produce any task/comment event, never agent.* ones.
          return !event.eventType.startsWith('agent.');
        }
        if (event.eventType !== emission.eventType) return false;
        const filterStatus = event.eventFilter?.toStatus;
        if (
          event.eventType === 'task.status_changed' &&
          filterStatus !== undefined &&
          emission.status !== undefined
        ) {
          return filterStatus === emission.status;
        }
        return true;
      });
    };

    for (const from of pack) {
      const emissions = emissionsOf(from);
      for (const emission of emissions) {
        for (const to of pack) {
          if (subscribes(to, emission)) {
            edges.push({ from: from.file, to: to.file, gated: emission.gated });
          }
        }
      }
      // Synthetic guardrail node: any workflow that runs agents participates
      // in the run lifecycle that emits slot_freed/budget_exceeded…
      if (
        from.steps.some((s) => {
          const a = actionOp(s);
          return (
            a?.type === 'agent' &&
            (a.op === 'run_on_task' || a.op === 'decompose_task')
          );
        })
      ) {
        edges.push({ from: from.file, to: GUARDRAILS, gated: false });
      }
    }
    // …and those guardrail events are gated by construction (once per
    // agent-month / once per freed slot).
    for (const to of pack) {
      if (
        to.events.some(
          (e) =>
            e.eventType === 'agent.slot_freed' ||
            e.eventType === 'agent.budget_exceeded',
        )
      ) {
        edges.push({ from: GUARDRAILS, to: to.file, gated: true });
      }
    }

    // --- The assertion: ungated subgraph is acyclic -----------------------
    const adjacency = new Map<string, string[]>();
    for (const edge of edges.filter((e) => !e.gated)) {
      const out = adjacency.get(edge.from) ?? [];
      out.push(edge.to);
      adjacency.set(edge.from, out);
    }
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    const cycleAt = (node: string): string[] | null => {
      color.set(node, GRAY);
      for (const next of adjacency.get(node) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) return [node, next];
        if (c === WHITE) {
          const found = cycleAt(next);
          if (found) return [node, ...found];
        }
      }
      color.set(node, BLACK);
      return null;
    };
    for (const node of adjacency.keys()) {
      if ((color.get(node) ?? WHITE) === WHITE) {
        const cycle = cycleAt(node);
        expect(
          cycle,
          `ungated automation cycle: ${cycle?.join(' -> ')}`,
        ).toBeNull();
      }
    }
  });
});
