'use node';

/**
 * Internal `'use node'` handlers for reading and editing an organization's
 * skills. The public `actions.ts` authenticates the caller, resolves the org
 * slug from a verified membership, and delegates here — a separate module so
 * the generated api types keep their shapes instead of collapsing to `any`,
 * which is also why every handler carries an explicit return annotation.
 *
 * The visibility rule is applied HERE, at the filesystem edge: a bundle the
 * asking viewer may not see never leaves this layer, so no caller can leak
 * one by forgetting to filter. The viewer is the full discriminated identity
 * (member, project, or org machinery — see `lib/skills/visibility.ts`). The
 * org slug arrives already verified; every path is then resolved from it
 * alone, which is what keeps one org's library out of another's.
 */

import { ConvexError, v } from 'convex/values';

import {
  isValidSkillSlug,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
  MAX_SKILL_TEAMS,
  type SkillFrontmatter,
} from '../../lib/shared/schemas/skills';
import {
  listOrgSkills,
  readOrgSkill,
  type OrgSkill,
} from '../../lib/skills/listing';
import {
  parseSkillMd,
  serializeSkillMd,
  SkillParseError,
} from '../../lib/skills/parse';
import {
  canEditSkill,
  canViewSkill,
  type SkillViewer,
  type UserSkillViewer,
} from '../../lib/skills/visibility';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { parseSkillBundleZip, type ParsedBundle } from './bundle_zip';
import {
  createOrgSkillReader,
  listSkillBundleFileEntries,
  readSkillBundleAsset,
  readSkillBundleFiles,
  removeSkillBundle,
  resolveSkillMdPath,
  SKILL_DOCUMENT_NAME,
  SKILLS_CONFIG_DOMAIN,
  writeSkillBundleFiles,
  writeSkillMdText,
} from './file_utils';
import {
  skillBundleFileValidator,
  skillBundleValidator,
  skillDocumentValidator,
  skillEditArgs,
  skillListingValidator,
  skillViewerValidator,
  type SkillBundleFileView,
  type SkillBundleView,
  type SkillDocumentView,
  type SkillListingView,
  type SkillSummaryView,
} from './validators';

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
    throw new ConvexError({
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
    throw new ConvexError({
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

export const listSkills = internalAction({
  args: {
    orgSlug: v.string(),
    viewer: skillViewerValidator,
  },
  returns: skillListingValidator,
  handler: async (_ctx, args): Promise<SkillListingView> =>
    listSkillsForViewer(args),
});

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

export const readSkill = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    viewer: skillViewerValidator,
  },
  returns: v.union(v.null(), skillDocumentValidator),
  handler: async (_ctx, args): Promise<SkillDocumentView | null> =>
    readSkillForViewer(args),
});

/**
 * Every file of one bundle, for staging into a sandbox session. Visibility
 * follows {@link readSkill}: a bundle the viewer may not equip reads as
 * absent. The `SKILL.md` gate runs first — a bundle whose document is
 * malformed throws the operator-facing error instead of staging a skill no
 * listing would admit to having.
 */
export const readSkillBundle = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    viewer: skillViewerValidator,
  },
  returns: v.union(v.null(), skillBundleValidator),
  handler: async (_ctx, args): Promise<SkillBundleView | null> =>
    readSkillBundleForViewer(args),
});

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

/**
 * One named file of one bundle, for the library's asset viewer. Gated
 * exactly like {@link readSkill}; a path the bundle walk would never produce
 * reads as absent.
 */
