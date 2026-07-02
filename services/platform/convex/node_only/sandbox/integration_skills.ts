'use node';

/**
 * Materialize the org's integrations as Claude Code NATIVE filesystem skills
 * inside the session container, so the agent knows what integrations exist and
 * how to use the `integration` dispatch tool — without bloating standing
 * context (CC loads the one-line description by default and the body on demand).
 *
 * The skill text is READINESS-INDEPENDENT (capability + operations + how to
 * call + the two-state guidance). Whether an integration is bound/connected is
 * discovered at call time via the tool result, NOT baked into the file — so a
 * connect/disconnect never churns Claude Code's own prompt cache. Staged
 * per-turn from runExternalAgentTurn, so a config change is reflected next turn.
 */

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

/** Session-relative user-level skill dir (CLAUDE_CONFIG_DIR/skills). Shared
 * with the workflow-skill stager (workflow_skills.ts). */
export const SKILLS_DIR = '.runtime/home/.claude/skills';
const INTEGRATION_SKILL_PREFIX = 'integration-';
const BROWSER_CONTROL_SKILL = 'browser-human-control';

/**
 * Built-in skills baked into the sandbox-runtime image
 * (services/sandbox-runtime/Dockerfile) under /opt/agents/skills/<name> and
 * symlinked into the session's user-level skill dir by the entrypoint. Tale
 * ships their content WITH the image, so per turn it only enforces repo
 * precedence — see reconcileBuiltinSkills. Keep in sync with the Dockerfile +
 * entrypoint.sh.
 */
const BAKED_BUILTIN_SKILLS = ['visual-aspect-analyzer'] as const;

/** Static CC-native skill (browserCdp turns only) teaching the agent WHEN to
 * call \`request_human_control\`. Tightly coupled to the convex-provided tool +
 * the live-browser turn condition, so it lives INLINE here (not a standalone
 * skill under skills/) and is staged conditionally — not baked into the image.
 * The tool description carries the "what"; this carries the "when". */
const BROWSER_CONTROL_SKILL_MD = `---
name: ${BROWSER_CONTROL_SKILL}
description: "Hand the live browser to a human for a step only a person can do — a CAPTCHA, login, 2FA/OTP, or consent screen. Call the request_human_control tool."
---

# Human takeover of the live browser

You drive the live browser yourself via the Playwright tools. Some steps,
however, can only be completed by a human at the keyboard. When you hit one,
**stop and call \`request_human_control({ reason })\`** instead of guessing or
giving up.

## Call it when you hit

- A **CAPTCHA** / "prove you're human" challenge.
- A **login form** whose credentials you do not have.
- A **2FA / OTP** prompt (code from the user's phone/email/authenticator).
- An **account-consent / device-verification** screen.

## How

\`\`\`
request_human_control({ reason: "solve the CAPTCHA on the checkout page" })
\`\`\`

Give a short, specific \`reason\` — it is shown to the human so they know exactly
what to do. After the call, **end your turn immediately**. A human takes control
of the browser, completes the step, and you are resumed automatically with the
browser at the new state. Then verify the page and continue.

## Do not

- Do **not** try to read or solve a CAPTCHA yourself.
- Do **not** ask for the password or OTP in chat — the human enters it directly
  in the browser.
- Do **not** call this repeatedly; one call hands off and ends your turn.
`;

function yamlInline(value: string): string {
  return value.replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 280);
}

/** Web-access guidance when the agent's native web tools are FORCE-DISABLED
 * (managed default). Routes all web access through a connected integration. */
const WEB_ACCESS_DISABLED = `The built-in WebSearch and WebFetch tools are DISABLED — route ALL web access
through a connected integration: search the web via a search integration's
\`search\` operation, and read a specific page via its \`extract\`/fetch
operation. Never use the browser to scrape a search engine or fetch pages as a
substitute; if no suitable integration is connected, guide the user to add one.`;

/** Web-access guidance when the agent HAS native web tools (BYO, or a managed
 * agent that opted in via nativeWebTools). Integrations are for authenticated /
 * governed data sources, NOT ordinary public-web lookups. */
const WEB_ACCESS_NATIVE = `You have native WebSearch and WebFetch for general web reading and search —
use them directly for open-web facts, docs, and public pages. Use an integration
ONLY for AUTHENTICATED or governed data sources: a private API, or your own
accounts and their data. Do NOT push the user to connect a web-search
integration for ordinary public-web lookups.`;

/** Per-integration extra guidance, appended after the generic "If it is not
 * available" section. Keyed by slug; absent ⇒ no appendix. Lives here (not in
 * the integration-agnostic body) for integrations whose perception of a missing
 * capability differs from the standard bridge-tool blocker flow. */
