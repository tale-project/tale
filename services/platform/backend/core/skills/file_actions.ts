'use node';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  isValidSkillSlug,
  MAX_SKILL_TEAMS,
  type SkillFrontmatter,
} from '../../../lib/shared/schemas/skills';
import {
  listOrgSkills,
  readOrgSkill,
  type OrgSkill,
} from '../../../lib/skills/listing';
import {
  parseSkillMd,
  serializeSkillMd,
  SkillParseError,
} from '../../../lib/skills/parse';
import {
  canEditSkill,
  canViewSkill,
  type SkillViewer,
  type UserSkillViewer,
} from '../../../lib/skills/visibility';
import { type ParsedBundle } from './bundle_zip';
import {
  createOrgSkillReader,
  listSkillBundleFileEntries,
  readSkillBundleAsset,
  readSkillBundleFiles,
  removeSkillBundle,
  resolveSkillMdPath,
  SKILL_DOCUMENT_NAME,
  SKILLS_CONFIG_DOMAIN,
  writeSkillMdText,
} from './file_utils';
import {
  type SkillBundleFileView,
  type SkillBundleView,
  type SkillDocumentView,
  type SkillListingView,
  type SkillSummaryView,
} from './views';

/** `skills/<slug>/SKILL.md` — the path an operator sees, org-tree relative. */
function relativeSkillPath(slug: string): string {
  return `${SKILLS_CONFIG_DOMAIN}/${slug}/${SKILL_DOCUMENT_NAME}`;
}

function toSummary(skill: OrgSkill, viewer: SkillViewer): SkillSummaryView {
  const { meta } = skill;
  return {
    slug: skill.slug,
    description: meta.description,
    visibility: meta.visibility,
    teams: meta.teams === undefined ? undefined : [...meta.teams],
    owner: meta.owner,
    icon: meta.icon,
    labels: meta.labels,
    disableModelInvocation: meta.disableModelInvocation,
    canEdit: canEditSkill(meta, viewer),
  };
}

function assertValidSlug(slug: string): void {
  if (!isValidSkillSlug(slug)) {
    throw new AppError({
      code: 'INVALID_SKILL_SLUG',
      message: `"${slug}" is not a valid skill slug — use lowercase letters, digits and single hyphens.`,
    });
  }
}

/**
 * Writes come only from people: the library, the REST API, an upload. A
 * project or org viewer reaching a write handler is a caller bug, not a
 * permission call to weigh.
 */
function assertUserViewer(viewer: SkillViewer): UserSkillViewer {
  if (viewer.kind !== 'user') {
    throw new AppError({
      code: 'SKILL_FORBIDDEN',
      message: 'Only a member can create, edit or delete a skill.',
    });
  }
  return viewer;
}

/**
 * The skills the asking viewer can see in this org, plus any bundle that
 * failed to load. Failures are logged with their absolute path (the operator
 * signal) and returned with the org-relative one.
 */
export async function listSkillsForViewer(args: {
  orgSlug: string;
  viewer: SkillViewer;
}): Promise<SkillListingView> {
  const listing = await listOrgSkills(
    createOrgSkillReader(args.orgSlug),
    args.viewer,
  );
  for (const failure of listing.failures) {
    console.error(
      `[skills] ${args.orgSlug}: skipping unreadable skill — ${failure.message}`,
    );
  }
  return {
    skills: listing.skills.map((skill) => toSummary(skill, args.viewer)),
    failures: listing.failures.map((failure) => ({
      slug: failure.slug,
      path: relativeSkillPath(failure.slug),
      message: failure.message,
    })),
  };
}
/**
 * One skill with its body and its bundle's file names, or `null` when the
 * org has no such bundle. A bundle the viewer may not see reads as absent;
 * telling them it exists would already leak someone else's private skill.
 */
export async function readSkillForViewer(args: {
  orgSlug: string;
  slug: string;
  viewer: SkillViewer;
}): Promise<SkillDocumentView | null> {
  assertValidSlug(args.slug);
  const skill = await loadVisibleSkill(args);
  if (skill === null) return null;
  const entries = await listSkillBundleFileEntries(args.orgSlug, args.slug);
  return {
    ...toSummary(skill, args.viewer),
    body: skill.body,
    files: (entries ?? []).map((entry) => ({
      path: entry.path,
      size: entry.size,
    })),
  };
}

export async function readSkillBundleForViewer(args: {
  orgSlug: string;
  slug: string;
  viewer: SkillViewer;
}): Promise<SkillBundleView | null> {
  assertValidSlug(args.slug);
  const skill = await loadVisibleSkill(args);
  if (skill === null) return null;
  const files = await readSkillBundleFiles(args.orgSlug, args.slug);
  if (files === null) return null;
  return {
    files: files.map((file) => ({
      path: file.path,
      contentBase64: file.contentBase64,
    })),
  };
}

export async function readSkillAssetForViewer(args: {
  orgSlug: string;
  slug: string;
  path: string;
  viewer: SkillViewer;
}): Promise<SkillBundleFileView | null> {
  assertValidSlug(args.slug);
  const skill = await loadVisibleSkill(args);
  if (skill === null) return null;
  return readSkillBundleAsset(args.orgSlug, args.slug, args.path);
}

