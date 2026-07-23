'use node';

/**
 * Internal `'use node'` handlers for reading and editing an organization's
 * skills. The public `actions.ts` authenticates the caller, resolves the org
 * slug from a verified membership, and delegates here — a separate module so
 * the generated api types keep their shapes instead of collapsing to `any`,
 * which is also why every handler carries an explicit return annotation.
 *
 * The visibility rule is applied HERE, at the filesystem edge: a bundle the
 * asking member may not see never leaves this layer, so no caller can leak
 * one by forgetting to filter. The org slug arrives already verified; every
 * path is then resolved from it alone, which is what keeps one org's library
 * out of another's.
 */

import { ConvexError, v } from 'convex/values';

import {
  isValidSkillSlug,
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
} from '../../lib/skills/visibility';
import { internalAction } from '../_generated/server';
import {
  createOrgSkillReader,
  removeSkillBundle,
  resolveSkillMdPath,
  SKILL_DOCUMENT_NAME,
  SKILLS_CONFIG_DOMAIN,
  writeSkillMdText,
} from './file_utils';
import {
  skillDocumentValidator,
  skillEditArgs,
  skillListingValidator,
  skillViewerArgs,
  type SkillDocumentView,
  type SkillListingView,
  type SkillSummaryView,
} from './validators';

/** `skills/<slug>/SKILL.md` — the path an operator sees, org-tree relative. */
function relativeSkillPath(slug: string): string {
  return `${SKILLS_CONFIG_DOMAIN}/${slug}/${SKILL_DOCUMENT_NAME}`;
}

function viewerFrom(args: {
  viewerUserId: string;
  isOrgAdmin: boolean;
}): SkillViewer {
  return { userId: args.viewerUserId, isOrgAdmin: args.isOrgAdmin };
}

function toSummary(skill: OrgSkill, viewer: SkillViewer): SkillSummaryView {
  const { meta } = skill;
  return {
    slug: skill.slug,
    description: meta.description,
    visibility: meta.visibility,
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
 * The skills the asking member can see in this org, plus any bundle that
 * failed to load. Failures are logged with their absolute path (the operator
 * signal) and returned with the org-relative one.
 */
export const listSkills = internalAction({
  args: { orgSlug: v.string(), ...skillViewerArgs },
  returns: skillListingValidator,
  handler: async (_ctx, args): Promise<SkillListingView> => {
    const viewer = viewerFrom(args);
    const listing = await listOrgSkills(
      createOrgSkillReader(args.orgSlug),
      viewer,
    );
    for (const failure of listing.failures) {
      console.error(
        `[skills] ${args.orgSlug}: skipping unreadable skill — ${failure.message}`,
      );
    }
    return {
      skills: listing.skills.map((skill) => toSummary(skill, viewer)),
      failures: listing.failures.map((failure) => ({
        slug: failure.slug,
        path: relativeSkillPath(failure.slug),
        message: failure.message,
      })),
    };
  },
});

/**
 * One skill with its body, or `null` when the org has no such bundle. A
 * bundle the member may not see reads as absent — telling them it exists
 * would already leak someone else's private skill.
 */
export const readSkill = internalAction({
  args: { orgSlug: v.string(), slug: v.string(), ...skillViewerArgs },
  returns: v.union(v.null(), skillDocumentValidator),
  handler: async (_ctx, args): Promise<SkillDocumentView | null> => {
    assertValidSlug(args.slug);
    const viewer = viewerFrom(args);
    const skill = await loadSkillOrThrow(args.orgSlug, args.slug);
    if (skill === null || !canViewSkill(skill.meta, viewer)) return null;
    return { ...toSummary(skill, viewer), body: skill.body };
  },
});

/**
 * Create or update a skill bundle.
 *
 * A new bundle belongs to its author and is `private` unless the caller says
 * otherwise. An edit preserves the owner and every frontmatter field the edit
 * surface does not carry — licences, recommended packages, community keys —
 * so saving a community bundle from the UI does not strip it. Turning a
 * shared skill back into a private one with no recorded owner adopts the
 * editor, because a private skill without an owner is readable by nobody.
 *
 * An omitted optional field means "leave it as it is", so an edit that only
 * changes the body cannot blank the icon or the labels.
 */
export const saveSkill = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    ...skillViewerArgs,
    ...skillEditArgs,
  },
  returns: skillDocumentValidator,
  handler: async (_ctx, args): Promise<SkillDocumentView> => {
    assertValidSlug(args.slug);
    const viewer = viewerFrom(args);
    const existing = await loadSkillOrThrow(args.orgSlug, args.slug);

    if (existing !== null && !canEditSkill(existing.meta, viewer)) {
      throw new ConvexError({
        code: 'SKILL_FORBIDDEN',
        message: `You cannot edit the skill "${args.slug}".`,
      });
    }

    const visibility =
      args.visibility ?? existing?.meta.visibility ?? 'private';
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
    };
  },
});

/** Delete a skill bundle and its history. Deleting an absent one is a no-op. */
export const deleteSkill = internalAction({
  args: { orgSlug: v.string(), slug: v.string(), ...skillViewerArgs },
  returns: v.boolean(),
  handler: async (_ctx, args): Promise<boolean> => {
    assertValidSlug(args.slug);
    const viewer = viewerFrom(args);
    const existing = await loadSkillOrThrow(args.orgSlug, args.slug);
    if (existing === null) return false;
    if (!canEditSkill(existing.meta, viewer)) {
      throw new ConvexError({
        code: 'SKILL_FORBIDDEN',
        message: `You cannot delete the skill "${args.slug}".`,
      });
    }
    return removeSkillBundle(args.orgSlug, args.slug);
  },
});

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
