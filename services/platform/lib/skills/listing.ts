/**
 * Listing and resolving the skills of ONE organization.
 *
 * The core is pure: it never touches a filesystem and never imports Convex.
 * A caller injects a {@link SkillBundleReader} bound to a single org's
 * directory, which is also what makes cross-org isolation structural — a
 * reader can only ever see the org it was built for, so a listing cannot
 * accidentally span two organizations.
 *
 * One malformed bundle must not take a whole org's library down, so listing
 * collects failures instead of throwing: each carries the offending path and
 * the reason, and the caller at the edge surfaces them (a log line, an admin
 * banner). Reading ONE named skill throws instead — there is no partial
 * answer to give.
 */

import {
  isValidSkillSlug,
  type SkillFrontmatter,
} from '../shared/schemas/skills';
import { parseSkillMd, SkillParseError } from './parse';
import { canViewSkill, type SkillViewer } from './visibility';

/**
 * Access to one organization's skill bundles. Implementations bind the org
 * up front; nothing below can widen that scope.
 */
export interface SkillBundleReader {
  /** Slugs of the bundle directories present, in any order. */
  listSlugs(): Promise<readonly string[]>;
  /** Raw `SKILL.md` text for `slug`, or `null` when the bundle has none. */
  readSkillMd(slug: string): Promise<string | null>;
  /** How this reader names a slug's `SKILL.md`, for error messages. */
  describe(slug: string): string;
}

/** A skill that parsed cleanly. */
export interface OrgSkill {
  readonly slug: string;
  /** The `SKILL.md` path this was read from, as the reader names it. */
  readonly path: string;
  readonly meta: SkillFrontmatter;
  /** The markdown body — the knowledge an agent expands, never executed. */
  readonly body: string;
}

/** A bundle that could not be read, kept out of the listing. */
export interface SkillLoadFailure {
  readonly slug: string;
  readonly path: string;
  readonly message: string;
}

export interface SkillListing {
  /** Readable skills, sorted by slug for a stable order. */
  readonly skills: readonly OrgSkill[];
  /** Bundles that failed to load, sorted by slug. */
  readonly failures: readonly SkillLoadFailure[];
}

/**
 * Read one named skill. Returns `null` when the bundle has no `SKILL.md`;
 * throws {@link SkillParseError} — naming the path — when it has a broken one.
 */
export async function readOrgSkill(
  reader: SkillBundleReader,
  slug: string,
): Promise<OrgSkill | null> {
  const path = reader.describe(slug);
  if (!isValidSkillSlug(slug)) {
    throw new SkillParseError(path, `"${slug}" is not a valid skill slug`);
  }
  const content = await reader.readSkillMd(slug);
  if (content === null) return null;

  const { meta, body } = parseSkillMd(content, path);
  if (meta.name !== slug) {
    throw new SkillParseError(
      path,
      `frontmatter name "${meta.name}" does not match the bundle directory "${slug}"`,
    );
  }
  return { slug, path, meta, body };
}

/**
 * Read every bundle the reader can see, without applying visibility;
 * viewer-facing listings go through {@link listOrgSkills}.
 */
export async function readOrgSkills(
  reader: SkillBundleReader,
): Promise<SkillListing> {
  const slugs = [...(await reader.listSlugs())].sort();
  const skills: OrgSkill[] = [];
  const failures: SkillLoadFailure[] = [];

  for (const slug of slugs) {
    try {
      const skill = await readOrgSkill(reader, slug);
      if (skill !== null) skills.push(skill);
    } catch (err) {
      failures.push({
        slug,
        path: reader.describe(slug),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { skills, failures };
}

/**
 * The skills `viewer` may see in this organization: every bundle
 * {@link canViewSkill} admits. Failures are reported unfiltered — a broken
 * bundle is an operator problem regardless of who it would have belonged to.
 */
export async function listOrgSkills(
  reader: SkillBundleReader,
  viewer: SkillViewer,
): Promise<SkillListing> {
  const { skills, failures } = await readOrgSkills(reader);
  return {
    skills: skills.filter((skill) => canViewSkill(skill.meta, viewer)),
    failures,
  };
}