/**
 * Create or update a skill bundle.
 *
 * A new bundle is an `org` skill unless the caller narrows it to `team`,
 * with its author recorded as owner for attribution. `private` is retired:
 * nothing can equip a private skill, so a save may keep one that already is
 * (the owner editing their pre-existing bundle) but never mint one. An edit
 * preserves the owner and every frontmatter field the edit surface does not
 * carry — licences, recommended packages, community keys — so saving a
 * community bundle from the UI does not strip it.
 *
 * An omitted optional field means "leave it as it is", so an edit that only
 * changes the body cannot blank the icon, the labels or the teams. Team ids
 * are not checked against the org's teams here: the library only offers real
 * ones, and an id that matches no team simply never matches a viewer either.
 */
export interface SkillEditInput {
  description: string;
  body: string;
  visibility?: SkillFrontmatter['visibility'];
  teams?: string[];
  icon?: string;
  labels?: string[];
}

export async function saveSkillForViewer(
  args: { orgSlug: string; slug: string; viewer: SkillViewer } & SkillEditInput,
): Promise<SkillDocumentView> {
  {
    assertValidSlug(args.slug);
    const viewer = assertUserViewer(args.viewer);
    const existing = await loadSkillOrThrow(args.orgSlug, args.slug);

    if (existing !== null && !canEditSkill(existing.meta, viewer)) {
      throw new AppError({
        code: 'SKILL_FORBIDDEN',
        message: `You cannot edit the skill "${args.slug}".`,
      });
    }

    const visibility = args.visibility ?? existing?.meta.visibility ?? 'org';
    if (visibility === 'private' && existing?.meta.visibility !== 'private') {
      throw new AppError({
        code: 'SKILL_PRIVATE_RETIRED',
        message: PRIVATE_SKILLS_RETIRED_MESSAGE,
      });
    }
    const teams = resolveTeams(visibility, args.teams, existing?.meta.teams);
    const owner =
      existing === null
        ? viewer.userId
        : (existing.meta.owner ??
          (visibility === 'private' ? viewer.userId : undefined));

    const meta: SkillFrontmatter = {
      ...(existing?.meta ?? { extra: {} }),
      name: args.slug,
      description: args.description,
      visibility,
      owner,
      icon: args.icon ?? existing?.meta.icon,
      labels: args.labels ?? existing?.meta.labels,
    };
    if (teams === undefined) {
      delete meta.teams;
    } else {
      meta.teams = teams;
    }

    const content = serializeSkillMd(meta, args.body);
    // Re-read what we are about to persist: a save must never be able to
    // write a document the readers would then reject.
    let verified;
    try {
      verified = parseSkillMd(
        content,
        resolveSkillMdPath(args.orgSlug, args.slug),
      );
    } catch (err) {
      if (err instanceof SkillParseError) {
        throw new AppError({
          code: 'INVALID_SKILL',
          message: `The skill could not be saved: ${err.detail}`,
        });
      }
      throw err;
    }
    await writeSkillMdText(args.orgSlug, args.slug, content);

    const entries = await listSkillBundleFileEntries(args.orgSlug, args.slug);
    return {
      ...toSummary(
        {
          slug: args.slug,
          path: relativeSkillPath(args.slug),
          meta: verified.meta,
          body: verified.body,
        },
        viewer,
      ),
      body: verified.body,
      files: (entries ?? []).map((entry) => ({
        path: entry.path,
        size: entry.size,
      })),
    };
  }
}

const PRIVATE_SKILLS_RETIRED_MESSAGE =
  'Private skills are retired — nothing can equip one. Share the skill with a team or the organization instead.';

/**
 * The bundle files as they will be persisted, with `SKILL.md` rewritten so
 * the file on disk says exactly what the readers will conclude — under the
 * SAME rules {@link saveSkillForViewer} applies, because an upload is a
 * second door into the same create-or-replace action:
 *
 * - a new bundle is attributed to its uploader; a replacement keeps the
 *   bundle's current owner (or, when nobody owned it, the uploader). A
 *   declared `owner` is never honored — the editor never lets a member pick
 *   one, so a zip cannot install a skill in someone else's name either;
 * - `private` is retired: a bundle may stay private only when the one it
 *   replaces already is (its owner re-uploading), never become it.
 *
 * `existing` is the bundle the upload replaces, or `null` for a new slug — a
 * slug whose current document is unreadable counts as new, since there is
 * nothing left to preserve. Sharing (`team`/`org` + `teams`) is honored as
 * declared: any member may share, and the parse step already refused the
 * inconsistent shapes. `SKILL.md` stays byte-for-byte when the zip already
 * says what the readers will conclude.
 */
