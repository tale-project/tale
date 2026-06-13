import { z } from 'zod/v4';

import {
  MAX_PROMPT_CATEGORY_LEN,
  MAX_PROMPT_DESCRIPTION_LEN,
  MAX_PROMPT_TAG_LEN,
  MAX_PROMPT_TAGS_COUNT,
  MAX_PROMPT_TITLE_LEN,
} from '../../../convex/prompts/constants';

/**
 * Schema for the prompt-library JSON file format.
 *
 * This is the canonical on-disk shape for the default prompt catalog
 * (`examples/default/prompts/*.json`), mirroring the agent/workflow config
 * pattern (Zod for file I/O; Convex validators back the DB layer). Each file
 * with `metadata.autoInstall: true` is seeded as a `global`-scope prompt into
 * every organization on creation — see
 * `convex/prompts/provision_defaults.ts`.
 *
 * Length caps mirror `convex/prompts/constants.ts`. The content byte-cap
 * (`MAX_PROMPT_CONTENT_BYTES`) is enforced canonically by `assertPromptSizes`
 * in the provisioning mutation, so it is intentionally not re-encoded here.
 */
export const promptJsonSchema = z.object({
  /** Display name shown in the prompt library list. */
  title: z.string().min(1).max(MAX_PROMPT_TITLE_LEN),
  /** The prompt body inserted into the composer. */
  content: z.string().min(1),
  /** Short one-line summary shown under the title. */
  description: z.string().max(MAX_PROMPT_DESCRIPTION_LEN).optional(),
  /**
   * Free-form category label (e.g. "Writing", "Productivity"). Stored as the
   * legacy `category` string on the seeded row; the existing lazy-migration
   * path converts it to a `promptCategories` row on first edit.
   */
  category: z.string().max(MAX_PROMPT_CATEGORY_LEN).optional(),
  tags: z
    .array(z.string().min(1).max(MAX_PROMPT_TAG_LEN))
    .max(MAX_PROMPT_TAGS_COUNT)
    .optional(),
  /**
   * Per-locale overrides, keyed by locale code (e.g. `de`, `fr`). The
   * top-level fields are the canonical English copy; an org is seeded in its
   * chosen `defaultLocale`, resolving overrides via `resolvePromptDisplay`
   * with fallback to the top-level (English) text. Mirrors the agent
   * `i18n` model.
   */
  i18n: z
    .record(
      z.string(),
      z.object({
        title: z.string().min(1).max(MAX_PROMPT_TITLE_LEN).optional(),
        content: z.string().min(1).optional(),
        description: z.string().max(MAX_PROMPT_DESCRIPTION_LEN).optional(),
        category: z.string().max(MAX_PROMPT_CATEGORY_LEN).optional(),
      }),
    )
    .optional(),
  /** Provisioner metadata. Only `autoInstall` is read today. */
  metadata: z
    .object({
      autoInstall: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

export type PromptJsonConfig = z.infer<typeof promptJsonSchema>;

export interface ResolvedPromptDisplay {
  title: string;
  content: string;
  description?: string;
  category?: string;
}

/**
 * Resolve a prompt's localized display fields for `locale`, falling back to
 * the canonical top-level (English) copy per-field. `locale` is expected to be
 * one of the supported app locales (already clamped by the caller).
 */
export function resolvePromptDisplay(
  config: PromptJsonConfig,
  locale: string,
): ResolvedPromptDisplay {
  const o = config.i18n?.[locale];
  return {
    title: o?.title ?? config.title,
    content: o?.content ?? config.content,
    description: o?.description ?? config.description,
    category: o?.category ?? config.category,
  };
}
