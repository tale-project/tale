'use node';

/**
 * Stage org custom skills bound via `skillBindings` into the session's
 * user-level skill dir (adapter-declared `skillsStageDir`). Workflow
 * disciplines are staged separately (workflow_skills.ts) — this module handles
 * only slugs outside WORKFLOW_SKILL_NAMES. Best-effort; never fails a turn.
 */

import { getSkillsStageDir } from '../../../lib/agent-adapters/credential-policy';
import type { ProductAgentSlug } from '../../../lib/agent-adapters/events';
import { isRecord } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import { WORKFLOW_SKILL_NAMES } from '../../lib/skills/guidance';
import { selectStageableSkills } from '../../lib/skills/precedence';
import { validateSkillSlug } from '../../skills/file_utils';
import {
  type SessionStageFile,
  sessionDeleteFiles,
  sessionListFiles,
  sessionStageFiles,
} from './helpers/session_client';
import {
  BAKED_BUILTIN_SKILL_NAMES,
  INTEGRATION_SKILL_PREFIX,
  repoOwnedSkillNames,
} from './integration_skills';

const WORKFLOW_SET = new Set<string>(WORKFLOW_SKILL_NAMES);

interface SkillReadOk {
  ok: true;
  slug: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}

function isSkillReadOk(value: unknown): value is SkillReadOk {
  return isRecord(value) && value.ok === true && typeof value.body === 'string';
}

/** Slugs in skillBindings that are custom (not workflow auto-staged). */
export function customBoundSlugs(
  skillBindings: readonly string[] | undefined,
): string[] {
  if (!skillBindings?.length) return [];
  return skillBindings.filter(
    (s) => validateSkillSlug(s) && !WORKFLOW_SET.has(s),
  );
}

/** Pure prune decision for previously staged custom bound skill dirs. */
export function planBoundOrgSkillPrune(input: {
  stagedDirNames: ReadonlySet<string>;
  allowedCustomSlugs: ReadonlySet<string>;
}): string[] {
  const toPrune: string[] = [];
  for (const name of input.stagedDirNames) {
    if (name.startsWith(INTEGRATION_SKILL_PREFIX)) continue;
    if (WORKFLOW_SET.has(name)) continue;
    if (BAKED_BUILTIN_SKILL_NAMES.has(name)) continue;
    if (input.allowedCustomSlugs.has(name)) continue;
    // Custom bound dirs are plain slugs — anything else left from a prior bind.
    toPrune.push(name);
  }
  return toPrune;
}

/**
 * Stage bound org custom skills (full bundle) and prune stale custom dirs.
 * No-op when skillsStageDir is null or there are no custom slugs to stage
 * (prune still runs when allowlist shrinks).
 */
export async function stageBoundOrgSkills(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    skillBindings: readonly string[] | undefined;
    productKind: ProductAgentSlug;
    /** Thread's workspace-relative workdir — scopes the repo-skill scan. */
    workdirRel?: string;
  },
): Promise<void> {
  const skillsStageDir = getSkillsStageDir(args.productKind);
  if (!skillsStageDir) return;

  const customSlugs = customBoundSlugs(args.skillBindings);
  const allowedSet = new Set(customSlugs);

  try {
    const stagedEntries = await sessionListFiles(
      args.sessionId,
      skillsStageDir,
    );
    const stagedDirNames = new Set(
      (stagedEntries ?? []).filter((e) => e.type === 'dir').map((e) => e.name),
    );
    const toPrune = planBoundOrgSkillPrune({
      stagedDirNames,
      allowedCustomSlugs: allowedSet,
    });
    if (toPrune.length > 0) {
      await sessionDeleteFiles(
        args.sessionId,
        toPrune.map((name) => `${skillsStageDir}/${name}`),
      );
    }
  } catch (err) {
    console.warn('[stageBoundOrgSkills] prune listing failed:', err);
  }

  if (customSlugs.length === 0) return;

  const orgSlug = await orgSlugFromId(ctx, args.organizationId);
  const listed: string[] = await ctx.runAction(
    internal.skills.file_actions.listSkillsForExecution,
    { orgSlug },
  );
  const orgSlugs = new Set(Array.isArray(listed) ? listed : []);
  const candidates = customSlugs.filter((s) => orgSlugs.has(s));

  const repoOwned = await repoOwnedSkillNames(args.sessionId, args.workdirRel);
  const { kept } = selectStageableSkills(candidates, (slug) => slug, repoOwned);
  if (kept.length === 0) return;

  const files: SessionStageFile[] = [];
  for (const slug of kept) {
    try {
      const result = await ctx.runAction(
        internal.skills.file_actions.readSkillForExecution,
        { orgSlug, slug },
      );
      if (!isSkillReadOk(result)) continue;
      files.push({
        path: `${skillsStageDir}/${slug}/SKILL.md`,
        contentBase64: Buffer.from(result.body, 'utf8').toString('base64'),
      });
      for (const asset of result.files) {
        files.push({
          path: `${skillsStageDir}/${slug}/${asset.path}`,
          contentBase64: Buffer.from(asset.content, 'utf8').toString('base64'),
        });
      }
    } catch (err) {
      console.warn(`[stageBoundOrgSkills] reading ${slug} failed:`, err);
    }
  }

  if (files.length === 0) return;
  const result = await sessionStageFiles(args.sessionId, files);
  if (result.skipped.length > 0) {
    console.warn(
      '[stageBoundOrgSkills] some files were skipped:',
      result.skipped,
    );
  }
}
