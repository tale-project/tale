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
    layout: z.enum(['stack', 'grid']).optional(),
    parts: z.array(viewPartSchema),
  })
  .strict();

export type ViewPartParams = z.infer<typeof viewPartParamsSchema>;
export type ViewSource = z.infer<typeof viewSourceSchema>;
export type ViewPart = z.infer<typeof viewPartSchema>;
export type ViewConfig = z.infer<typeof viewConfigSchema>;