export function normalizedBundleFiles(
  parsed: ParsedBundle,
  uploader: UserSkillViewer,
  existing: OrgSkill | null,
): Array<{ path: string; content: Buffer }> {
  if (
    parsed.meta.visibility === 'private' &&
    existing?.meta.visibility !== 'private'
  ) {
    throw new AppError({
      code: 'SKILL_PRIVATE_RETIRED',
      message: PRIVATE_SKILLS_RETIRED_MESSAGE,
    });
  }
  const owner =
    existing === null
      ? uploader.userId
      : (existing.meta.owner ?? uploader.userId);

  const files = parsed.files.map((file) => ({
    path: file.relPath,
    content: file.content,
  }));
  if (parsed.meta.owner === owner) return files;

  const meta: SkillFrontmatter = { ...parsed.meta, owner };
  const rewritten = serializeSkillMd(meta, parsed.body);
  return files.map((file) =>
    file.path === SKILL_DOCUMENT_NAME
      ? { path: file.path, content: Buffer.from(rewritten, 'utf-8') }
      : file,
  );
}

/**
 * Delete a skill bundle and its history. Deleting an absent one is a no-op.
 *
 * Deleting is the one operation that needs no readable document. A bundle
 * whose `SKILL.md` fails to parse — the library lists it as a failure — has
 * no owner or sharing left to consult, so removing it falls to an org admin;
 * without that, the failure row is a dead end only filesystem access can
 * clear. The same rule covers a bundle directory with no `SKILL.md` at all
 * (an upload that died mid-way): invisible to the library, yet present to
 * the upload lane's slug check.
 */
export async function deleteSkillForViewer(args: {
  orgSlug: string;
  slug: string;
  viewer: SkillViewer;
}): Promise<boolean> {
  assertValidSlug(args.slug);
  const viewer = assertUserViewer(args.viewer);
  let existing: OrgSkill | null;
  try {
    existing = await readOrgSkill(
      createOrgSkillReader(args.orgSlug),
      args.slug,
    );
  } catch (err) {
    if (!(err instanceof SkillParseError)) throw err;
    console.error(`[skills] ${args.orgSlug}: ${err.message}`);
    return removeUnreadableBundle(args.orgSlug, args.slug, viewer);
  }
  if (existing === null) {
    const entries = await listSkillBundleFileEntries(args.orgSlug, args.slug);
    if (entries === null) return false;
    return removeUnreadableBundle(args.orgSlug, args.slug, viewer);
  }
  if (!canEditSkill(existing.meta, viewer)) {
    throw new AppError({
      code: 'SKILL_FORBIDDEN',
      message: `You cannot delete the skill "${args.slug}".`,
    });
  }
  return removeSkillBundle(args.orgSlug, args.slug);
}

/** A bundle nobody can read is the org admin's to remove. */
function removeUnreadableBundle(
  orgSlug: string,
  slug: string,
  viewer: UserSkillViewer,
): Promise<boolean> {
  if (!viewer.isOrgAdmin) {
    throw new AppError({
      code: 'SKILL_FORBIDDEN',
      message: `Only an organization admin can delete the unreadable skill "${slug}".`,
    });
  }
  return removeSkillBundle(orgSlug, slug);
}
/**
 * The teams a saved skill ends up with. A `team` skill keeps or receives a
 * deduplicated, non-empty list; any other visibility strips it, so the file
 * never carries an inert one.
 */
function resolveTeams(
  visibility: SkillFrontmatter['visibility'],
  argTeams: string[] | undefined,
  existingTeams: readonly string[] | undefined,
): string[] | undefined {
  if (visibility !== 'team') return undefined;
  const source = argTeams ?? existingTeams;
  const teams = [
    ...new Set((source ?? []).map((teamId) => teamId.trim()).filter(Boolean)),
  ];
  if (teams.length === 0) {
    throw new AppError({
      code: 'INVALID_SKILL',
      message: 'A team skill needs at least one team to be shared with.',
    });
  }
  if (teams.length > MAX_SKILL_TEAMS) {
    throw new AppError({
      code: 'INVALID_SKILL',
      message: `A skill can be shared with at most ${MAX_SKILL_TEAMS} teams.`,
    });
  }
  return teams;
}

/**
 * Read one bundle and apply the visibility gate. `null` means "as far as
 * this viewer is concerned, there is no such skill".
 */
async function loadVisibleSkill(args: {
  orgSlug: string;
  slug: string;
  viewer: SkillViewer;
}): Promise<OrgSkill | null> {
  const skill = await loadSkillOrThrow(args.orgSlug, args.slug);
  if (skill === null) return null;
  if (!canViewSkill(skill.meta, args.viewer)) return null;
  return skill;
}

/**
 * Read one bundle, turning a malformed document into a AppError that names
 * the org-relative path. The caller sees which file to fix rather than a
 * bundle that silently is not there.
 */
async function loadSkillOrThrow(
  orgSlug: string,
  slug: string,
): Promise<OrgSkill | null> {
  try {
    return await readOrgSkill(createOrgSkillReader(orgSlug), slug);
  } catch (err) {
    if (err instanceof SkillParseError) {
      console.error(`[skills] ${orgSlug}: ${err.message}`);
      // The client gets the org-relative path; the absolute one stays in the
      // server log where the operator reads it.
      throw new AppError({
        code: 'SKILL_MALFORMED',
        message: `${relativeSkillPath(slug)} could not be read: ${err.detail}`,
      });
    }
    throw err;
  }
}
