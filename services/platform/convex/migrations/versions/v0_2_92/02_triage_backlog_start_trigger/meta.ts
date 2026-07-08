import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.92 / 02 — subscribe `projects/tasks/triage-unassigned-tasks` to
 * `task.status_changed` (backlog -> todo) in every org that already has it
 * installed.
 *
 * The workflow file gained a second declared trigger so a human's Backlog
 * "Start" (the board's status-change action) routes a synced proposal (e.g.
 * from the resolve-github-issues bundle's triage-github-issues) through
 * scoring and assignment, the same as a task created directly at To do.
 * Trigger rows are create-if-absent only (`provision_defaults_mutations.ts`),
 * so an org already provisioned from the OLD file (one `task.created`
 * subscription) never picks up the new one on its own — this migration adds
 * it directly. Purely additive (never touches the existing `task.created`
 * subscription or any org customization of it), so `destructive: false` and
 * `snapshot: 'none'`: `down` deletes exactly the row `up` added, identified
 * the same way `up` found where to add it.
 */
export const meta: MigrationMeta = {
  id: '0.2.92/02_triage_backlog_start_trigger',
  semver: '0.2.92',
  numericId: 2,
  slug: 'triage_backlog_start_trigger',
  title: "Subscribe triage-unassigned-tasks to a Backlog->To do 'Start' too",
  description:
    'For every org with a `task.created` event subscription on ' +
    '`projects/tasks/triage-unassigned-tasks`, adds a sibling ' +
    '`task.status_changed` subscription (eventFilter fromStatus:"backlog", ' +
    'toStatus:"todo"), create-if-absent. Lets a human Backlog "Start" route a ' +
    'synced proposal task through scoring and assignment, matching a task ' +
    'created directly at To do. down removes exactly the subscription this ' +
    'migration added per org.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
