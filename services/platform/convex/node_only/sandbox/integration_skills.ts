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
import {
  sessionDeleteFiles,
  sessionListFiles,
  sessionStageFiles,
  type SessionStageFile,
} from './helpers/session_client';

const SKILLS_DIR = '.runtime/home/.claude/skills';
const INTEGRATION_SKILL_PREFIX = 'integration-';
const BROWSER_CONTROL_SKILL = 'browser-human-control';

/** Static CC-native skill (browserCdp turns only) teaching the agent WHEN to
 * call `request_human_control`. The trigger condition lives here, not in the
 * system prompt (capability-only) — mirrors how plan-mode guidance is staged
 * out of the standing prompt. The tool description carries the "what"; this
 * carries the "when". */
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

/** Build one CC-native SKILL.md for an integration (readiness-independent). */
export function buildIntegrationSkillMd(
  entry: IntegrationCatalogEntry,
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
The built-in WebSearch and WebFetch tools are DISABLED — route ALL web access
through a connected integration: search the web via a search integration's
\`search\` operation, and read a specific page via its \`extract\`/fetch
operation. Never use the browser to scrape a search engine or fetch pages as a
substitute; if no suitable integration is connected, guide the user to add one.
`;
}

/**
 * Stage every org integration as a CC-native skill into the session's
 * CLAUDE_CONFIG_DIR (/user/.runtime/home/.claude/skills/<name>/SKILL.md). Run
 * per-turn so a connect/disconnect/binding change is reflected next turn.
 * Best-effort — callers swallow failures so skill staging never fails a turn.
 */
export async function stageIntegrationSkills(
  ctx: ActionCtx,
  args: { organizationId: string; sessionId: string },
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
  const files: SessionStageFile[] = catalog.map((entry) => ({
    path: `${SKILLS_DIR}/${INTEGRATION_SKILL_PREFIX}${entry.slug}/SKILL.md`,
    contentBase64: Buffer.from(buildIntegrationSkillMd(entry), 'utf8').toString(
      'base64',
    ),
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
 * Stage the static browser-human-control skill. Call only on turns where the
 * live headed browser (browserCdp) is enabled — that's the one a human can
 * drive via x11vnc, so the request_human_control tool exists. Idempotent
 * (overwrites the same path each turn). Best-effort — never fails the turn.
 */
export async function stageBrowserControlSkill(
  ctx: ActionCtx,
  args: { sessionId: string },
): Promise<void> {
  // ctx is unused today (the skill text is static), but kept in the signature
  // for parity with stageIntegrationSkills and in case the text ever needs org
  // context. Reference it to satisfy no-unused-vars without changing callers.
  void ctx;
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
