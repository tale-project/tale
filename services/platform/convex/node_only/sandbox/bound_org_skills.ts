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

/**
 * Slugs in skillBindings that are custom (not workflow auto-staged). Baked
 * builtin names are excluded like the prune side below: the image-baked copy
 * (deps installed) already owns `${skillsStageDir}/<name>`, and staging a
 * same-named org skill over it would clobber the only runnable copy.
 */
export function customBoundSlugs(
  skillBindings: readonly string[] | undefined,
): string[] {
  if (!skillBindings?.length) return [];
  return skillBindings.filter(
    (s) =>
      validateSkillSlug(s) &&
      !WORKFLOW_SET.has(s) &&
      !BAKED_BUILTIN_SKILL_NAMES.has(s),
  );
}

// Asset extensions that cannot survive the UTF-8 `readFileSafe` read used by
// `readSkillForExecution` — staging them ships corrupt bytes, so they are
// skipped up front (and they are dead weight for an agent anyway).
const BINARY_ASSET_EXT_RE =
  /\.(png|jpe?g|gif|webp|pdf|zip|woff2?|ttf|otf|pyc)$/i;

/**
 * Should this skill-bundle asset be staged into an AGENT session? Pure —
 * exported for unit tests. Drops test suites (`tests/` at any depth),
 * `__pycache__`, and binary assets: agents need the runnable skill (code,
 * mappings, schemas, docs), not its test fixtures, and the binary formats
 * are already broken by the UTF-8 read (see BINARY_ASSET_EXT_RE). Script
 * steps' `useSkills` staging is separate and unaffected (stage_skills.ts
 * include lists).
 */
export function shouldStageBoundSkillAsset(relPath: string): boolean {
  const segments = relPath.split('/');
  if (segments.some((s) => s === 'tests' || s === '__pycache__')) return false;
  return !BINARY_ASSET_EXT_RE.test(relPath);
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

  // One stage call PER SKILL, each inside its own try/catch: a fat or broken
  // skill must not take down its siblings (the old all-slugs-in-one-POST shape
  // 413'd the whole set once the combined base64 outgrew the spawner body
  // cap). sessionStageFiles chunks each skill's payload under the HTTP budget.
  for (const slug of kept) {
    try {
      const result = await ctx.runAction(
        internal.skills.file_actions.readSkillForExecution,
        { orgSlug, slug },
      );
      if (!isSkillReadOk(result)) continue;
      const files: SessionStageFile[] = [
        {
          path: `${skillsStageDir}/${slug}/SKILL.md`,
          contentBase64: Buffer.from(result.body, 'utf8').toString('base64'),
        },
      ];
      for (const asset of result.files) {
        if (!shouldStageBoundSkillAsset(asset.path)) continue;
        files.push({
          path: `${skillsStageDir}/${slug}/${asset.path}`,
          contentBase64: Buffer.from(asset.content, 'utf8').toString('base64'),
        });
      }
      const staged = await sessionStageFiles(args.sessionId, files);
      if (staged.skipped.length > 0) {
        console.warn(
          `[stageBoundOrgSkills] ${slug}: some files were skipped:`,
          staged.skipped,
        );
      }
    } catch (err) {
      console.warn(`[stageBoundOrgSkills] staging ${slug} failed:`, err);
    }
  }
}
