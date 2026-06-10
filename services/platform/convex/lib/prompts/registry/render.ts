/**
 * `renderPrompt` — the single typed accessor for registry prompts.
 *
 * Validates declared placeholders (loud failure on drift), resolves the locale
 * variant, and substitutes via the shared `{{var}}` engine.
 */

import { narrowBcp47 } from '../../../../lib/shared/utils/narrow-bcp47';
import { substituteTemplate } from '../../templating/substitute';
import { PROMPT_REGISTRY, type PromptKey } from './index';
import type { PromptEntry, RenderOptions } from './types';

/** A declared var is "missing" when absent or explicitly empty. */
function isMissing(value: string | undefined): boolean {
  return value === undefined || value === '';
}

function resolveTemplate(entry: PromptEntry, locale?: string): string {
  if (entry.localized) {
    const base = narrowBcp47(locale);
    // Widen to a string-keyed record for the dynamic locale lookup; `.en` is
    // always present (required by LocalizedVariants), so the chain terminates.
    const variants: Record<string, string | undefined> = entry.localized;
    return (
      (locale ? variants[locale] : undefined) ??
      (base ? variants[base] : undefined) ??
      entry.localized.en
    );
  }
  if (entry.template !== undefined) return entry.template;
  throw new Error(
    `Prompt entry "${entry.key}" has neither \`template\` nor \`localized\`.`,
  );
}

/**
 * Render a registry prompt.
 *
 * - Missing REQUIRED var → throws (or warns + leaves marker, per `onMissing`).
 * - Unknown/extra var (not in required ∪ optional) → throws (catches typos/drift).
 * - Declared OPTIONAL var absent → resolves to `''` (marker removed).
 */
export function renderPrompt(
  key: PromptKey,
  vars: Record<string, string> = {},
  opts: RenderOptions = {},
): string {
  const entry = PROMPT_REGISTRY[key];
  if (!entry) throw new Error(`Unknown prompt key: "${key}"`);

  const requiredVars = new Set(entry.required ?? []);
  const declared = new Set<string>([
    ...requiredVars,
    ...(entry.optional ?? []),
  ]);
  const onMissing = opts.onMissing ?? 'throw';

  // Reject unknown/extra vars — a supplied var the entry doesn't declare is
  // almost always a typo or a drifted call site.
  for (const name of Object.keys(vars)) {
    if (!declared.has(name)) {
      throw new Error(
        `Prompt "${key}": unexpected variable "${name}" (declared: ${[...declared].join(', ') || 'none'}).`,
      );
    }
  }

  for (const name of requiredVars) {
    if (!isMissing(vars[name])) continue;
    if (onMissing === 'throw') {
      throw new Error(`Prompt "${key}": missing required variable "${name}".`);
    }
    console.warn(
      `[renderPrompt] "${key}": missing required variable "${name}" — leaving marker intact.`,
    );
  }

  const template = resolveTemplate(entry, opts.locale);

  return substituteTemplate(template, (name) => {
    if (!declared.has(name)) return undefined; // leave stray markers intact
    const value = vars[name];
    if (!isMissing(value)) return value;
    // Missing declared var. A required var in warn-mode leaves the marker
    // intact (mirrors the validation loop above); everything else blanks it.
    return requiredVars.has(name) && onMissing === 'warn' ? undefined : '';
  });
}
