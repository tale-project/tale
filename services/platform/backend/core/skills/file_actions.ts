'use node';

import {
  type EntityTagList,
  ifMatchHolds,
  ifNoneMatchHolds,
  parseEntityTag,
} from '@tale/shared/http/entity-tag';
import {
  describeSkillSlugProblem,
  MAX_SKILL_TEAMS,
  type SkillFrontmatter,
} from '@tale/shared/schemas/skills';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  listOrgSkills,
  type OrgSkill,
  readOrgSkill,
  skillEntityTag,
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
  readSkillBundleAssetBytes,
  readSkillBundleFiles,
  removeSkillBundle,
  resolveSkillMdPath,
  SKILL_DOCUMENT_NAME,
  SkillBundleError,
  skillBundleDirExists,
  SKILLS_CONFIG_DOMAIN,
  writeSkillMdText,
  resolveSkillDir,
} from './file_utils';
import {
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
    etag: skill.etag,
    updatedAt: skill.updatedAt,
  };
}

function assertValidSlug(slug: string): void {
  const problem = describeSkillSlugProblem(slug);
  if (problem !== null) {
    throw new AppError({ code: 'INVALID_SKILL_SLUG', message: problem });
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
 * A bundle read that turns the file layer's refusals — a planted symlink,
 * a file over the staging cap, a walk past the file cap — into the
 * bundle's own coded refusal, `SKILL_MALFORMED`, naming the offending
 * entry org-relative. The absolute path stays in the server log where the
 * operator reads it; a client that could reach it would learn the server's
 * layout, and a client that got a 500 would page someone for a bundle
 * only its owner can fix.
 */
async function bundleRead<T>(
  orgSlug: string,
  slug: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof SkillBundleError)) throw err;
    console.error(`[skills] ${orgSlug}: ${err.message}`);
    const entry =
      err.relPath === ''
        ? `${SKILLS_CONFIG_DOMAIN}/${slug}`
        : `${SKILLS_CONFIG_DOMAIN}/${slug}/${err.relPath}`;
    throw new AppError({
      code: 'SKILL_MALFORMED',
      message: `${entry} could not be read: ${err.detail}`,
    });
  }
}

/**
 * The conditional-request preconditions a write carries (RFC 9110 §13.1.1
 * and §13.1.2), already parsed by the door and evaluated HERE — under the
 * caller's writer lock, against the document the write would replace — so
 * the check and the write are one critical section: two racing conditional
 * saves cannot both find the tag they were given still current.
 */
export interface SkillWritePrecondition {
  /**
   * `If-Match`: proceed only when the stored `SKILL.md` strongly matches
   * one of the tags — `*`, only when one is stored at all. A weak tag
   * never matches; a malformed value matches nothing.
   */
  ifMatch?: EntityTagList;
  /**
   * `If-None-Match`: proceed only when no stored `SKILL.md` weakly matches
   * any of the tags — `*`, only when nothing is stored (a pure create). A
   * malformed value matches nothing, so the write goes ahead.
   */
  ifNoneMatch?: EntityTagList;
}

/** What a precondition is evaluated against: whether the slug holds a
 * bundle at all, and the tag of its readable `SKILL.md` when it has one. */
interface CurrentSkillState {
  readonly exists: boolean;
  readonly etag: string | null;
}

/**
 * Evaluate a write's preconditions in the order §13.2.2 prescribes —
 * `If-Match` first, then `If-None-Match` — and refuse with 412 when one
 * fails, nothing written. Both refusals carry the current tag under
 * `data.etag` (`null` when nothing is stored) so a client can reload and
 * merge without a second round trip.
 */
