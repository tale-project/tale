/**
 * Closed vocabulary of UI "render-kinds" — the contract between a workflow step
 * and the generic operator UI. A step's `ui.render` annotation selects exactly
 * one kind; the renderer has exactly one component per kind (an exhaustive
 * switch, so a missing component is a compile error).
 *
 * The set is deliberately small and grows only by rare, deliberate platform
 * decisions. Variation that looks like "more kinds" is expressed through
 * composition PARAMS instead (display / layout / entryKind / mode /
 * cardinality) — minting a kind per layout/display is the canonical bloat
 * smell. Two orthogonal concerns are NOT kinds either: lifecycle/streaming
 * `state` (see ./part_state) rides every render-part, and plan/DAG topology is
 * owned by the shell's run-view, not a per-step kind.
 *
 * Lives in lib/shared so both the Convex layer (Zod validation) and the
 * frontend renderer import the identical literals — the single source of truth
 * that keeps the UI and the workflow schema from drifting.
 */
export const RENDER_KINDS = [
  'status', // state badge + step summary (lifecycle rides the `state` axis)
  'ingest', // source / intake summary (counts, sourceRef)
  'transform', // processing-step summary (rows in/out, fields, timing)
  'validation', // machine pass/warn/fail checks (observed vs expected)
  'reconciliation', // match + actionable resolution / adjudication
  'diff', // read-only before/after comparison
  'collection', // N homogeneous items (+ optional row actions)
  'artifact', // a produced payload (file / object / code / embed)
  'stream', // chronological feed — the agent-run spine
  'review', // the human-actionable kind (run resumes with structured output)
] as const;

export type RenderKind = (typeof RENDER_KINDS)[number];

const RENDER_KIND_SET = new Set<string>(RENDER_KINDS);

export function isRenderKind(value: string): value is RenderKind {
  return RENDER_KIND_SET.has(value);
}

/**
 * Composition params — closed sub-vocabularies that let one kind cover a family
 * of presentations WITHOUT minting new kinds.
 */
export const ARTIFACT_DISPLAYS = ['blob', 'object', 'code', 'embed'] as const;
export type ArtifactDisplay = (typeof ARTIFACT_DISPLAYS)[number];

export const COLLECTION_LAYOUTS = ['table', 'list', 'cards'] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

export const STREAM_ENTRY_KINDS = ['message', 'tool_call', 'log'] as const;

export const REVIEW_MODES = ['gate', 'form', 'choice'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const REVIEW_CARDINALITIES = ['one', 'many'] as const;

export type RenderInteraction = 'read_only' | 'actionable';

/**
 * Per-kind metadata: whether the kind is read-only or actionable (a human acts
 * and the run resumes), and the i18n key prefix under which its Tier-1
 * (platform-owned, structural) labels live. Pack-authored Tier-2 labels are
 * referenced separately via the step's `ui.labelKey`.
 */
export const RENDER_KIND_META: Record<
  RenderKind,
  {
    interaction: RenderInteraction;
    labelKeyPrefix: `platform.render.${RenderKind}`;
  }
> = {
  status: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.status',
  },
  ingest: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.ingest',
  },
  transform: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.transform',
  },
  validation: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.validation',
  },
  reconciliation: {
    interaction: 'actionable',
    labelKeyPrefix: 'platform.render.reconciliation',
  },
  diff: { interaction: 'read_only', labelKeyPrefix: 'platform.render.diff' },
  collection: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.collection',
  },
  artifact: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.artifact',
  },
  stream: {
    interaction: 'read_only',
    labelKeyPrefix: 'platform.render.stream',
  },
  review: {
    interaction: 'actionable',
    labelKeyPrefix: 'platform.render.review',
  },
};
