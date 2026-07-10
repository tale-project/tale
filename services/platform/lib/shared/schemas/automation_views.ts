/**
 * Automation VIEW documents (`automations/<slug>/views/*.json`) — the strict Zod contract for
 * the JSON-first automation UI. A view wraps `id`/`title`/`description` over either a
 * flat Puck Data document (`data`) or a tabbed shell (`tabs`); its `content` is
 * a closed vocabulary of block nodes (a discriminated union on `type`), each
 * with a typed prop schema. This file is the single source of truth the publish
 * path, the client parse mirror, the block registry, and the builtin-automation gate
 * all derive from — TS types are `z.infer` re-exports, never hand-written twins.
 *
 * VERSIONING RULE: a view doc may carry an optional `version` (string, like
 * workflows); an ABSENT `version` means v1. Additive changes (a new block, a new
 * optional prop) are non-breaking and ship without a bump. A BREAKING change
 * (rename/remove a block or prop, change a prop's meaning) requires a versioned
 * fs-tree migration under `convex/migrations/versions/` that rewrites installed
 * per-org view files — old docs are migrated, never silently reinterpreted.
 *
 * Layer-A pure: zod + sibling shared modules only (no `node:*`, no React, no
 * Convex) — importable from the Convex publish path and the client alike.
 *
 * Tolerance posture: strict on the vocabulary (`type` discriminators, enum
 * values, binding path shape), `.passthrough()` on every object — Puck stamps
 * `props.id` / node-level bookkeeping (`readOnly`), and a newer author's
 * additive props must survive an older parser's round-trip unchanged.
 *
 * Sentinel strings (`$orgId`, `$projectId`, `$config:x`, `$selected.x`,
 * `$result.x`, `$state.x`, `$input.x`, `$selection.ids`, `$lane`,
 * `$tpl:{x}`) live INSIDE `args` values and resolve at runtime
 * (`function_bindings.ts`) — `args` stays an opaque JSON value here, never
 * schema-validated for sentinel syntax.
 */
import { z } from 'zod';

import {
  FUNCTION_MODES,
  isValidFunctionPath,
} from '../platform/function_bindings';

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/** Convex function reference in `makeFunctionReference` form
 *  (`<dir>/<file>:<export>`) — shape-checked here, allowlist-checked by
 *  `validateViewBindings`, existence-checked at runtime. */
export const functionPathSchema = z
  .string()
  .refine(isValidFunctionPath, 'expected a `<dir>/<file>:<export>` path');

/** How a bound function is invoked (`capabilities.functions` mode). */
export const functionModeSchema = z.enum(FUNCTION_MODES);

/** A display string — a LITERAL, rendered verbatim. Pack-authored views
 *  localize via an optional sibling `i18n` map (see
 *  {@link localizedStringProps} / {@link resolveLocalizedProp}); the retired
 *  per-bundle label catalog (`$label:` refs) is no longer resolved. */
export const labelStringSchema = z.string();

/**
 * Optional per-locale overrides for presentational string props. Keys are
 * BCP-47 tags (`de`, `de-CH`, `fr`, …); values are a partial map of the
 * prop names they override (`text`, `title`, `description`, `label`,
 * `help`, …). Resolved at render via
 * `lib/shared/utils/resolve-automation-locale.ts#resolveLocalizedProp`
 * (locale → base language → `en` → the English literal). Presentational
 * block prop schemas are `.passthrough()`, so `i18n.de.text` etc. are
 * already accepted without an explicit field — this helper is for sites
 * that want a typed `i18n` (view/tab/formField).
 */
const localizedStringProps = z
  .record(z.string(), z.record(z.string(), z.string()))
  .optional();

/** A reactive read binding — the `query` prop of a data block. */
export const queryBindingSchema = z
  .object({
    path: functionPathSchema,
    /** Args with runtime sentinels — opaque by design (see file header). */
    args: z.unknown().optional(),
  })
  .passthrough();

/** An action-sourced read binding (`ExternalList.source`); `mode` defaults to
 *  `action` at collection time. */