const SLUG_APPENDIX: Record<string, string> = {
  // GitHub is a BROKER GRANT: git access uses an injected token, not the
  // bridge tool, so a clone/push auth failure surfaces as a RAW git error
  // rather than a structured blocker. Teach the agent to recognize that and
  // route into the same perceive→guide flow (integration_status + connectUrl).
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

/** Build one CC-native SKILL.md for an integration (readiness-independent). The
 * web-access guidance varies with whether the agent has native web tools. */
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
 * Workspace-relative dirs (under WORKSPACE_ROOT=/user) where a checked-out repo
 * declares its OWN skills. The repo is authoritative — Tale defers to it.
 */
const REPO_SKILL_DIRS = ['workspace/.claude/skills', 'workspace/.codex/skills'];

/**
 * Names of skills the workspace repo provides (project-level), so Tale's
 * user-level staged skills can defer to them on a name collision. Best-effort:
 * returns an empty set on any failure (or when there is no repo), so the
 * precedence check never fails a turn. `.claude/skills/<name>/` are directories;
 * `.codex/skills/<name>.md` are files.
 */
export async function repoOwnedSkillNames(
  sessionId: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const dir of REPO_SKILL_DIRS) {
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

/**
 * Stage every org integration as a CC-native skill into the session's
 * CLAUDE_CONFIG_DIR (/user/.runtime/home/.claude/skills/<name>/SKILL.md). Run
 * per-turn so a connect/disconnect/binding change is reflected next turn.
 * Best-effort — callers swallow failures so skill staging never fails a turn.
 *
 * Repo precedence: a skill the workspace repo already defines (by name) wins —
 * Tale does not stage its own copy (see lib/skills/precedence.ts).
 */
export async function stageIntegrationSkills(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    /** Whether the agent has native web tools — selects the skill's web-access
     * guidance so it never contradicts the agent's actual toolset. */
    nativeWebTools: boolean;
  },
): Promise<void> {
  const orgSlug = await orgSlugFromId(ctx, args.organizationId);
  const catalog: IntegrationCatalogEntry[] = await ctx.runAction(
    internal.integrations.file_actions.listIntegrationsInternal,
    { orgSlug },
  );
  const currentSlugs = new Set(catalog.map((entry) => entry.slug));

  // Reconcile FIRST: prune skills for integrations no longer in the catalog so a
  // deleted integration doesn't leave a stale skill the agent still sees. Runs
  // unconditionally (including when the catalog is now empty). Best-effort — a
  // listing/delete failure must never fail the turn.
  try {
    const entries = await sessionListFiles(args.sessionId, SKILLS_DIR);
    const stale = (entries ?? [])
      .filter(
        (e) =>
          e.type === 'dir' &&
          e.name.startsWith(INTEGRATION_SKILL_PREFIX) &&
          !currentSlugs.has(e.name.slice(INTEGRATION_SKILL_PREFIX.length)),
      )
      .map((e) => `${SKILLS_DIR}/${e.name}`);
    if (stale.length > 0) {
      await sessionDeleteFiles(args.sessionId, stale);
    }
  } catch (err) {
    console.warn('[stageIntegrationSkills] stale-skill cleanup failed:', err);
  }

  if (catalog.length === 0) return;

  // Repo precedence: if the workspace already defines a skill with the same
  // name, defer to it — don't stage Tale's copy.
  const repoSkills = await repoOwnedSkillNames(args.sessionId);
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
    path: `${SKILLS_DIR}/${INTEGRATION_SKILL_PREFIX}${entry.slug}/SKILL.md`,
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

/**
 * Stage the inline browser-human-control skill. Call only on turns where the
 * live headed browser (browserCdp) is enabled — that's the one a human can
 * drive via x11vnc, so the request_human_control tool exists. Idempotent
 * (overwrites the same path each turn). Best-effort — never fails the turn.
 * Repo precedence: defer to a workspace skill of the same name.
 */
export async function stageBrowserControlSkill(
  ctx: ActionCtx,
  args: { sessionId: string },
): Promise<void> {
  // ctx is unused (the skill text is static) but kept for parity + a stable
  // call signature.
  void ctx;
  const repoSkills = await repoOwnedSkillNames(args.sessionId);
  if (repoSkills.has(BROWSER_CONTROL_SKILL)) {
    console.info(
      '[stageBrowserControlSkill] workspace repo provides browser-human-control; deferring to it.',
    );
    return;
  }
  const result = await sessionStageFiles(args.sessionId, [
    {
      path: `${SKILLS_DIR}/${BROWSER_CONTROL_SKILL}/SKILL.md`,
      contentBase64: Buffer.from(BROWSER_CONTROL_SKILL_MD, 'utf8').toString(
        'base64',
      ),
    },
  ]);
  if (result.skipped.length > 0) {
    console.warn(
      '[stageBrowserControlSkill] skill staging was skipped:',
      result.skipped,
    );
  }
}

/**
 * Repo precedence for the image-baked builtin skills. The sandbox-runtime
 * entrypoint symlinks each baked builtin (BAKED_BUILTIN_SKILLS) into the
 * session's user-level skill dir, so Tale ships their content WITH the image
 * rather than staging it. If the workspace repo defines a PROJECT-level skill of
 * the same name, the repo is authoritative (lib/skills/precedence.ts): remove
 * Tale's baked symlink so the agent never loads two skills with the same name.
 * Run per turn (the repo is cloned/updated during the session). Best-effort —
 * callers swallow failures so it never fails a turn.
 */
export async function reconcileBuiltinSkills(
  ctx: ActionCtx,
  args: { sessionId: string },
): Promise<void> {
  // ctx is unused (the baked content needs no org context) but kept for parity
  // with the sibling stagers and a stable call signature.
  void ctx;
  const repoSkills = await repoOwnedSkillNames(args.sessionId);
  const { dropped } = selectStageableSkills(
    BAKED_BUILTIN_SKILLS.map((name) => ({ name })),
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
    dropped.map((name) => `${SKILLS_DIR}/${name}`),
  );
}
