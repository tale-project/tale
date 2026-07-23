/**
 * Prompt template → skill bundle: the pure mapping this migration exports.
 *
 * A prompt row and a skill file say the same thing in two vocabularies. The
 * body carries over verbatim, the sharing scope becomes the skill's
 * visibility (`personal` → `private`, `team`/`global` → `org`), and the
 * fields with no frontmatter of their own — the free-text title, the original
 * scope, the team, the category and tags — are kept under `metadata.prompt`,
 * so an exported skill still says exactly which prompt it came from and can
 * be read back into one.
 *
 * Slugs are derived from the title, which is free text, so two prompts can
 * want the same directory. Assignment is therefore done for a whole org at
 * once over a deterministically sorted list: the same rows always produce the
 * same slugs, which is what makes the export idempotent.
 *
 * Pure: no filesystem, no Convex.
 */

import {
  MAX_SKILL_SLUG_LENGTH,
  RESERVED_SKILL_SLUGS,
  type SkillFrontmatter,
  type SkillVisibility,
} from '../../../../../lib/shared/schemas/skills';

/** The prompt-row fields this export reads. */
export interface PromptTemplateRow {
  readonly _id: string;
  readonly _creationTime?: number;
  readonly organizationId: string;
  readonly createdBy: string;
  readonly title: string;
  readonly content: string;
  readonly description?: string;
  readonly scope: 'global' | 'team' | 'personal';
  readonly teamId?: string;
  readonly category?: string;
  readonly tags?: string[];
  readonly lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
}

/** What `metadata.prompt` records about the row a skill was exported from. */
export interface PromptOrigin {
  readonly id: string;
  readonly title: string;
  readonly scope: 'global' | 'team' | 'personal';
  readonly team?: string;
  readonly category?: string;
  readonly tags?: string[];
}

/** One exported bundle. */
export interface ExportedSkill {
  readonly slug: string;
  readonly meta: SkillFrontmatter;
  readonly body: string;
}

/** The `metadata` key under which a prompt's own fields are preserved. */
const PROMPT_ORIGIN_METADATA_KEY = 'prompt';

/** Slug used when a title contains nothing a directory name can keep. */
const FALLBACK_SLUG = 'prompt';

/** Display chips are short; a longer category or tag is simply not one. */
const MAX_LABEL_LENGTH = 40;
const MAX_LABELS = 8;

/**
 * A soft-deleted prompt is not part of the library any more, so it is not
 * exported — resurrecting one as a skill would undo a member's delete.
 */
function isExportablePrompt(row: PromptTemplateRow): boolean {
  return row.lifecycleStatus === undefined || row.lifecycleStatus === 'active';
}

/** `personal` is one member's own; every shared scope becomes org-visible. */
function visibilityForScope(
  scope: PromptTemplateRow['scope'],
): SkillVisibility {
  return scope === 'personal' ? 'private' : 'org';
}

/** Reduce a free-text title to the kebab shape a bundle directory can carry. */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_SLUG_LENGTH)
    .replace(/-+$/g, '');
  if (slug === '' || RESERVED_SKILL_SLUGS.has(slug)) return FALLBACK_SLUG;
  return slug;
}

/**
 * Give `base` a slug no bundle in `taken` already claims, by appending an
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
      .slice(0, MAX_SKILL_SLUG_LENGTH - suffix.length)
      .replace(/-+$/g, '');
    const candidate = `${trimmed === '' ? FALLBACK_SLUG : trimmed}${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** Category first, then tags — trimmed to what a display chip can hold. */
function labelsFor(row: PromptTemplateRow): string[] | undefined {
  const labels = [row.category, ...(row.tags ?? [])]
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter((label) => label !== '')
    .map((label) => label.slice(0, MAX_LABEL_LENGTH))
    .slice(0, MAX_LABELS);
  return labels.length > 0 ? labels : undefined;
}

function originFor(row: PromptTemplateRow): PromptOrigin {
  const origin: {
    id: string;
    title: string;
    scope: PromptTemplateRow['scope'];
    team?: string;
    category?: string;
    tags?: string[];
  } = { id: row._id, title: row.title, scope: row.scope };
  if (row.teamId !== undefined) origin.team = row.teamId;
  if (row.category !== undefined) origin.category = row.category;
  if (row.tags !== undefined && row.tags.length > 0)
    origin.tags = [...row.tags];
  return origin;
}

/**
 * Order rows so slug assignment cannot depend on the order the database
 * happened to return them in: oldest first, ties broken by id.
 */
function inExportOrder(
  rows: readonly PromptTemplateRow[],
): PromptTemplateRow[] {
  return [...rows].sort((a, b) => {
    const byTime = (a._creationTime ?? 0) - (b._creationTime ?? 0);
    return byTime !== 0 ? byTime : a._id.localeCompare(b._id);
  });
}

/**
 * Map one organization's prompt rows onto skill bundles. Soft-deleted rows
 * are dropped; the rest keep their body verbatim and gain the frontmatter
 * that describes them.
 */
export function exportPromptsToSkills(
  rows: readonly PromptTemplateRow[],
): ExportedSkill[] {
  const taken = new Set<string>();
  const exported: ExportedSkill[] = [];

  for (const row of inExportOrder(rows)) {
    if (!isExportablePrompt(row)) continue;

    const slug = claimSlug(slugifyTitle(row.title), taken);
    const visibility = visibilityForScope(row.scope);
    const meta: SkillFrontmatter = {
      name: slug,
      // The schema requires a description; a prompt's is optional, and its
      // title is the next most descriptive thing the row has.
      description: row.description?.trim() || row.title,
      visibility,
      owner: row.createdBy,
      labels: labelsFor(row),
      metadata: { [PROMPT_ORIGIN_METADATA_KEY]: originFor(row) },
      extra: {},
    };
    exported.push({
      slug,
      meta,
      body: row.content.endsWith('\n') ? row.content : `${row.content}\n`,
    });
  }
  return exported;
}

/**
 * Read back what a skill file records about the prompt it was exported from,
 * or `null` for a skill that was never a prompt. The inverse of the mapping
 * above: together they make the export an information-preserving rewrite
 * rather than a lossy summary.
 */
export function readPromptOrigin(meta: SkillFrontmatter): PromptOrigin | null {
  const raw = meta.metadata?.[PROMPT_ORIGIN_METADATA_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = record.id;
  const title = record.title;
  const scope = record.scope;
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    (scope !== 'global' && scope !== 'team' && scope !== 'personal')
  ) {
    return null;
  }
  const origin: {
    id: string;
    title: string;
    scope: PromptTemplateRow['scope'];
    team?: string;
    category?: string;
    tags?: string[];
  } = { id, title, scope };
  if (typeof record.team === 'string') origin.team = record.team;
  if (typeof record.category === 'string') origin.category = record.category;
  if (Array.isArray(record.tags)) {
    origin.tags = record.tags.filter(
      (tag): tag is string => typeof tag === 'string',
    );
  }
  return origin;
}
