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

/**
 * `private | org` at the wire boundary. The frontmatter schema's
 * `SKILL_VISIBILITIES` stays the source of truth for the set; the type
 * parameters here fail the build if a literal ever stops belonging to it.
 */
export const skillVisibilityValidator = v.union(
  v.literal<SkillVisibility>('private'),
  v.literal<SkillVisibility>('org'),
);

/** The fields every skill view carries. */
const skillSummaryFields = {
  slug: v.string(),
  description: v.string(),
  visibility: skillVisibilityValidator,
  owner: v.optional(v.string()),
  icon: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
  /** True when the model must not reach for the skill on its own. */
  disableModelInvocation: v.optional(v.boolean()),
  /** Whether the asking member may change this bundle. */
  canEdit: v.boolean(),
};

export const skillSummaryValidator = v.object(skillSummaryFields);

/** A skill with its markdown body — the knowledge an agent expands. */
export const skillDocumentValidator = v.object({
  ...skillSummaryFields,
  body: v.string(),
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

/** One bundle asset as the detail page's file tree lists it — no content. */
export const skillAssetValidator = v.object({
  path: v.string(),
  size: v.number(),
});

export const skillAssetListValidator = v.object({
  assets: v.array(skillAssetValidator),
  /** Size of `SKILL.md`, which the tree pins outside the asset list. */
  skillMdBytes: v.number(),
});

/**
 * One asset read for the viewer. Base64 rather than text because an asset may
 * be an image or other binary — the client decides how to render it. A read
 * refused by the per-file staging cap reports `too_large` instead of shipping
 * megabytes to a read-only preview.
 */
export const skillAssetReadValidator = v.union(
  v.object({ ok: v.literal(true), contentBase64: v.string() }),
  v.object({
    ok: v.literal(false),
    error: v.union(v.literal('not_found'), v.literal('too_large')),
  }),
);

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
   * `private` — a skill starts as its author's own, and sharing it is an
   * explicit edit to `org`.
   */
  visibility: v.optional(skillVisibilityValidator),
  icon: v.optional(v.string()),
  labels: v.optional(v.array(v.string())),
};

/** How the caller is identified to the file layer behind a public action. */
export const skillViewerArgs = {
  viewerUserId: v.string(),
  /** True when the member may administer the org's shared configuration. */
  isOrgAdmin: v.boolean(),
};

export interface SkillSummaryView {
  slug: string;
  description: string;
  visibility: SkillVisibility;
  owner?: string;
  icon?: string;
  labels?: string[];
  disableModelInvocation?: boolean;
  canEdit: boolean;
}

export interface SkillDocumentView extends SkillSummaryView {
  body: string;
}

export interface SkillBundleFileView {
  path: string;
  contentBase64: string;
}

export interface SkillBundleView {
  files: SkillBundleFileView[];
}

export interface SkillAssetView {
  path: string;
  size: number;
}

export interface SkillAssetListView {
  assets: SkillAssetView[];
  skillMdBytes: number;
}

export type SkillAssetReadView =
  | { ok: true; contentBase64: string }
  | { ok: false; error: 'not_found' | 'too_large' };

export interface SkillLoadFailureView {
  slug: string;
  path: string;
  message: string;
}

export interface SkillListingView {
  skills: SkillSummaryView[];
  failures: SkillLoadFailureView[];
}
