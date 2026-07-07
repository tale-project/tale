'use node';

/**
 * Materialize the org's integrations as filesystem skills inside the session
 * container's user-level skill dir (adapter-declared `skillsStageDir`), so the
 * agent knows what integrations exist and how to use the `integration` dispatch
 * tool — without bloating standing context. Staged per-turn from
 * runExternalAgentTurn so a connect/disconnect/binding change is reflected next
 * turn. Best-effort throughout.
 */

import { getSkillsStageDir } from '../../../lib/agent-adapters/credential-policy';
import type { ProductAgentSlug } from '../../../lib/agent-adapters/events';
import { CLAUDE_COMPAT_SKILLS_STAGE_DIR } from '../../../lib/agent-adapters/types';
import { sandboxWorkdirSessionPath } from '../../../lib/shared/sandbox-workdir';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import type { IntegrationCatalogEntry } from '../../integrations/file_actions';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import { selectStageableSkills } from '../../lib/skills/precedence';
import {
  sessionDeleteFiles,
  sessionListFiles,
  sessionStageFiles,
  type SessionStageFile,
} from './helpers/session_client';

/** Session-relative user-level skill dir for Claude-compatible runtimes. */
export const SKILLS_DIR = CLAUDE_COMPAT_SKILLS_STAGE_DIR;

export const INTEGRATION_SKILL_PREFIX = 'integration-';

/**
 * Built-in skills baked into the sandbox-runtime image
 * (services/sandbox-runtime/Dockerfile) under /opt/agents/skills/<name> and
 * symlinked into the session's user-level skill dir by the entrypoint.
 */
export const BAKED_BUILTIN_SKILL_NAMES = new Set<string>([
  'visual-aspect-analyzer',
]);

function yamlInline(value: string): string {
  return value.replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 280);
}

const WEB_ACCESS_DISABLED = `The built-in WebSearch and WebFetch tools are DISABLED — route ALL web access
through a connected integration: search the web via a search integration's
\`search\` operation, and read a specific page via its \`extract\`/fetch
operation. Never use the browser to scrape a search engine or fetch pages as a
substitute; if no suitable integration is connected, guide the user to add one.`;

const WEB_ACCESS_NATIVE = `You have native WebSearch and WebFetch for general web reading and search —
use them directly for open-web facts, docs, and public pages. Use an integration
ONLY for AUTHENTICATED or governed data sources: a private API, or your own
accounts and their data. Do NOT push the user to connect a web-search
integration for ordinary public-web lookups.`;

const SLUG_APPENDIX: Record<string, string> = {
  github: `
## Cloning or pushing a repo

GitHub also backs \`git\` here: when this agent has github both enabled AND
connected, a token is injected so \`git clone\`/\`fetch\`/\`push\` over HTTPS just
works. Public repos clone without a token.

If a \`git\` operation fails with an auth error ("could not read Username",
"Authentication failed", or an unexpected "Repository not found" on a repo you
expect to exist), do NOT retry blindly or give up — that almost always means
GitHub is not enabled for this agent or has no connected credential. Call
\`integration_status\`, then relay github's \`not_bound\`/\`not_configured\`
guidance and its \`connectUrl\` to the user in ONE message and stop until they
fix it.
`,
};

/** Build one integration SKILL.md (readiness-independent). */
export function buildIntegrationSkillMd(
  entry: IntegrationCatalogEntry,
  opts: { nativeWebTools: boolean },
): string {
  const title = entry.title ?? entry.slug;
  const summary = entry.description ?? `The ${title} integration.`;
  const ops = (entry.operations ?? [])
    .map((op) => {
      const kind = op.operationType ? ` _(${op.operationType})_` : '';
      const desc = op.description ? ` — ${op.description}` : '';
      return `- \`${op.name}\`${kind}${desc}`;
    })
    .join('\n');
  const description = yamlInline(
    `Use the ${title} integration${entry.description ? ` — ${entry.description}` : ''}. Call it via the integration tool.`,
  );
  return `---
name: integration-${entry.slug}
description: "${description}"
---

# ${title}

${summary}

## How to use

Call the \`integration\` tool:

\`\`\`
integration({ slug: "${entry.slug}", operation: "<operation>", args: { ... } })
\`\`\`
${ops ? `\n## Operations\n\n${ops}\n` : '\nCall `integration_status` to discover the available operations.\n'}
## If it is not available

The result may be \`status: "unavailable"\` with a \`blockers\` array. An
integration can need BOTH at once — relay EVERY \`blocker.guidance\` to the user
in a single message rather than one at a time:

- \`not_bound\` — not enabled for this agent. Ask the user to add "${entry.slug}"
  to this agent's integrations in the agent settings.
- \`not_configured\` / \`credential_invalid\` — no working credential. Ask the
  user to connect it at the integrations settings page (the result carries a
  \`connectUrl\`).

Call \`integration_status\` anytime to see which integrations are usable now.
${opts.nativeWebTools ? WEB_ACCESS_NATIVE : WEB_ACCESS_DISABLED}
${SLUG_APPENDIX[entry.slug] ?? ''}`;
}

