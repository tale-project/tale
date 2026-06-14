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
  sessionStageFiles,
  type SessionStageFile,
} from './helpers/session_client';

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

Call \`integration_status\` anytime to see which integrations are usable now. Do
NOT scrape a search engine via the browser as a substitute for a search
integration — use the connected search integration, or guide the user to add one.
`;
}

/**
 * Stage every org integration as a CC-native skill into the session's
 * CLAUDE_CONFIG_DIR (/workspace/.home/.claude/skills/<name>/SKILL.md). Run
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
  if (catalog.length === 0) return;
  const files: SessionStageFile[] = catalog.map((entry) => ({
    path: `.home/.claude/skills/integration-${entry.slug}/SKILL.md`,
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
