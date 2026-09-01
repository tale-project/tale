/**
 * Wire shapes shared by the `skills` domain's routes and the file actions
 * behind them.
 *
 * Kept in its own module (no filesystem) so both layers import the same
 * shapes without either pulling the other's runtime in. Nothing here
 * describes an executable: a skill crosses the wire as metadata plus
 * markdown, which is all it ever is.
 */

import type { SkillVisibility } from '../../lib/shared/schemas/skills';

/** The fields every skill view carries. */
export interface SkillSummaryView {
  slug: string;
  description: string;
  /**
   * `private | team | org`. The frontmatter schema's `SKILL_VISIBILITIES`
   * stays the source of truth for the set. `private` is retired for new
   * skills but stays on the wire: pre-existing private bundles still list
   * and round-trip for their owner.
   */
  visibility: SkillVisibility;
  /** Team ids a `team` skill is shared with; absent otherwise. */
  teams?: string[];
  owner?: string;
  icon?: string;
  labels?: string[];
  /** True when the model must not reach for the skill on its own. */
  disableModelInvocation?: boolean;
  /** Whether the asking member may change this bundle. */
  canEdit: boolean;
}

/** One bundle file named without its bytes, for the detail file tree. */
export interface SkillFileEntryView {
  path: string;
  size: number;
}

/** A skill with its markdown body — the knowledge an agent expands. */
export interface SkillDocumentView extends SkillSummaryView {
  body: string;
  /** Every file of the bundle (including `SKILL.md`), sorted by path. */
  files: SkillFileEntryView[];
}

/**
 * One file of a bundle as staged into a sandbox session: its bundle-relative
 * POSIX path plus base64 bytes. `SKILL.md` travels verbatim alongside its
 * assets — the staged copy is the bundle exactly as the org's tree has it.
 */
export interface SkillBundleFileView {
  path: string;
  contentBase64: string;
}

export interface SkillBundleView {
  files: SkillBundleFileView[];
}

/**
 * A bundle that failed to load. `path` is relative to the org's config tree
 * so an operator can find the file without the server's absolute layout
 * being handed to a browser.
 */
export interface SkillLoadFailureView {
  slug: string;
  path: string;
  message: string;
}

export interface SkillListingView {
  skills: SkillSummaryView[];
  failures: SkillLoadFailureView[];
}
