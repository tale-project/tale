/**
 * Agent file → slim agent definition: the pure mapping this migration writes.
 *
 * The previous format described a persona AND how its turns executed. The
 * slim format describes only the persona, so the conversion has two jobs:
 * carry across what an agent still is, and make sure nothing it used to say
 * is simply gone.
 *
 * CARRIED, because the meaning is unchanged: the slug, the display name, the
 * description, the instructions, the per-locale overrides of those three, the
 * skill allowlist, and — folded from four knobs into one scope — which
 * knowledge the agent's retrieval may read.
 *
 * PRESERVED under `metadata.retired`, verbatim and kebab-cased: every other
 * key the file carried. A pinned model, a timeout, conversation starters, a
 * routing block, an env requirement, the install metadata — all of it stays
 * readable in the converted file, so the conversion is an information-
 * preserving rewrite rather than a summary, and an operator can see exactly
 * what an agent used to be.
 *
 * Two carries are deliberately NOT made:
 *  - the tool allowlist, because the names an agent could bind changed with
 *    the surface that answers them. Narrowing a converted agent to names
 *    nothing answers would mute it; leaving it un-narrowed keeps it working,
 *    and the previous list sits under `metadata.retired.tool-names` for an
 *    operator to re-apply deliberately.
 *  - the "visible in chat" flag, because sharing is now `visibility` +
 *    `owner`, and these files were organization configuration with no owner
 *    to make private. Every converted agent is therefore `org`-visible, with
 *    the old flag preserved.
 *
 * Reading is deliberately LENIENT — plain JSON, not the previous schema. A
 * file that no longer validates under a retired schema is still a file an
 * organization has, and refusing to convert it would strand the org on the
 * old format. Values are clamped to what the slim schema accepts and anything
 * that does not fit is preserved instead of dropped.
 *
 * Pure: no filesystem, no Convex.
 */

import {
  isValidAgentSlug,
  MAX_AGENT_INSTRUCTIONS_LENGTH,
  MAX_AGENT_SKILL_BINDINGS,
  MAX_AGENT_SLUG_LENGTH,
  type AgentDefinition,
  type AgentKnowledgeScope,
  type AgentTranslations,
} from '../../../../../lib/shared/schemas/agents';
import { SKILL_SLUG_REGEX } from '../../../../../lib/shared/schemas/skills';

/** One agent file as it sits on disk before the conversion. */
export interface RetiredAgentFile {
  /** Path relative to the org's `agents/` dir, e.g. `chat/assistant.json`. */
  readonly relPath: string;
  /** The file's contents, parsed as plain JSON. */
  readonly data: unknown;
}

/** One converted agent, ready to be written as `agents/<slug>.yml`. */
export interface ConvertedAgent {
  readonly slug: string;
  /** Where it came from, relative to the org's `agents/` dir. */
  readonly sourcePath: string;
  readonly definition: AgentDefinition;
}

/** The `metadata` key under which the previous file's own fields are kept. */
const RETIRED_METADATA_KEY = 'retired';

/** Slug used when a file name contains nothing a slug can keep. */
const FALLBACK_SLUG = 'agent';

const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_LABEL_LENGTH = 40;
const MAX_LABELS = 8;

/**
 * Keys whose meaning survives into a named field of the slim format, so
 * repeating them under `metadata.retired` would only duplicate. `i18n` and
 * `metadata` are split rather than carried whole — see the two helpers below.
 */
const CARRIED_KEYS: ReadonlySet<string> = new Set([
  'slug',
  'displayName',
  'description',
  'systemInstructions',
  'skillBindings',
  'i18n',
  'metadata',
]);

/** Per-locale keys the slim format keeps; everything else is preserved. */
const CARRIED_LOCALE_KEYS: ReadonlySet<string> = new Set([
  'displayName',
  'description',
  'systemInstructions',
]);

/** Locale tags the slim format accepts as `i18n` keys. */
const LOCALE_KEY_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** camelCase → kebab-case, so the preserved block reads like the new format. */
function toKebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Reduce a file name to the shape an agent slug can carry. */
export function slugifyAgentName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, (run) => run[0])
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_AGENT_SLUG_LENGTH)
    .replace(/[-_]+$/g, '');
  return slug === '' ? FALLBACK_SLUG : slug;
}

/**
 * Give `base` a slug no agent in `taken` already claims, by appending an
 * ordinal within the length budget. Registers the result in `taken`.
 */
function claimSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `-${ordinal}`;
    const trimmed = base
      .slice(0, MAX_AGENT_SLUG_LENGTH - suffix.length)
      .replace(/[-_]+$/g, '');
    const candidate = `${trimmed === '' ? FALLBACK_SLUG : trimmed}${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** The file's own name, without directories or extension. */
function fileStem(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.json$/i, '');
}

/**
 * The slug the file claimed: its own `slug` field when it had one (identity
 * lived in the file, not the path), otherwise its name on disk.
 */
function claimedSlug(data: Record<string, unknown>, relPath: string): string {
  return asNonEmptyString(data.slug) ?? fileStem(relPath);
}

/** The locale entries of an `i18n` block, in a stable order. */
function localeEntries(
  data: Record<string, unknown>,
): Array<[string, Record<string, unknown>]> {
  const i18n = asRecord(data.i18n);
  if (i18n === null) return [];
  return Object.entries(i18n)
    .map(([locale, value]): [string, Record<string, unknown> | null] => [
      locale,
      asRecord(value),
    ])
    .filter((entry): entry is [string, Record<string, unknown>] =>
      Boolean(entry[1]),
    )
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The label to show. A file always named itself somewhere — at the top level
 * or in one of its locales — and the slug is the last resort.
 */
function displayNameFor(data: Record<string, unknown>, slug: string): string {
  const locales = localeEntries(data);
  const english = locales.find(([locale]) => locale === 'en');
  const named = locales.find(([, fields]) =>
    Boolean(asNonEmptyString(fields.displayName)),
  );
  const name =
    asNonEmptyString(data.displayName) ??
    (english ? asNonEmptyString(english[1].displayName) : undefined) ??
    (named ? asNonEmptyString(named[1].displayName) : undefined) ??
    slug;
  return name.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/**
 * Fold the four retrieval knobs into one scope. A mode other than `off`, or
 * either "include this corpus" flag, means that corpus was in play; nothing
 * set means the agent never retrieved at all.
 */
export function knowledgeScopeFor(
  data: Record<string, unknown>,
): AgentKnowledgeScope {
  const isOn = (mode: unknown): boolean =>
    typeof mode === 'string' && mode !== 'off';
  const documents =
    isOn(data.knowledgeMode) ||
    data.includeOrgKnowledge === true ||
    data.includeTeamKnowledge === true;
  const web = isOn(data.webSearchMode);
  if (documents && web) return 'all';
  if (documents) return 'documents';
  if (web) return 'web';
  return 'none';
}

/** The catalog labels the file carried, trimmed to what a chip can hold. */
function labelsFor(data: Record<string, unknown>): string[] | undefined {
  const metadata = asRecord(data.metadata);
  const raw = metadata?.labels;
  if (!Array.isArray(raw)) return undefined;
  const labels = raw
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter((label) => label !== '')
    .map((label) => label.slice(0, MAX_LABEL_LENGTH))
    .slice(0, MAX_LABELS);
  return labels.length > 0 ? labels : undefined;
}

/** The skill allowlist, keeping only slugs the skills domain can resolve. */
function skillsFor(data: Record<string, unknown>): string[] | undefined {
  const raw = data.skillBindings;
  if (!Array.isArray(raw)) return undefined;
  const skills = raw
    .filter(
      (slug): slug is string =>
        typeof slug === 'string' && SKILL_SLUG_REGEX.test(slug),
    )
    .slice(0, MAX_AGENT_SKILL_BINDINGS);
  // An empty list is meaningful — it means the agent expands no skills — so
  // it is kept rather than collapsed into "not narrowed".
  return skills;
}

/** The per-locale overrides the slim format keeps. */
function translationsFor(
  data: Record<string, unknown>,
): Record<string, AgentTranslations> | undefined {
  const translations: Record<string, AgentTranslations> = {};
  for (const [locale, fields] of localeEntries(data)) {
    if (!LOCALE_KEY_REGEX.test(locale)) continue;
    const entry: AgentTranslations = {};
    const displayName = asNonEmptyString(fields.displayName);
    const description = asNonEmptyString(fields.description);
    const instructions = asNonEmptyString(fields.systemInstructions);
    if (displayName !== undefined) {
      entry.displayName = displayName.slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
    if (description !== undefined) {
      entry.description = description.slice(0, MAX_DESCRIPTION_LENGTH);
    }
    if (instructions !== undefined) {
      entry.instructions = instructions.slice(0, MAX_AGENT_INSTRUCTIONS_LENGTH);
    }
    if (Object.keys(entry).length > 0) translations[locale] = entry;
  }
  return Object.keys(translations).length > 0 ? translations : undefined;
}

/** Per-locale keys the slim format has no home for, kept as they were. */
function retiredTranslations(
  data: Record<string, unknown>,
): Record<string, Record<string, unknown>> | undefined {
  const kept: Record<string, Record<string, unknown>> = {};
  for (const [locale, fields] of localeEntries(data)) {
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      // A locale the slim format cannot key by is preserved whole, since
      // dropping it would silently delete a translation.
      if (CARRIED_LOCALE_KEYS.has(key) && LOCALE_KEY_REGEX.test(locale)) {
        continue;
      }
      extra[toKebabCase(key)] = value;
    }
    if (Object.keys(extra).length > 0) kept[locale] = extra;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Everything the slim format drops, kept verbatim under one key. */
function retiredSettingsFor(
  data: Record<string, unknown>,
  slug: string,
  relPath: string,
  fullInstructions: string | undefined,
): Record<string, unknown> | undefined {
  const retired: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (CARRIED_KEYS.has(key)) continue;
    retired[toKebabCase(key)] = value;
  }

  const metadata = asRecord(data.metadata);
  if (metadata !== null && Object.keys(metadata).length > 0) {
    retired.metadata = metadata;
  }
  const translations = retiredTranslations(data);
  if (translations !== undefined) retired.i18n = translations;

  // The file lived somewhere the flat format has no room for, or under a name
  // the slug shape could not keep — say so, so nothing looks renamed by magic.
  const previousSlug = claimedSlug(data, relPath);
  if (previousSlug !== slug) retired.slug = previousSlug;
  if (relPath !== `${slug}.json`) retired['source-path'] = relPath;

  // Instructions longer than the slim cap are clamped in the definition; the
  // full text stays here so the clamp is recoverable.
  if (fullInstructions !== undefined) retired.instructions = fullInstructions;

  return Object.keys(retired).length > 0 ? retired : undefined;
}

/**
 * Order files so slug assignment cannot depend on the order a directory walk
 * happened to return them in.
 */
function inConversionOrder(
  files: readonly RetiredAgentFile[],
): RetiredAgentFile[] {
  return [...files].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Convert one organization's agent files. Deterministic: the same files
 * always produce the same slugs and the same bytes, which is what makes the
 * conversion idempotent.
 */
export function convertAgentFiles(
  files: readonly RetiredAgentFile[],
): ConvertedAgent[] {
  const taken = new Set<string>();
  const converted: ConvertedAgent[] = [];

  for (const file of inConversionOrder(files)) {
    const data = asRecord(file.data);
    if (data === null) continue;

    const claimed = claimedSlug(data, file.relPath);
    const slug = claimSlug(
      isValidAgentSlug(claimed) ? claimed : slugifyAgentName(claimed),
      taken,
    );

    const authored = asNonEmptyString(data.systemInstructions);
    const clamped =
      authored !== undefined && authored.length > MAX_AGENT_INSTRUCTIONS_LENGTH
        ? authored.slice(0, MAX_AGENT_INSTRUCTIONS_LENGTH)
        : authored;

    const definition: AgentDefinition = {
      name: slug,
      displayName: displayNameFor(data, slug),
      // These files were organization configuration: they had no owner, so
      // there is nobody a private agent could belong to.
      visibility: 'org',
      knowledge: knowledgeScopeFor(data),
    };

    const description = asNonEmptyString(data.description);
    if (description !== undefined) {
      definition.description = description.slice(0, MAX_DESCRIPTION_LENGTH);
    }
    const labels = labelsFor(data);
    if (labels !== undefined) definition.labels = labels;
    if (clamped !== undefined) definition.instructions = clamped;
    const skills = skillsFor(data);
    if (skills !== undefined) definition.skills = skills;
    const i18n = translationsFor(data);
    if (i18n !== undefined) definition.i18n = i18n;

    const retired = retiredSettingsFor(
      data,
      slug,
      file.relPath,
      clamped !== authored ? authored : undefined,
    );
    if (retired !== undefined) {
      definition.metadata = { [RETIRED_METADATA_KEY]: retired };
    }

    converted.push({ slug, sourcePath: file.relPath, definition });
  }
  return converted;
}

/**
 * Read back what a converted agent records about the file it came from, or
 * `null` for an agent that was never converted. The inverse of the mapping
 * above: together they make the conversion an information-preserving rewrite
 * rather than a lossy summary.
 */
export function readRetiredAgentSettings(
  definition: AgentDefinition,
): Record<string, unknown> | null {
  const raw = definition.metadata?.[RETIRED_METADATA_KEY];
  return asRecord(raw);
}
