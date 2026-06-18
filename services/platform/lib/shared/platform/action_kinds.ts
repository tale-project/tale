/**
 * The closed (but extensible) vocabulary of ACTIONS — the "do" half of the
 * configurable app surface, sibling to `render_kinds` (HOW to show) and
 * `data_sources` (WHAT to show). An action is the user DOING something — the
 * seam that turns a read-only view into a complete, closed-loop experience.
 *
 * Like the other two registries, this is a small platform-owned set: an app
 * composes these verbs as DATA (`part.actions[]`), never as code. The whole
 * point is that "an app assembles the platform's capabilities for end users":
 * each verb routes to ONE existing, audited platform mutation, so the app
 * surface is a fast control panel over the deterministic spine — never a second
 * write path. New platform capabilities become new verbs by a DELIBERATE
 * platform addition (roadmap below), exactly like a new render-kind/data-source
 * — never an `onClick` code field, never a per-app handler.
 *
 * Anti-bloat discipline (mirrors render-kinds): variation lives in PARAMS, not
 * new verbs — "approve, but cap at 10%" is a param on `approve`, not a verb.
 *
 * Roadmap (NOT in v1, but the registry accommodates them as new entries):
 *   retry_step · cancel_run · set_status · run_agent · ingest_document ·
 *   integration_op · rag_search-as-source-not-action · notify · escalate.
 */
import type { DataSourceKind } from './data_sources';

export const ACTION_KINDS = [
  'approve', // resolve a human review/approval gate positively
  'reject', // resolve a review gate negatively (request changes)
  'respond', // submit structured input to a human-input request (the form)
  'trigger_workflow', // start a workflow run — the bounded escape hatch
  'steer', // inject a correction into a live agent run
  'assign', // (re)assign a task to an agent/role
  'comment', // add a comment to a task / run
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

const ACTION_KIND_SET = new Set<string>(ACTION_KINDS);

export function isActionKind(value: string): value is ActionKind {
  return ACTION_KIND_SET.has(value);
}

/**
 * Per-verb metadata:
 *  - `sources`: the data-source kinds the verb is valid on (kind×source
 *    compatibility — `validatePack` rejects an `approve` on a `task_collection`).
 *  - `mutates`: the data-source kinds whose reactive query should re-subscribe
 *    after a successful dispatch (auto-refresh; mostly free with Convex).
 *  - `irreversible`: whether the verb warrants a confirm by default + a
 *    two-phase guard (the platform still honors a per-action `confirm`).
 *  - `labelKeyPrefix`: Tier-1 (platform) label namespace for the verb.
 */
export const ACTION_KIND_META: Record<
  ActionKind,
  {
    sources: readonly DataSourceKind[];
    mutates: readonly DataSourceKind[];
    irreversible: boolean;
    labelKeyPrefix: `platform.action.${ActionKind}`;
  }
> = {
  approve: {
    sources: ['approval_queue', 'workflow_run'],
    mutates: ['approval_queue', 'workflow_run', 'workflow_runs'],
    irreversible: true,
    labelKeyPrefix: 'platform.action.approve',
  },
  reject: {
    sources: ['approval_queue', 'workflow_run'],
    mutates: ['approval_queue', 'workflow_run', 'workflow_runs'],
    irreversible: true,
    labelKeyPrefix: 'platform.action.reject',
  },
  respond: {
    sources: ['approval_queue'],
    mutates: ['approval_queue'],
    irreversible: true,
    labelKeyPrefix: 'platform.action.respond',
  },
  trigger_workflow: {
    sources: ['task_collection', 'workflow_runs', 'workflow_run'],
    mutates: ['workflow_runs', 'task_collection'],
    irreversible: false,
    labelKeyPrefix: 'platform.action.trigger_workflow',
  },
  steer: {
    sources: ['workflow_run'],
    mutates: ['workflow_run'],
    irreversible: false,
    labelKeyPrefix: 'platform.action.steer',
  },
  assign: {
    sources: ['task_collection'],
    mutates: ['task_collection'],
    irreversible: false,
    labelKeyPrefix: 'platform.action.assign',
  },
  comment: {
    sources: ['task_collection', 'workflow_run'],
    mutates: ['task_collection'],
    irreversible: false,
    labelKeyPrefix: 'platform.action.comment',
  },
};

/** Whether `kind` is valid on `source` (the kind×source compatibility gate). */
export function isActionValidOnSource(
  kind: ActionKind,
  source: DataSourceKind,
): boolean {
  return ACTION_KIND_META[kind].sources.includes(source);
}
