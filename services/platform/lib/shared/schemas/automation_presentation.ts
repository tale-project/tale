/**
 * How an automation NAMES ITSELF to people — the display half of a pack
 * manifest, versioned with the document so every surface reads the same thing.
 *
 * The slug is addressing, not a label: `payroll-desk` is how the store, the
 * run log and the pack directory refer to the automation, and showing it in a
 * dialog title or a task panel leaks that addressing at the reader. Packs
 * already declare a real name and its translations (`automation.yml`: `name`,
 * `description`, `icon`, `labels`, `i18n.<locale>`), which the install used to
 * drop on the floor; this is the shape that carries it through.
 *
 * Only what a surface shows is kept. Scope, triggers, requirements and the rest
 * of the manifest drive behaviour and live where that behaviour is resolved.
 */

import { z } from 'zod/v4';

const localizedTextSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export const automationPresentationSchema = z
  .object({
    /** Display name, authored in English. */
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    /** Lucide icon name for the automation's card/badge. */
    icon: z.string().min(1).optional(),
    /** Catalog chips — proper nouns, left untranslated on purpose. */
    labels: z.array(z.string().min(1)).max(6).optional(),
    /** Per-locale overrides; an absent locale falls back to the English above. */
    i18n: z
      .record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), localizedTextSchema)
      .optional(),
    /**
     * Product surfaces this pack opens (`inbox`, …). Carried with the
     * version so the Inbox gate can read it without re-opening the pack
     * directory.
     */
    builtinViews: z
      .array(z.object({ id: z.string().min(1) }).strict())
      .max(8)
      .optional(),
    /** Connectors the pack needs connected — first entry is the mail provider
     * for inbox packs. */
    requiredConnectors: z.array(z.string().min(1)).max(16).optional(),
  })
  .strict();

export type AutomationPresentation = z.infer<
  typeof automationPresentationSchema
>;

/** Tolerant read of a stored presentation: an unparsable value reads as none,
 * so a surface falls back to the slug instead of failing to render. */
export function parseAutomationPresentation(
  value: unknown,
): AutomationPresentation | null {
  const parsed = automationPresentationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * A slug read as a title, for automations that never declared a name — the ones
 * authored on the canvas or by the builder, where the slug IS what the author
 * typed. `github/triage-issues` → "Triage issues": the leading namespace is
 * addressing too, and the surfaces that show a name are already inside the
 * automation's own context.
 */
export function titleFromSlug(slug: string): string {
  const leaf = slug.split('/').pop() ?? slug;
  const words = leaf.replaceAll(/[-_]+/g, ' ').trim();
  if (words === '') return slug;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The locale chain every declared text follows: exact tag, then base language,
 * then the authored English. Mirrors the task contract's and the settings
 * forms' own resolution. */
function localized(
  presentation: AutomationPresentation,
  locale: string,
): { name: string; description?: string } {
  const base = locale.split('-')[0] ?? locale;
  const override = {
    ...presentation.i18n?.[base],
    ...presentation.i18n?.[locale],
  };
  const description = override.description ?? presentation.description;
  return {
    name: override.name ?? presentation.name,
    ...(description !== undefined && { description }),
  };
}

/**
 * What to show wherever an automation is named: its declared name in the
 * reader's language, or the slug read as a title when nothing was declared.
 * Never the raw slug — that is what this exists to stop.
 */
export function automationDisplayName(
  presentation: unknown,
  slug: string,
  locale: string,
): string {
  const parsed = parseAutomationPresentation(presentation);
  return parsed === null ? titleFromSlug(slug) : localized(parsed, locale).name;
}

/** The declared description in the reader's language, when there is one. */
export function automationDisplayDescription(
  presentation: unknown,
  locale: string,
): string | undefined {
  const parsed = parseAutomationPresentation(presentation);
  return parsed === null ? undefined : localized(parsed, locale).description;
}
