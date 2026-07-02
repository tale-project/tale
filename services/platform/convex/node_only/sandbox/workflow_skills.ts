'use node';

/**
 * Stage the org's WORKFLOW skills (the generic senior-dev disciplines seeded
 * from builtin-configs at org-create) into the session's user-level skill dir,
 * so a sandbox Claude Code session can load the skills the system prompt's
 * guidance section names (lib/skills/guidance.ts). Staged per-turn like the
 * integration skills, so an org-level edit or delete is reflected next turn;
 * repo-owned skills win on a name collision (lib/skills/precedence.ts).
 * Best-effort throughout — staging must never fail a turn — and availability
 * is only claimed for skills PROVEN present (fail-safe: the guidance never
 * names a skill that did not land).
 */

import { readFile, readdir } from 'node:fs/promises';

import type { ActionCtx } from '../../_generated/server';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import { WORKFLOW_SKILL_NAMES } from '../../lib/skills/guidance';
import { selectStageableSkills } from '../../lib/skills/precedence';
import { resolveSkillMdPath, resolveSkillsDir } from '../../skills/file_utils';
import {
  type SessionFsEntry,
  type SessionStageFile,
  sessionDeleteFiles,
  sessionListFiles,
  sessionStageFiles,
} from './helpers/session_client';
import { repoOwnedSkillNames, SKILLS_DIR } from './integration_skills';

export interface WorkflowSkillPlan {
  /** Allowlisted skills to stage from the org dir (org ships them, repo doesn't). */
  toStage: string[];
  /** Previously staged workflow dirs to remove — the org deleted the skill or
   * the repo now shadows it. Only allowlist names, never integration-* /
   * browser-human-control / baked skills. */
  toPrune: string[];
  /** Skills the agent can actually load: staged ∪ (repo-owned ∩ allowlist). */
  available: Set<string>;
}

/** Pure stage/prune/availability decision, unit-tested without I/O. */
export function planWorkflowSkillStaging(input: {
  orgSkillsOnDisk: ReadonlySet<string>;
  repoOwned: ReadonlySet<string>;
  stagedDirNames: ReadonlySet<string>;
}): WorkflowSkillPlan {
  const candidates = WORKFLOW_SKILL_NAMES.filter((name) =>
    input.orgSkillsOnDisk.has(name),
  );
  const { kept } = selectStageableSkills(
    candidates,
    (name) => name,
    input.repoOwned,
  );
  const keptSet = new Set(kept);
  const toPrune = WORKFLOW_SKILL_NAMES.filter(
    (name) => input.stagedDirNames.has(name) && !keptSet.has(name),
  );
  const available = new Set(kept);
  for (const name of WORKFLOW_SKILL_NAMES) {
    if (input.repoOwned.has(name)) available.add(name);
  }
  return { toStage: kept, toPrune, available };
}

/**
 * Tale-monorepo marker: the workspace repo is this product's own monorepo,
 * whose AGENTS.md already carries the skill workflow — the generated guidance
 * section is skipped there. The `.agents` + `builtin-configs` dir conjunction
 * is unique to the Tale layout (a deliberate fork skips equally correctly).
 */
export function isTaleRepoWorkspace(
  entries: readonly SessionFsEntry[] | null,
): boolean {
  if (!entries) return false;
  const dirs = new Set(
    entries.filter((e) => e.type === 'dir').map((e) => e.name),
  );
  return dirs.has('.agents') && dirs.has('builtin-configs');
}

/** Best-effort I/O wrapper around {@link isTaleRepoWorkspace}: one workspace
 * listing; false on any failure — the product workspace is the normal case,
 * so on doubt the guidance shows. */
export async function workspaceIsTaleRepo(sessionId: string): Promise<boolean> {
  try {
    return isTaleRepoWorkspace(await sessionListFiles(sessionId, 'workspace'));
  } catch (err) {
    console.warn(
      '[workflow-skills] workspace listing failed (assuming product workspace):',
      err,
    );
    return false;
  }
}

/**
 * Stage the org's workflow skills into the session and return the names the
 * agent can actually load this turn (staged-and-not-skipped ∪ repo-owned).
 * Returns an empty set on failure or under the TALE_SANDBOX_WORKFLOW_SKILLS=0
 * kill-switch — callers then render no guidance rather than a wrong one.
 */
export async function stageWorkflowSkills(
  ctx: ActionCtx,
  args: { organizationId: string; sessionId: string },
): Promise<Set<string>> {
  if (process.env.TALE_SANDBOX_WORKFLOW_SKILLS === '0') return new Set();
  try {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const skillsDir = resolveSkillsDir(orgSlug);
    let orgSkillsOnDisk: Set<string>;
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      orgSkillsOnDisk = new Set(
        entries.filter((e) => e.isDirectory()).map((e) => e.name),
      );
    } catch (err) {
      // Unreadable org dir (never seeded, or a transient fs error): claim
      // nothing and prune nothing — don't tear down staged skills on a blip.
      console.warn(
        `[stageWorkflowSkills] org skills dir unreadable (${skillsDir}); skipping:`,
        err,
      );
      return new Set();
    }
    const repoOwned = await repoOwnedSkillNames(args.sessionId);
    const stagedEntries = await sessionListFiles(args.sessionId, SKILLS_DIR);
    const stagedDirNames = new Set(
      (stagedEntries ?? []).filter((e) => e.type === 'dir').map((e) => e.name),
    );
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk,
      repoOwned,
      stagedDirNames,
    });
    if (plan.toPrune.length > 0) {
      await sessionDeleteFiles(
        args.sessionId,
        plan.toPrune.map((name) => `${SKILLS_DIR}/${name}`),
      );
    }
    const available = plan.available;
    const files: SessionStageFile[] = [];
    for (const name of plan.toStage) {
      try {
        const content = await readFile(resolveSkillMdPath(orgSlug, name));
        files.push({
          path: `${SKILLS_DIR}/${name}/SKILL.md`,
          contentBase64: content.toString('base64'),
        });
      } catch (err) {
        available.delete(name);
        console.warn(
          `[stageWorkflowSkills] reading ${name} failed (dropping):`,
          err,
        );
      }
    }
    if (files.length > 0) {
      const result = await sessionStageFiles(args.sessionId, files);
      for (const skip of result.skipped) {
        // path is `${SKILLS_DIR}/<name>/SKILL.md` — never claim a skill that
        // failed to land.
        const name = skip.path.slice(SKILLS_DIR.length + 1).split('/')[0];
        if (name) available.delete(name);
        console.warn('[stageWorkflowSkills] staging skipped:', skip);
      }
    }
    return available;
  } catch (err) {
    console.warn(
      '[stageWorkflowSkills] failed (continuing without workflow skills):',
      err,
    );
    return new Set();
  }
}