export const sourceBindingSchema = z
  .object({
    path: functionPathSchema,
    args: z.unknown().optional(),
    mode: functionModeSchema.optional(),
  })
  .passthrough();

/** Effect: open the generic resource-detail overlay for `(subjectType, id)`. */
const openDetailEffectSchema = z
  .object({
    kind: z.literal('openDetail'),
    subjectType: z.string(),
    id: z.string(),
    title: labelStringSchema.optional(),
  })
  .passthrough();

/** Effect: navigate to a route (templated `to`/`params`/`search`). */
const navigateEffectSchema = z
  .object({
    kind: z.literal('navigate'),
    to: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    search: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Effect: show a toast (`titleKey` is a literal, `$tpl:`-capable). */
const toastEffectSchema = z
  .object({
    kind: z.literal('toast'),
    titleKey: labelStringSchema,
  })
  .passthrough();

/** Effect: write a cross-block view-state key (master-detail selection). */
const setStateEffectSchema = z
  .object({
    kind: z.literal('setState'),
    key: z.string(),
    value: z.unknown(),
  })
  .passthrough();

/**
 * The declarative "then" of an action (`onSuccess`) — a closed named set, never
 * code. All four kinds are implemented in `runtime/action-effects.tsx`
 * (`setState` writes through `runtime/view-state.tsx`).
 */
export const actionEffectSchema = z.discriminatedUnion('kind', [
  openDetailEffectSchema,
  navigateEffectSchema,
  toastEffectSchema,
  setStateEffectSchema,
]);

/**
 * Confirm dialog for a bound action. `true` keeps the platform default
 * ("Are you sure?" + action label). An object supplies pack-authored copy.
 */
const actionConfirmSchema = z.union([
  z.boolean(),
  z
    .object({
      title: labelStringSchema.optional(),
      description: labelStringSchema.optional(),
    })
    .passthrough(),
]);

/**
 * One bound action — the full `BoundActionSpec` surface of
 * `registry/connected/bound-button.tsx` (which re-exports its type from here).
 * A button bound to ONE allowlisted Convex function: availability is data
 * (`when` over the bound item), args are sentinel templates, `doneWhen`/
 * `doneLabel(Key)` drive the per-row "done" affordance (a done label also marks
 * the action consume-once).
 */
export const boundActionSchema = z
  .object({
    /** Literal button label. `labelKey` resolves against the PLATFORM
     *  `automations` catalog (the generic action vocabulary, e.g.
     *  `list.start`), falling back to `label` — never a bundle catalog. */
    label: z.string().optional(),
    labelKey: z.string().optional(),
    path: functionPathSchema,
    mode: functionModeSchema,
    args: z.unknown().optional(),
    confirm: actionConfirmSchema.optional(),
    /** Availability predicate over the bound item (when_predicate grammar). */
    when: z.string().optional(),
    variant: z
      .enum(['primary', 'secondary', 'destructive', 'ghost'])
      .optional(),
    onSuccess: actionEffectSchema.optional(),
    /**
     * Effect when an idempotent create returns `created: false` (e.g. quarter
     * Start re-click). Falls back to `onSuccess` when omitted.
     */
    onAlreadyExists: actionEffectSchema.optional(),
    /** Predicate over the bound item: true → disabled "done" affordance. */
    doneWhen: z.string().optional(),
    /** Label for the done state; its presence marks the action consume-once. */
    doneLabelKey: z.string().optional(),
    doneLabel: z.string().optional(),
  })
  .passthrough();

/**
 * Effect-only row action — no Convex call; click applies `effect` against the
 * row (e.g. navigate to Project Files with `$selected._id` as folderId).
 */
const effectActionSchema = z
  .object({
    label: z.string().optional(),
    labelKey: z.string().optional(),
    when: z.string().optional(),
    variant: z
      .enum(['primary', 'secondary', 'destructive', 'ghost'])
      .optional(),
    effect: actionEffectSchema,
  })
  .passthrough();

/** Collection / board row action: bound function call OR effect-only. */
const rowActionSchema = z.union([boundActionSchema, effectActionSchema]);

/**
 * One table column: a spec the DataTable mapper (`bound-columns`) turns into a
 * typed `ColumnDef` — `kind` picks the cell renderer, `size` feeds the
 * column-size budget, `flex` grows the column (`true` or a grow weight).
 */
export const columnSpecSchema = z
  .object({
    field: z.string(),
    labelKey: labelStringSchema.optional(),
    kind: z
      .enum(['text', 'badge', 'datetime', 'number', 'id', 'two-line'])
      .optional(),
    size: z.number().optional(),
    flex: z.union([z.number(), z.boolean()]).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    /** Row field for the `two-line` kind's second line. */
    secondaryField: z.string().optional(),
    /** Literal display label per raw cell value for the `badge` kind — an
     *  unmapped value renders verbatim. */
    valueLabels: z.record(z.string(), labelStringSchema).optional(),
  })
  .passthrough();

/** A block's `columns` array. */
const columnsSchema = z.array(columnSpecSchema);

/**
 * One declared input field — shared grammar between an automation manifest's
 * `requires.config` (per-install config the wizard collects; `automations.ts` imports
 * this back) and the `Form` block's `fields`. `select`/`options`/`required` are
 * the additive v2 extensions; everything else is the original manifest grammar.
 *
 * Display strings are LITERALS (`label`/`placeholder`/`help`, authored in
 * English). A manifest translates its config fields via its inline
 * `i18n.<locale>.config.<key>` block
 * (`automations.ts#automationManifestI18nSchema`). A view-authored Form
 * field may also carry its own `i18n` map. Both resolve through
 * `lib/shared/utils/resolve-automation-locale.ts` (field `i18n` wins over
 * the manifest config map).
 */
export const formFieldSchema = z.object({
  key: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  /** Literal field label; absent → the humanized `key` fallback. */
  label: z.string().optional(),
  /** Literal input placeholder — a format hint,
   *  e.g. "owner/repo or https://github.com/owner/repo". */
  placeholder: z.string().optional(),
  /** Literal help text rendered under the control. */
  help: z.string().optional(),
  /**
   * Per-locale overrides for this field's display strings
   * (`i18n.de.label` / `help` / `placeholder`). View-authored Form fields
   * use this; manifest `requires.config` fields prefer the manifest's
   * `i18n.<locale>.config.<key>` map instead.
   */
  i18n: z
    .record(
      z.string(),
      z
        .object({
          label: z.string().optional(),
          help: z.string().optional(),
          placeholder: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
  /** Render a multi-line textarea instead of a single-line input — for
   *  free-text fields. `type` stays `'string'`; purely a presentation hint. */
  multiline: z.boolean().optional(),
  /** Choices for a `type: 'select'` field — `label` is the literal display
   *  string (absent → the humanized `value`). */
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  required: z.boolean().optional(),
  /**
   * Optional derivation: collect this field as ONE input, then split the
   * entered string into several stored keys via a regex — `pattern` capture
   * groups are stored under `into` (group 1 → into[0], …). Lets a repo-agnostic
   * automation ask for a single "owner/repo or URL" while views/workflows bind the
   * split keys (`$config:owner` etc.). Authored by first parties; inputs are
   * length-capped to bound regex cost (see `deriveConfigValues`).
   */
  derive: z
    .object({
      pattern: z.string(),
      into: z.array(z.string()).min(1),
    })
    .optional(),
});

/** One single-select filter: a query-arg/row `field` and its allowed `values`. */
const listFilterSchema = z
  .object({
    field: z.string(),
    values: z.array(z.string()),
    /** Optional literal label for the control (else the field name). */
    labelKey: labelStringSchema.optional(),
    /** `arg` (default) merges the choice into the query args; `client` narrows
     *  the loaded rows in the table filter bar (`Collection` interprets it). */
    mode: z.enum(['arg', 'client']).optional(),
    /** Literal display label per raw filter value — the raw value stays the
     *  dispatched arg; an unmapped value renders verbatim. */
    valueLabels: z.record(z.string(), labelStringSchema).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Block prop schemas — v1 (every block registered in `registry/tale-config.tsx`)
// ---------------------------------------------------------------------------

/**
 * Presentational block props are `.passthrough()` so an optional pack-authored
 * `i18n` map (`i18n.de.text`, `i18n.fr.title`, …) survives parse and is
 * resolved at render via {@link resolveLocalizedProp}. No explicit `i18n`
 * field is required on these schemas — the map is additive authoring.
 */
const headingPropsSchema = z
  .object({
    text: labelStringSchema,
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  })
  .passthrough();

const textPropsSchema = z
  .object({
    text: labelStringSchema,
    variant: z.enum([
      'body',
      'body-sm',
      'muted',
      'caption',
      'label',
      'code',
      'error',
      'success',
    ]),
  })
  .passthrough();

const badgePropsSchema = z
  .object({
    text: labelStringSchema,
    variant: z.enum([
      'outline',
      'destructive',
      'orange',
      'yellow',
      'blue',
      'green',
      'slate',
    ]),
  })
  .passthrough();

const alertPropsSchema = z
  .object({
    variant: z.enum(['default', 'destructive', 'warning', 'info']),
    title: labelStringSchema,
    description: labelStringSchema,
  })
  .passthrough();

const cardPropsSchema = z
  .object({
    title: labelStringSchema,
    description: labelStringSchema,
    body: labelStringSchema,
  })
  .passthrough();

const collectionPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    query: queryBindingSchema,
    columns: columnsSchema.optional(),
    actions: z.array(rowActionSchema).optional(),
    /** When set, rows expand to show their workflow run inline. */
    subjectType: z.string().optional(),
    /** Row field holding the subject id (default `_id`). */
    subjectIdField: z.string().optional(),
    /** Page size; when set the block paginates (cursor) behind "Load more". */
    perPage: z.number().optional(),
    filters: z.array(listFilterSchema).optional(),
    /** Empty-state copy override (literal strings). */
    emptyState: z
      .object({
        titleKey: labelStringSchema.optional(),
        descriptionKey: labelStringSchema.optional(),
      })
      .passthrough()
      .optional(),
    /** The single primary create affordance, rendered in the table header. */
    addAction: boundActionSchema.optional(),
    /** Managed client-side search over the given row fields. */
    search: z
      .object({
        fields: z.array(z.string()),
        placeholderKey: labelStringSchema.optional(),
      })
      .passthrough()
      .optional(),
    /** Effect applied when a row is clicked (`$selected.*` binds the row). */
    onRowClick: actionEffectSchema.optional(),
  })
  .passthrough();

const reviewQueuePropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    query: queryBindingSchema,
  })
  .passthrough();

const externalListPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    /** The allowlisted action to fetch rows from (mode defaults to `action`). */
    source: sourceBindingSchema,
    /** Result key holding the rows array (e.g. `data`). */
    itemsKey: z.string().optional(),
    /** Client-side row filter (when_predicate grammar), e.g. `!pull_request`. */
    rowWhen: z.string().optional(),
    columns: columnsSchema.optional(),
    actions: z.array(boundActionSchema).optional(),
    perPage: z.number().optional(),
    /** Hide rows already materialized in another Convex collection. */
    excludeBy: z
      .object({
        query: queryBindingSchema,
        /** Key field when the query returns records; omit for a bare string[]. */
        refField: z.string().optional(),
        /** `{field}` template over the row (merged with config) → the key. */
        rowKeyTemplate: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const agentListPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    /** Optional subset/order of the automation's agents (composite or bare names). */
    agents: z.array(z.string()).optional(),
    /** role token -> agent slug (manifest.roles), for the role badge. */
    roles: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const workflowDagPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    workflowSlug: z.string(),
    /** When set, overlays live per-node execution status (a run view). */
    executionId: z.string().optional(),
    /** When true, pairs the canvas with the AI chat panel. */
    editable: z.boolean().optional(),
  })
  .passthrough();

const runListPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    workflowSlug: z.string(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Block prop schemas — v2 (contracts for the blocks-wave sibling tasks; the
// components don't exist yet, these schemas ARE the binding contract)
// ---------------------------------------------------------------------------

const statGridPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    query: queryBindingSchema,
    /** Grid column count. */
    cols: z.number().optional(),
    stats: z
      .array(
        z
          .object({
            labelKey: labelStringSchema,
            valueField: z.string(),
            format: z
              .enum(['number', 'percent', 'duration', 'cents'])
              .optional(),
            trendField: z.string().optional(),
            sparklineField: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const chartCardPropsSchema = z
  .object({
    titleKey: labelStringSchema,
    query: queryBindingSchema,
    /** Result key holding the datapoint array. */
    itemsKey: z.string().optional(),
    chart: z
      .object({
        kind: z.enum(['line', 'area', 'bar']),
        xField: z.string(),
        series: z
          .array(
            z
              .object({ field: z.string(), labelKey: labelStringSchema })
              .passthrough(),
          )
          .min(1),
      })
      .passthrough(),
    height: z.number().optional(),
  })
  .passthrough();

const detailPanelPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    query: queryBindingSchema,
    /** `<dl>` column count. */
    cols: z.number().optional(),
    fields: z
      .array(
        z
          .object({
            labelKey: labelStringSchema,
            field: z.string(),
            kind: z
              .enum(['text', 'badge', 'datetime', 'link', 'number'])
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
    actions: z.array(boundActionSchema).optional(),
  })
  .passthrough();

const formPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    /**
     * Per-locale overrides for the block title (`i18n.de.title`). Field
     * `label`/`help`/`placeholder` live on each {@link formFieldSchema}
     * entry's own `i18n` map. Passthrough also admits additive locale keys.
     */
    i18n: localizedStringProps,
    fields: z.array(formFieldSchema).min(1),
    /** Initial values per field key (sentinel-capable). */
    initial: z.record(z.string(), z.unknown()).optional(),
    /** The submit action — its args read the entered values via `$input.*`. */
    submit: boundActionSchema,
    onSuccess: actionEffectSchema.optional(),
    /**
     * Hide the form when this predicate is false. Evaluated against the
     * `whenQuery` record (or `{}` when that query returns null).
     */
    when: z.string().optional(),
    /** Optional query whose result is the `when` item (null → empty record). */
    whenQuery: queryBindingSchema.optional(),
  })
  .passthrough();

const boardPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    query: queryBindingSchema,
    itemsKey: z.string().optional(),
    /** Row field the lanes group by (e.g. `status`). */
    groupBy: z.string(),
    lanes: z
      .array(
        z
          .object({ value: z.string(), labelKey: labelStringSchema })
          .passthrough(),
      )
      .min(1),
    card: z
      .object({
        titleField: z.string(),
        subtitleField: z.string().optional(),
        metaFields: z.array(z.string()).optional(),
        badgeField: z.string().optional(),
      })
      .passthrough(),
    /** When set, cards carry the subject run-status chip / detail affordances. */
    subjectType: z.string().optional(),
    /** The drop mutation — the block builds position args; `$lane` names the
     *  drop target lane in authored args. */
    move: z
      .object({
        path: functionPathSchema,
        mode: functionModeSchema,
        args: z.unknown().optional(),
      })
      .passthrough(),
    /** Per-card actions (conditional via `when`) — the shared collector walks
     *  `actions`, so these are publish-validated like list actions. */
    actions: z.array(boundActionSchema).optional(),
    onCardClick: actionEffectSchema.optional(),
  })
  .passthrough();

const conversationListPropsSchema = z
  .object({
    id: z.string().optional(),
    title: labelStringSchema.optional(),
    query: queryBindingSchema,
    /** Secondary count binding (e.g. per-status totals for the tab badges). */
    count: queryBindingSchema.optional(),
    perPage: z.number().optional(),
    /** Field map from a conversation row to the list-item anatomy. */
    item: z
      .object({
        titleField: z.string(),
        senderField: z.string().optional(),
        previewField: z.string().optional(),
        timestampField: z.string().optional(),
        unreadField: z.string().optional(),
        badgeField: z.string().optional(),
        /** Literal display label per raw `badgeField` value — an unmapped
         *  value renders verbatim. */
        badgeLabels: z.record(z.string(), labelStringSchema).optional(),
      })
      .passthrough(),
    filters: z.array(listFilterSchema).optional(),
    /** Master-detail selection: clicking an item writes the row's `idField`
     *  into view state under `stateKey` (read back via `$state.<key>`). */
    selection: z
      .object({ stateKey: z.string(), idField: z.string() })
      .passthrough(),
    /** Fired when an item opens (e.g. mark-as-read) — a bound mutation. */
    onOpen: boundActionSchema.optional(),
    /** Multi-select bulk actions — args bind ids via `$selection.ids`. */
    bulkActions: z.array(boundActionSchema).optional(),
    emptyState: z
      .object({
        titleKey: labelStringSchema.optional(),
        descriptionKey: labelStringSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const conversationThreadPropsSchema = z
  .object({
    /** Messages query — typically bound to `$state.conversationId`. */
    query: queryBindingSchema,
    /** Field map from a message row to the bubble anatomy. */
    message: z
      .object({
        authorField: z.string(),
        bodyField: z.string(),
        timestampField: z.string().optional(),
        /** Row field distinguishing inbound/outbound bubbles. */
        directionField: z.string().optional(),
        /** `html` deferred pending a sanitizer decision. */
        bodyFormat: z.enum(['text', 'markdown', 'html']).optional(),
        /** Row field carrying the delivery state (`queued`/`failed` indicator
         *  on outbound bubbles). */
        deliveryStateField: z.string().optional(),
      })
      .passthrough(),
    placeholderKey: labelStringSchema.optional(),
    actions: z.array(boundActionSchema).optional(),
    /** Bound action for downloading/opening a message attachment. */
    attachmentAction: boundActionSchema.optional(),
  })
  .passthrough();

const messageComposerPropsSchema = z
  .object({
    /** The send action — its args read the composer value via `$input.*`.
     *  Named `submit` (like `Form`) so publish-time collection stays one walker. */
    submit: boundActionSchema,
    /** Optional improve-with-AI action (e.g. `improveMessage`). */
    improve: boundActionSchema.optional(),
    /** View-state key that must be set before the composer enables
     *  (e.g. `conversationId` in a master-detail split). */
    requiresState: z.string().optional(),
    placeholderKey: labelStringSchema.optional(),
    submitLabelKey: labelStringSchema.optional(),
    /** Availability predicate over the selected item (when_predicate grammar). */
    enabledWhen: z.string().optional(),
    onSuccess: actionEffectSchema.optional(),
  })
  .passthrough();

const agentChatPropsSchema = z
  .object({
    title: labelStringSchema.optional(),
    /** Manifest role token → the agent behind the chat (`role ∈ manifest.roles`,
     *  validated at publish). */
    role: z.string(),
    /** Thread subject: present → one shared per-subject thread; absent → the
     *  install-scoped thread. `idField` reads the id from the bound item;
     *  `id` binds it directly (sentinel-capable). */
    subject: z
      .object({
        type: z.string(),
        idField: z.string().optional(),
        id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /** Template for the subject context passed as `additionalContext`. */
    contextTemplate: z.string().optional(),
    placeholder: z.string().optional(),
    placeholderKey: labelStringSchema.optional(),
    height: z.number().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Nodes + documents
// ---------------------------------------------------------------------------

/**
 * One Puck content node — strict on `type` (an unknown block is a publish
 * error), `.passthrough()` at node level (Puck bookkeeping like `readOnly`) and
 * inside `props` (Puck stamps `props.id`; additive future props survive).
 */
export const blockNodeSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('Heading'), props: headingPropsSchema })
    .passthrough(),
  z.object({ type: z.literal('Text'), props: textPropsSchema }).passthrough(),
  z.object({ type: z.literal('Badge'), props: badgePropsSchema }).passthrough(),
  z.object({ type: z.literal('Alert'), props: alertPropsSchema }).passthrough(),
  z.object({ type: z.literal('Card'), props: cardPropsSchema }).passthrough(),
  z
    .object({ type: z.literal('Collection'), props: collectionPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('ReviewQueue'), props: reviewQueuePropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('ExternalList'), props: externalListPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('AgentList'), props: agentListPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('WorkflowDag'), props: workflowDagPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('RunList'), props: runListPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('StatGrid'), props: statGridPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('ChartCard'), props: chartCardPropsSchema })
    .passthrough(),
  z
    .object({ type: z.literal('DetailPanel'), props: detailPanelPropsSchema })
    .passthrough(),
  z.object({ type: z.literal('Form'), props: formPropsSchema }).passthrough(),
  z.object({ type: z.literal('Board'), props: boardPropsSchema }).passthrough(),
  z
    .object({
      type: z.literal('ConversationList'),
      props: conversationListPropsSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal('ConversationThread'),
      props: conversationThreadPropsSchema,
    })
    .passthrough(),
  z
    .object({
      type: z.literal('MessageComposer'),
      props: messageComposerPropsSchema,
    })
    .passthrough(),
  z
    .object({ type: z.literal('AgentChat'), props: agentChatPropsSchema })
    .passthrough(),
]);

/**
 * One Puck Data region (verified against `@measured/puck`'s `Data` type:
 * `root` + `content` + optional `zones`; nodes may carry extra bookkeeping —
 * hence passthrough at every level). `root` defaults so a data doc that omits
 * it still parses (Puck's `Render` tolerates the shape at runtime).
 */
export const puckDataSchema = z
  .object({
    root: z
      .object({ props: z.record(z.string(), z.unknown()).default({}) })
      .passthrough()
      .default({ props: {} }),
    content: z.array(blockNodeSchema),
    zones: z.record(z.string(), z.array(blockNodeSchema)).optional(),
  })
  .passthrough();

/**
 * A navigable area of a view — single-column Puck Data (`data`), or a `columns`
 * array of Puck Data documents laid out side by side. `layout` picks the
 * multi-region arrangement: `columns` (default grid) or `split` (master-detail).
 */
export const automationTabSchema = z
  .object({
    id: z.string(),
    /** Literal tab label (English). */
    label: labelStringSchema,
    /** Per-locale overrides for `label` (`i18n.de.label`, …). */
    i18n: z
      .record(
        z.string(),
        z.object({ label: z.string().optional() }).passthrough(),
      )
      .optional(),
    data: puckDataSchema.optional(),
    columns: z.array(puckDataSchema).optional(),
    layout: z.enum(['columns', 'split']).optional(),
  })
  .passthrough();

/**
 * One page of an automation (`views/*.json`). Either a flat Puck Data document
 * (`data`) or a tabbed shell (`tabs`) — at least one must be present (the
 * discovery path skips docs with neither). `id` falls back to the filename at
 * discovery; `version` absent = v1 (see the file-header versioning rule).
 */
export const automationViewSchema = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    /** Literal display strings (English). */
    title: labelStringSchema.optional(),
    description: labelStringSchema.optional(),
    /** Per-locale overrides for `title`/`description` (`i18n.de.title`, …). */
    i18n: z
      .record(
        z.string(),
        z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    data: puckDataSchema.optional(),
    tabs: z.array(automationTabSchema).optional(),
  })
  .passthrough()
  .refine((view) => view.data !== undefined || (view.tabs?.length ?? 0) > 0, {
    message: 'a view needs `data` or non-empty `tabs`',
  });

// ---------------------------------------------------------------------------
// Inferred types — the runtime imports THESE (no schema↔runtime drift)
// ---------------------------------------------------------------------------

/** The reusable action unit for connected blocks (see {@link boundActionSchema}). */
export type BoundActionSpec = z.infer<typeof boundActionSchema>;

/** One declared config/form field (see {@link formFieldSchema}). */
export type AutomationConfigField = z.infer<typeof formFieldSchema>;

/** A navigable area of a view (see {@link automationTabSchema}). */
export type AutomationTabDoc = z.infer<typeof automationTabSchema>;

/** One page of an automation (see {@link automationViewSchema}). */
export type AutomationViewDoc = z.infer<typeof automationViewSchema>;