export const readSkillAsset = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    path: v.string(),
    viewer: skillViewerValidator,
  },
  returns: v.union(v.null(), skillBundleFileValidator),
  handler: async (_ctx, args): Promise<SkillBundleFileView | null> =>
    readSkillAssetForViewer(args),
});

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
      throw new ConvexError({
        code: 'SKILL_FORBIDDEN',
        message: `You cannot edit the skill "${args.slug}".`,
      });
    }

    const visibility = args.visibility ?? existing?.meta.visibility ?? 'org';
    if (visibility === 'private' && existing?.meta.visibility !== 'private') {
      throw new ConvexError({
        code: 'SKILL_PRIVATE_RETIRED',
        message:
          'Private skills are retired — nothing can equip one. Share the skill with a team or the organization instead.',
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
        throw new ConvexError({
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

export const saveSkill = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    viewer: skillViewerValidator,
    ...skillEditArgs,
  },
  returns: skillDocumentValidator,
  handler: async (_ctx, args): Promise<SkillDocumentView> =>
    saveSkillForViewer(args),
});

/**
 * Tear down both the staged `_storage` blob and its `skillUploadIntents`
 * row in one place so every exit path of `uploadSkillBundle` (early
 * reject, needs_confirm, parse failure, write failure, success-finally)
 * leaves no orphan resources. Failures here only log — the user-visible
 * operation has already succeeded or failed independently.
 */
async function cleanupUploadResources(
  ctx: ActionCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  await ctx.storage.delete(storageId).catch((err) => {
    console.warn('[uploadSkillBundle] storage.delete failed:', err);
  });
  await ctx
    .runMutation(internal.skills.upload_mutations.deleteSkillUploadIntent, {
      storageId,
    })
    .catch((err) => {
      console.warn('[uploadSkillBundle] deleteSkillUploadIntent failed:', err);
    });
}

/**
 * The bundle files as they will be persisted. An unmarked upload lands as an
 * `org` skill (the parse default) with the uploader adopted as owner for
 * attribution — by rewriting the `SKILL.md` about to be written, so the file
 * on disk always says what the readers will conclude. A bundle that declares
 * its sharing is honored verbatim (any member may share, and the parse step
 * already refused the inconsistent shapes).
 */
export function normalizedBundleFiles(
  parsed: ParsedBundle,
  uploader: UserSkillViewer,
): Array<{ path: string; content: Buffer }> {
  const files = parsed.files.map((file) => ({
    path: file.relPath,
    content: file.content,
  }));
  if (parsed.meta.owner !== undefined) return files;

  const meta: SkillFrontmatter = { ...parsed.meta, owner: uploader.userId };
  const rewritten = serializeSkillMd(meta, parsed.body);
  return files.map((file) =>
    file.path === SKILL_DOCUMENT_NAME
      ? { path: file.path, content: Buffer.from(rewritten, 'utf-8') }
      : file,
  );
}

/**
 * Persist an uploaded bundle zip: verify the blob's org binding, decode and
 * re-validate it, gate a replacement behind `force` + edit rights, and swap
 * it onto disk under the per-(org, slug) claim lock. Every exit path
 * releases the staged blob and its intent row.
 */
export const uploadSkillBundle = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    viewer: skillViewerValidator,
    storageId: v.id('_storage'),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), slug: v.string() }),
    v.object({
      ok: v.literal(false),
      status: v.literal('needs_confirm'),
      slug: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; slug: string }
    | { ok: false; status: 'needs_confirm'; slug: string }
  > => {
    const viewer = assertUserViewer(args.viewer);

    // Ownership gate: refuse before reading the blob if the storageId isn't
    // bound to this org via `recordSkillUploadIntent`. Without this an
    // authenticated caller could point the server at any other org's
    // pending storageId.
    const intentMatch = await ctx.runMutation(
      internal.skills.upload_mutations.verifySkillUploadIntent,
      { organizationId: args.organizationId, storageId: args.storageId },
    );
    if (!intentMatch) {
      throw new ConvexError({
        code: 'STORAGE_NOT_OWNED',
        message:
          'Upload session is missing or belongs to a different organization. Re-open the upload dialog and try again.',
      });
    }

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      await ctx.runMutation(
        internal.skills.upload_mutations.deleteSkillUploadIntent,
        { storageId: args.storageId },
      );
      throw new ConvexError({
        code: 'STORAGE_NOT_FOUND',
        message: 'Uploaded bundle is missing from storage',
      });
    }
    if (blob.size > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      await cleanupUploadResources(ctx, args.storageId);
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }

    let parsed: ParsedBundle;
    try {
      const buf = Buffer.from(await blob.arrayBuffer());
      parsed = await parseSkillBundleZip(buf);
    } catch (err) {
      await cleanupUploadResources(ctx, args.storageId);
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message:
          err instanceof Error ? err.message : 'Failed to read uploaded zip',
      });
    }

    // What the slug currently holds. A directory without a readable
    // SKILL.md still counts as existing — replacing it is a repair, but a
    // repair of SHARED configuration, so it answers to an administrator.
    let existing: OrgSkill | null = null;
    let existingUnreadable = false;
    try {
      existing = await readOrgSkill(
        createOrgSkillReader(args.orgSlug),
        parsed.slug,
      );
    } catch (err) {
      if (err instanceof SkillParseError) {
        existingUnreadable = true;
      } else {
        await cleanupUploadResources(ctx, args.storageId);
        throw err;
      }
    }
    const entries = await listSkillBundleFileEntries(args.orgSlug, parsed.slug);
    const bundleExists =
      existing !== null || existingUnreadable || entries !== null;

    if (bundleExists && args.force !== true) {
      // Caller hasn't confirmed the replace; clean up the staged blob +
      // intent so nothing leaks. The client re-uploads with force: true,
      // generating a fresh storageId and intent.
      await cleanupUploadResources(ctx, args.storageId);
      return { ok: false, status: 'needs_confirm', slug: parsed.slug };
    }
    if (bundleExists) {
      const allowed =
        existing !== null
          ? canEditSkill(existing.meta, viewer)
          : viewer.isOrgAdmin;
      if (!allowed) {
        await cleanupUploadResources(ctx, args.storageId);
        throw new ConvexError({
          code: 'SKILL_FORBIDDEN',
          message: `You cannot replace the skill "${parsed.slug}".`,
        });
      }
    }

    // `private` is retired: an upload may keep a pre-existing private bundle
    // private (its owner re-importing their own), but never mint one.
    if (
      parsed.meta.visibility === 'private' &&
      existing?.meta.visibility !== 'private'
    ) {
      await cleanupUploadResources(ctx, args.storageId);
      throw new ConvexError({
        code: 'SKILL_PRIVATE_RETIRED',
        message:
          'Private skills are retired — nothing can equip one. Remove `visibility: private` from SKILL.md or declare `team` or `org` sharing.',
      });
    }

    // Per-(orgId, slug) exclusion lock. Acquired AFTER parse + existence
    // check (so unparseable bundles never block the slot) and BEFORE the
    // rename swap. Released in `finally`. A second concurrent upload to the
    // same slug sees `LOCK_HELD` and fails fast.
    await ctx.runMutation(
      internal.skills.upload_mutations.claimSkillUploadSlot,
      { organizationId: args.organizationId, slug: parsed.slug },
    );

    try {
      await writeSkillBundleFiles(
        args.orgSlug,
        parsed.slug,
        normalizedBundleFiles(parsed, viewer),
      );
    } catch (err) {
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: 'WRITE_FAILED',
        message:
          err instanceof Error ? err.message : 'Failed to write skill bundle',
      });
    } finally {
      await cleanupUploadResources(ctx, args.storageId);
      await ctx
        .runMutation(internal.skills.upload_mutations.releaseSkillUploadSlot, {
          organizationId: args.organizationId,
          slug: parsed.slug,
        })
        .catch((err) => {
          console.warn('[uploadSkillBundle] release slot failed:', err);
        });
    }

    return { ok: true, slug: parsed.slug };
  },
});