/**
 * Repo-root-relative dirs where a checked-out repo declares its OWN skills.
 * Union of all known runtime conventions — repo wins on name collision.
 */
const REPO_SKILL_DIR_NAMES = [
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
  '.agents/skills',
  '.opencode/skills',
  '.pi/skills',
] as const;

/**
 * Session-relative dirs to scan for repo-owned skills. The repo root follows
 * the thread's sandbox workdir (`threadMetadata.sandboxWorkdir`): the agent's
 * runtime discovers project skills from its cwd, so precedence must scan the
 * same place — scanning only the workspace root would re-stage a skill the
 * repo already provides and hand the agent two conflicting copies.
 */
export function repoSkillScanDirs(workdirRel?: string): string[] {
  const base = sandboxWorkdirSessionPath(workdirRel);
  return REPO_SKILL_DIR_NAMES.map((dir) => `${base}/${dir}`);
}

export async function repoOwnedSkillNames(
  sessionId: string,
  workdirRel?: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const dir of repoSkillScanDirs(workdirRel)) {
    try {
      const entries = await sessionListFiles(sessionId, dir);
      for (const entry of entries ?? []) {
        if (entry.type === 'dir') {
          names.add(entry.name);
        } else if (entry.name.endsWith('.md')) {
          names.add(entry.name.slice(0, -'.md'.length));
        }
      }
    } catch (err) {
      console.warn(`[skill-precedence] listing ${dir} failed (ignoring):`, err);
    }
  }
  return names;
}

export async function stageIntegrationSkills(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    productKind: ProductAgentSlug;
    nativeWebTools: boolean;
    /** Thread's workspace-relative workdir — scopes the repo-skill scan. */
    workdirRel?: string;
  },
): Promise<void> {
  const skillsStageDir = getSkillsStageDir(args.productKind);
  if (!skillsStageDir) return;

  const orgSlug = await orgSlugFromId(ctx, args.organizationId);
  const catalog: IntegrationCatalogEntry[] = await ctx.runAction(
    internal.integrations.file_actions.listIntegrationsInternal,
    { orgSlug },
  );
  const currentSlugs = new Set(catalog.map((entry) => entry.slug));

  try {
    const entries = await sessionListFiles(args.sessionId, skillsStageDir);
    const stale = (entries ?? [])
      .filter(
        (e) =>
          e.type === 'dir' &&
          e.name.startsWith(INTEGRATION_SKILL_PREFIX) &&
          !currentSlugs.has(e.name.slice(INTEGRATION_SKILL_PREFIX.length)),
      )
      .map((e) => `${skillsStageDir}/${e.name}`);
    if (stale.length > 0) {
      await sessionDeleteFiles(args.sessionId, stale);
    }
  } catch (err) {
    console.warn('[stageIntegrationSkills] stale-skill cleanup failed:', err);
  }

  if (catalog.length === 0) return;

  const repoSkills = await repoOwnedSkillNames(args.sessionId, args.workdirRel);
  const { kept, dropped } = selectStageableSkills(
    catalog,
    (entry) => `${INTEGRATION_SKILL_PREFIX}${entry.slug}`,
    repoSkills,
  );
  if (dropped.length > 0) {
    console.info(
      '[stageIntegrationSkills] workspace repo provides these skills; deferring to it:',
      dropped,
    );
  }
  if (kept.length === 0) return;

  const files: SessionStageFile[] = kept.map((entry) => ({
    path: `${skillsStageDir}/${INTEGRATION_SKILL_PREFIX}${entry.slug}/SKILL.md`,
    contentBase64: Buffer.from(
      buildIntegrationSkillMd(entry, { nativeWebTools: args.nativeWebTools }),
      'utf8',
    ).toString('base64'),
  }));
  const result = await sessionStageFiles(args.sessionId, files);
  if (result.skipped.length > 0) {
    console.warn(
      '[stageIntegrationSkills] some integration skills were skipped:',
      result.skipped,
    );
  }
}

export async function reconcileBuiltinSkills(
  ctx: ActionCtx,
  args: {
    sessionId: string;
    productKind: ProductAgentSlug;
    /** Thread's workspace-relative workdir — scopes the repo-skill scan. */
    workdirRel?: string;
  },
): Promise<void> {
  void ctx;
  const skillsStageDir = getSkillsStageDir(args.productKind);
  if (!skillsStageDir) return;

  const repoSkills = await repoOwnedSkillNames(args.sessionId, args.workdirRel);
  const baked = [...BAKED_BUILTIN_SKILL_NAMES].map((name) => ({ name }));
  const { dropped } = selectStageableSkills(
    baked,
    (skill) => skill.name,
    repoSkills,
  );
  if (dropped.length === 0) return;
  console.info(
    '[reconcileBuiltinSkills] workspace repo provides these builtin skills; removing the image-baked symlinks so the repo wins:',
    dropped,
  );
  await sessionDeleteFiles(
    args.sessionId,
    dropped.map((name) => `${skillsStageDir}/${name}`),
  );
}
