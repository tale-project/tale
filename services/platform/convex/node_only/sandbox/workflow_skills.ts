'use node';

/**
 * Stage the org's WORKFLOW skills (senior-dev disciplines seeded from
 * builtin-configs at org-create) into the session's user-level skill dir.
 * Staged per-turn; repo-owned skills win on name collision. Best-effort.
 */

import { readFile, readdir } from 'node:fs/promises';

import { getSkillsStageDir } from '../../../lib/agent-adapters/credential-policy';
import type { ProductAgentSlug } from '../../../lib/agent-adapters/events';
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
import { repoOwnedSkillNames } from './integration_skills';

export interface WorkflowSkillPlan {
  toStage: string[];
  toPrune: string[];
  available: Set<string>;
}

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

export function isTaleRepoWorkspace(
  entries: readonly SessionFsEntry[] | null,
): boolean {
  if (!entries) return false;
  const dirs = new Set(
    entries.filter((e) => e.type === 'dir').map((e) => e.name),
  );
  return dirs.has('.agents') && dirs.has('builtin-configs');
}

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

export async function stageWorkflowSkills(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    productKind: ProductAgentSlug;
  },
): Promise<Set<string>> {
  if (process.env.TALE_SANDBOX_WORKFLOW_SKILLS === '0') return new Set();

  const skillsStageDir = getSkillsStageDir(args.productKind);
  if (!skillsStageDir) return new Set();

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
      console.warn(
        `[stageWorkflowSkills] org skills dir unreadable (${skillsDir}); skipping:`,
        err,
      );
      return new Set();
    }
    const repoOwned = await repoOwnedSkillNames(args.sessionId);
    const stagedEntries = await sessionListFiles(
      args.sessionId,
      skillsStageDir,
    );
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
        plan.toPrune.map((name) => `${skillsStageDir}/${name}`),
      );
    }
    const available = plan.available;
    const files: SessionStageFile[] = [];
    for (const name of plan.toStage) {
      try {
        const content = await readFile(resolveSkillMdPath(orgSlug, name));
        files.push({
          path: `${skillsStageDir}/${name}/SKILL.md`,
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
        const name = skip.path.slice(skillsStageDir.length + 1).split('/')[0];
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
