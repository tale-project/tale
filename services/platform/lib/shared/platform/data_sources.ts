/**
 * The closed vocabulary of DATA SOURCES a view part can bind to.
 *
 * A view config composes render-kinds (HOW to render) over these sources (WHAT
 * to render). Like `render_kinds`, this is a small, stable, platform-owned set:
 * a new source is a rare, deliberate platform addition, never a per-pack change.
 * Each source resolves to ONE validated reactive query the renderer subscribes
 * to; the result feeds a single render-kind component.
 *
 * This is the layer that decouples the UI from any single workflow — a pack
 * page can show a task board, a review queue, and recent runs side by side,
 * none of which is "a workflow step".
 */
import type { RenderKind } from './render_kinds';

export const DATA_SOURCE_KINDS = [
  'workflow_run', // one execution's per-step state (the run-detail drill-in)
  'workflow_runs', // recent executions for a pack/workflow (a runs list / inbox)
  'task_collection', // tasks / issues by filter (the board)
  'approval_queue', // pending human reviews / input requests
] as const;

export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

const DATA_SOURCE_SET = new Set<string>(DATA_SOURCE_KINDS);

export function isDataSourceKind(value: string): value is DataSourceKind {
  return DATA_SOURCE_SET.has(value);
}

/**
 * Per-source metadata: the natural cardinality, the render-kind a part defaults
 * to when it omits `render`, and the label-key prefix for Tier-1 (platform)
 * labels. `cardinality: 'one'` sources feed a single-item kind (stream/artifact);
 * `'many'` sources feed a list kind (collection/review).
 */
export const DATA_SOURCE_META: Record<
  DataSourceKind,
  {
    cardinality: 'one' | 'many';
    defaultRender: RenderKind;
    labelKeyPrefix: `platform.source.${DataSourceKind}`;
  }
> = {
  workflow_run: {
    cardinality: 'one',
    defaultRender: 'stream',
    labelKeyPrefix: 'platform.source.workflow_run',
  },
  workflow_runs: {
    cardinality: 'many',
    defaultRender: 'collection',
    labelKeyPrefix: 'platform.source.workflow_runs',
  },
  task_collection: {
    cardinality: 'many',
    defaultRender: 'collection',
    labelKeyPrefix: 'platform.source.task_collection',
  },
  approval_queue: {
    cardinality: 'many',
    defaultRender: 'review',
    labelKeyPrefix: 'platform.source.approval_queue',
  },
};
