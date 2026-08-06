/**
 * Wire shapes shared by the `skills` domain's public actions and the
 * `'use node'` file actions behind them.
 *
 * Kept in its own module (no `'use node'`, no filesystem) so both layers
 * import the same validators without either pulling the other's runtime in.
 * Nothing here describes an executable: a skill crosses the wire as metadata
 * plus markdown, which is all it ever is.
 */

import { v } from 'convex/values';

import type { SkillVisibility } from '../../lib/shared/schemas/skills';
import type { SkillViewer } from '../../lib/skills/visibility';

/**
 * `private | team | org` at the wire boundary. The frontmatter schema's
 * `SKILL_VISIBILITIES` stays the source of truth for the set; the type
 * parameters here fail the build if a literal ever stops belonging to it.
 * `private` is retired for new skills but stays on the wire: pre-existing
 * private bundles still list and round-trip for their owner.
 */
export const skillVisibilityValidator = v.union(
  v.literal<SkillVisibility>('private'),
  v.literal<SkillVisibility>('team'),
  v.literal<SkillVisibility>('org'),
);

/** The fields every skill view carries. */
const skillSummaryFields = {
  slug: v.string(),
  description: v.string(),
  visibility: skillVisibilityValidator,
  /** Team ids a `team` skill is shared with; absent otherwise. */
  teams: v.optional(v.array(v.string())),
  owner: v.optional(v.string()),
  icon: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
  /** True when the model must not reach for the skill on its own. */
  disableModelInvocation: v.optional(v.boolean()),
  /** Whether the asking member may change this bundle. */
  canEdit: v.boolean(),
};

export const skillSummaryValidator = v.object(skillSummaryFields);

/** One bundle file named without its bytes, for the detail file tree. */
export const skillFileEntryValidator = v.object({
  path: v.string(),
  size: v.number(),
});

/** A skill with its markdown body — the knowledge an agent expands. */
export const skillDocumentValidator = v.object({
  ...skillSummaryFields,
  body: v.string(),
  /** Every file of the bundle (including `SKILL.md`), sorted by path. */
  files: v.array(skillFileEntryValidator),
});

/**
 * One file of a bundle as staged into a sandbox session: its bundle-relative
 * POSIX path plus base64 bytes. `SKILL.md` travels verbatim alongside its
 * assets — the staged copy is the bundle exactly as the org's tree has it.
 */
export const skillBundleFileValidator = v.object({
  path: v.string(),
  contentBase64: v.string(),
});

export const skillBundleValidator = v.object({
  files: v.array(skillBundleFileValidator),
});

/**
 * A bundle that failed to load. `path` is relative to the org's config tree
 * so an operator can find the file without the server's absolute layout
 * being handed to a browser.
 */
export const skillLoadFailureValidator = v.object({
  slug: v.string(),
  path: v.string(),
  message: v.string(),
});

export const skillListingValidator = v.object({
  skills: v.array(skillSummaryValidator),
  failures: v.array(skillLoadFailureValidator),
});

/** Editable fields of a skill. Everything else in the file round-trips. */
export const skillEditArgs = {
  description: v.string(),
  body: v.string(),
  /**
   * Absent keeps an existing skill's current visibility and makes a new one
   * `org`. `private` is retired: the save handler refuses it unless the
   * skill already carries it (an owner editing a pre-existing private
   * bundle keeps it as it is).
   */
  visibility: v.optional(skillVisibilityValidator),
  /**
   * Team ids for a `team` skill. Absent keeps an existing skill's teams;
   * the save handler rejects a `team` skill that would end up with none and
   * strips the list when visibility resolves to anything else.
   */
  teams: v.optional(v.array(v.string())),
  icon: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
};

/**
 * The identity a skill is read for, mirroring `lib/skills/visibility.ts`'s
 * `SkillViewer`: a member (their own teams + admin bit), a project (its
 * teams), or org-level machinery. The type parameters fail the build if the
 * wire shape drifts from the pure predicate's.
 */
export const skillViewerValidator = v.union(
  v.object({
    kind: v.literal<SkillViewer['kind'] & 'user'>('user'),
    userId: v.string(),
    teamIds: v.array(v.string()),
    isOrgAdmin: v.boolean(),
  }),
  v.object({
    kind: v.literal<SkillViewer['kind'] & 'project'>('project'),
    teamIds: v.array(v.string()),
  }),
  v.object({
    kind: v.literal<SkillViewer['kind'] & 'org'>('org'),
  }),
);

export interface SkillSummaryView {
  slug: string;
  description: string;
  visibility: SkillVisibility;
  teams?: string[];
  owner?: string;
  icon?: string;
  labels?: string[];
  disableModelInvocation?: boolean;
  canEdit: boolean;
}

export interface SkillFileEntryView {
  path: string;
  size: number;
}

export interface SkillDocumentView extends SkillSummaryView {
  body: string;
  files: SkillFileEntryView[];
}

export interface SkillBundleFileView {
  path: string;
  contentBase64: string;
}

export interface SkillBundleView {
  files: SkillBundleFileView[];
}

export interface SkillLoadFailureView {
  slug: string;
  path: string;
  message: string;
}

export interface SkillListingView {
  skills: SkillSummaryView[];
  failures: SkillLoadFailureView[];
}