function assertPrecondition(
  slug: string,
  precondition: SkillWritePrecondition | undefined,
  current: CurrentSkillState,
): void {
  if (precondition === undefined) return;
  const currentTag =
    current.etag === null ? null : parseEntityTag(current.etag);
  if (precondition.ifMatch !== undefined) {
    const holds =
      precondition.ifMatch.kind === 'any'
        ? current.exists
        : ifMatchHolds(precondition.ifMatch, currentTag);
    if (!holds) {
      throw new AppError({
        code: 'SKILL_STALE',
        message: current.exists
          ? `The skill "${slug}" changed since you read it — If-Match named no tag matching its current one; nothing was written.`
          : `The skill "${slug}" does not exist, so If-Match can match nothing; nothing was written.`,
        data: { etag: current.etag },
      });
    }
  }
  if (precondition.ifNoneMatch !== undefined) {
    const holds =
      precondition.ifNoneMatch.kind === 'any'
        ? !current.exists
        : ifNoneMatchHolds(precondition.ifNoneMatch, currentTag);
    if (!holds) {
      throw new AppError({
        code: 'SKILL_EXISTS',
        message:
          precondition.ifNoneMatch.kind === 'any'
            ? `The skill "${slug}" already exists.`
            : `The skill "${slug}" still carries a tag If-None-Match named; nothing was written.`,
        data: { etag: current.etag },
      });
    }
  }
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
      // The file layer names files by their absolute server path; the
      // sentence a caller reads names the bundle the way `path` does.
      message: failure.message
        .split(resolveSkillDir(args.orgSlug, failure.slug))
        .join(`skills/${failure.slug}`),
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
  const entries = await bundleRead(args.orgSlug, args.slug, () =>
    listSkillBundleFileEntries(args.orgSlug, args.slug),
  );
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
  const files = await bundleRead(args.orgSlug, args.slug, () =>
    readSkillBundleFiles(args.orgSlug, args.slug),
  );
  if (files === null) return null;
  return {
    files: files.map((file) => ({
      path: file.path,
      contentBase64: file.contentBase64,
    })),
  };
}

/**
 * The three answers a bundle-file read has, told apart because a door
 * answers each differently: no skill the viewer may see under the slug, a
 * skill without a file at that path (a path the walk would never produce
 * — a traversal, a dot-entry — reads the same way), or the file's bytes.
 */
export type SkillAssetRead =
  | { readonly kind: 'no-skill' }
  | { readonly kind: 'no-file' }
  | { readonly kind: 'asset'; readonly path: string; readonly content: Buffer };

