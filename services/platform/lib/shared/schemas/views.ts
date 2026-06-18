/**
 * Pack-authored VIEW configs — the configurable UI layer.
 *
 * A view is a PAGE a pack ships as data: a layout of `parts`, each binding a
 * render-kind (HOW) to a data-source (WHAT) plus optional composition params.
 * The generic renderer resolves each part's source to a reactive query and
 * renders its render-kind — the page is composed by THIS config, never by a
 * workflow's step list.
 *
 * `render` and `source.kind` are lenient strings here (so a malformed pack
 * parses and yields precise per-field errors); `validatePack` checks them
 * against the closed RENDER_KINDS / DATA_SOURCE_KINDS vocabularies at publish.
 * Mirrors how workflow `ui` annotations are validated separately from parsing.
 */
import { z } from 'zod';

/** Render-kind composition params — same closed shape as workflow `ui.params`. */
export const viewPartParamsSchema = z
  .object({
    display: z.string().optional(),
    layout: z.string().optional(),
    entryKind: z.string().optional(),
    mode: z.string().optional(),
    cardinality: z.string().optional(),
    fields: z
      .array(
        z.object({
          key: z.string(),
          labelKey: z.string(),
          type: z.string(),
        }),
      )
      .optional(),
  })
  .strict();

export const viewSourceSchema = z
  .object({
    /** A DATA_SOURCE_KINDS value (validated in validatePack). */
    kind: z.string(),
    /** Validated reactive-query params for the source (shape per source kind). */
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * An ACTION on a part — the "do" half (DATA, never code). `kind` is validated
 * against ACTION_KINDS in validatePack; `when` is the tiny closed predicate
 * gating availability; `params` is the per-kind payload (e.g. trigger_workflow's
 * target slug). Every action routes to ONE existing audited mutation at dispatch.
 */
export const viewActionSchema = z
  .object({
    /** Stable id within the part (dispatch routing; must be unique per part). */
    id: z.string(),
    /** An ACTION_KINDS value (validated in validatePack). */
    kind: z.string(),
    /** Show an are-you-sure confirm before dispatching. */
    confirm: z.boolean().optional(),
    /** Availability predicate over the bound item (closed grammar). */
    when: z.string().optional(),
    /** Per-kind payload (e.g. { workflow }, { assigneeId }, { decision }). */
    params: z.record(z.string(), z.unknown()).optional(),
    /** Tier-2 pack key + literal fallback for the button label. */
    labelKey: z.string().optional(),
    title: z.string().optional(),
  })
  .strict();

export const viewPartSchema = z
  .object({
    /** Stable id within the view (React key + label scoping). */
    id: z.string(),
    /** A RENDER_KINDS value (validated in validatePack). */
    render: z.string(),
    source: viewSourceSchema,
    /** Tier-2 (pack) localization key for the part's title. */
    labelKey: z.string().optional(),
    /** Literal title fallback when no `labelKey` bundle is loaded. */
    title: z.string().optional(),
    params: viewPartParamsSchema.optional(),
    /** Actions a person can take on this part / its rows (the "do" half). */
    actions: z.array(viewActionSchema).optional(),
    /**
     * Master-detail: when this part is the LIST in a `split` view, the field on
     * a selected row whose value rebinds the detail parts' source params (e.g.
     * 'executionId' → detail's workflow_run source). Selecting a row threads
     * `{ [selectionKey]: row[selectionKey] }` into every detail part.
     */
    selectionKey: z.string().optional(),
  })
  .strict();

export const viewConfigSchema = z
  .object({
    /** Stable id within the pack — the sub-page slug under the Apps hub. */
    id: z.string(),
    /** Tier-2 localization key for the page title (falls back to `title`). */
    titleKey: z.string().optional(),
    title: z.string().optional(),
    /** Tier-2 key for an optional page subtitle/description. */
    descriptionKey: z.string().optional(),
    /**
     * `stack`/`grid` lay every part out equally. `split` is master-detail: the
     * FIRST part is the list (left), the rest are the detail (right) and rebind
     * to the list's selected row via its `selectionKey`. The closed-loop shape.
     */
    layout: z.enum(['stack', 'grid', 'split']).optional(),
    parts: z.array(viewPartSchema),
  })
  .strict();

export type ViewPartParams = z.infer<typeof viewPartParamsSchema>;
export type ViewSource = z.infer<typeof viewSourceSchema>;
export type ViewAction = z.infer<typeof viewActionSchema>;
export type ViewPart = z.infer<typeof viewPartSchema>;
export type ViewConfig = z.infer<typeof viewConfigSchema>;