/** Delete a skill bundle and its history. Deleting an absent one is a no-op. */
export async function deleteSkillForViewer(args: {
  orgSlug: string;
  slug: string;
  viewer: SkillViewer;
}): Promise<boolean> {
  assertValidSlug(args.slug);
  const viewer = assertUserViewer(args.viewer);
  const existing = await loadSkillOrThrow(args.orgSlug, args.slug);
  if (existing === null) return false;
  if (!canEditSkill(existing.meta, viewer)) {
    throw new ConvexError({
      code: 'SKILL_FORBIDDEN',
      message: `You cannot delete the skill "${args.slug}".`,
    });
  }
  return removeSkillBundle(args.orgSlug, args.slug);
}

export const deleteSkill = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    viewer: skillViewerValidator,
  },
  returns: v.boolean(),
  handler: async (_ctx, args): Promise<boolean> => deleteSkillForViewer(args),
});

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
    throw new ConvexError({
      code: 'INVALID_SKILL',
      message: 'A team skill needs at least one team to be shared with.',
    });
  }
  if (teams.length > MAX_SKILL_TEAMS) {
    throw new ConvexError({
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
 * Read one bundle, turning a malformed document into a ConvexError that names
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
      throw new ConvexError({
        code: 'SKILL_MALFORMED',
        message: `${relativeSkillPath(slug)} could not be read: ${err.detail}`,
      });
    }
    throw err;
  }
}