export async function readSkillAssetForViewer(args: {
  orgSlug: string;
  slug: string;
  path: string;
  viewer: SkillViewer;
}): Promise<SkillAssetRead> {
  assertValidSlug(args.slug);
  const skill = await loadVisibleSkill(args);
  if (skill === null) return { kind: 'no-skill' };
  const asset = await bundleRead(args.orgSlug, args.slug, () =>
    readSkillBundleAssetBytes(args.orgSlug, args.slug, args.path),
  );
  if (asset === null) return { kind: 'no-file' };
  return { kind: 'asset', path: asset.path, content: asset.content };
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
 * community bundle from the UI does not strip it. Only `SKILL.md` is
 * written: every other file of the bundle stays as it is.
 *
 * An omitted optional field means "leave it as it is", so an edit that only
 * changes the body cannot blank the icon, the labels, the teams or the
 * model-invocation flag; `null` on `icon` or `labels` is the explicit clear,
 * and `disableModelInvocation: false` drops the flag from the file. Team
 * ids are not checked against the org's teams here: the library only
 * offers real ones, and an id that matches no team simply never matches a
 * viewer either.
 *
 * `precondition` carries the door's `If-Match` / `If-None-Match`, checked
 * here — under the caller's writer lock, after the permission gates and
 * before anything content-derived (RFC 9110 §13.2.1) — so two concurrent
 * conditional saves cannot both pass a read-then-write on the door.
 */
export interface SkillEditInput {
  description: string;
  body: string;
  visibility?: SkillFrontmatter['visibility'];
  teams?: string[];
  icon?: string | null;
  labels?: string[] | null;
  disableModelInvocation?: boolean;
}

export async function saveSkillForViewer(
  args: {
    orgSlug: string;
    slug: string;
    viewer: SkillViewer;
    precondition?: SkillWritePrecondition;
  } & SkillEditInput,
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
    assertPrecondition(args.slug, args.precondition, {
      exists: existing !== null,
      etag: existing?.etag ?? null,
    });

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
      icon: args.icon === null ? undefined : (args.icon ?? existing?.meta.icon),
      labels:
        args.labels === null
          ? undefined
          : (args.labels ?? existing?.meta.labels),
    };
    if (teams === undefined) {
      delete meta.teams;
    } else {
      meta.teams = teams;
    }
    // Omitted keeps whatever the file carries (the spread above); `true`
    // sets the flag; `false` drops the key rather than writing an inert
    // `disable-model-invocation: false`.
    if (args.disableModelInvocation === true) {
      meta.disableModelInvocation = true;
    } else if (args.disableModelInvocation === false) {
      delete meta.disableModelInvocation;
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
    const written = await bundleRead(args.orgSlug, args.slug, () =>
      writeSkillMdText(args.orgSlug, args.slug, content),
    );

    const entries = await bundleRead(args.orgSlug, args.slug, () =>
      listSkillBundleFileEntries(args.orgSlug, args.slug),
    );
    return {
      ...toSummary(
        {
          slug: args.slug,
          path: relativeSkillPath(args.slug),
          meta: verified.meta,
          body: verified.body,
          etag: skillEntityTag(written.hash),
          updatedAt: written.mtimeMs,
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
 * whose `SKILL.md` fails to parse — the library lists it as a failure — or
 * that the file layer refuses to read at all has no owner or sharing left
 * to consult, so removing it falls to an org admin; without that, the
 * failure row is a dead end only filesystem access can clear. The same
 * rule covers a bundle directory with no `SKILL.md` at all (an upload that
 * died mid-way): invisible to the library, yet present on disk.
 *
 * `precondition` is evaluated like the save's: after the permission gate,
 * against the readable document's tag — an unreadable bundle exists but
 * has no tag, so `If-Match: *` holds on it and a tag list never does. An
 * absent slug answers its no-op before any precondition is looked at
 * (RFC 9110 §13.2.1: the 404 the door answers takes precedence).
 */
export async function deleteSkillForViewer(args: {
  orgSlug: string;
  slug: string;
  viewer: SkillViewer;
  precondition?: SkillWritePrecondition;
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
    if (
      !(err instanceof SkillParseError) &&
      !(err instanceof SkillBundleError)
    ) {
      throw err;
    }
    console.error(`[skills] ${args.orgSlug}: ${err.message}`);
    return removeUnreadableBundle(
      args.orgSlug,
      args.slug,
      viewer,
      args.precondition,
    );
  }
  if (existing === null) {
    if (!(await skillBundleDirExists(args.orgSlug, args.slug))) return false;
    return removeUnreadableBundle(
      args.orgSlug,
      args.slug,
      viewer,
      args.precondition,
    );
  }
  if (!canEditSkill(existing.meta, viewer)) {
    throw new AppError({
      code: 'SKILL_FORBIDDEN',
      message: `You cannot delete the skill "${args.slug}".`,
    });
  }
  assertPrecondition(args.slug, args.precondition, {
    exists: true,
    etag: existing.etag,
  });
  return removeSkillBundle(args.orgSlug, args.slug);
}

/** A bundle nobody can read is the org admin's to remove. */
function removeUnreadableBundle(
  orgSlug: string,
  slug: string,
  viewer: UserSkillViewer,
  precondition: SkillWritePrecondition | undefined,
): Promise<boolean> {
  if (!viewer.isOrgAdmin) {
    throw new AppError({
      code: 'SKILL_FORBIDDEN',
      message: `Only an organization admin can delete the unreadable skill "${slug}".`,
    });
  }
  assertPrecondition(slug, precondition, { exists: true, etag: null });
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
 * Read one bundle, turning a malformed document — or one the file layer
 * refuses — into an AppError that names the org-relative path. The caller
 * sees which file to fix rather than a bundle that silently is not there.
 */
async function loadSkillOrThrow(
  orgSlug: string,
  slug: string,
): Promise<OrgSkill | null> {
  try {
    return await bundleRead(orgSlug, slug, () =>
      readOrgSkill(createOrgSkillReader(orgSlug), slug),
    );
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
