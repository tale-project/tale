'use node';

/**
 * Materialize the turn's equipped connectors as staged skill files, so the
 * agent knows WHICH connectors it has, their operations and parameters, and
 * how to call the generic `connector` MCP tool — without bloating standing
 * context (a skill is read on demand). Ported from the legacy backend's
 * connector-skills stage (main: this same path, deleted with the AI-backend
 * rewrite), adapted to the rebuilt external-turn lane:
 *
 *  - scoped to the TURN'S GRANTED connectors (project binding ∪ conversation
 *    picks) — the bridge dispatches and reports status only for those, so a
 *    skill for an ungranted connector would document something the agent
 *    cannot reach;
 *  - staged under the same session skills dir the work lanes stage org
 *    skills into (`SKILLS_DIR` in external_turn_shared.ts), and surfaced the
 *    same way (an instructions addendum listing the paths) — harnesses here
 *    discover skills from the instructions, not a runtime dir;
 *  - worded for the rebuilt bridge's contract: read-only V1 (writes refuse
 *    with guidance), `unavailable.blockers[{code, guidance}]`,
 *    `connector_status` as the live-readiness source.
 *
 * Best-effort throughout: skill staging must never fail the turn. Staged per
 * turn with stale-skill reconcile — the agent session is per-user and
 * long-lived while grants are per-turn, so each turn deletes the
 * `connector-*` skills its grant set no longer covers.
 */

import { findConnector } from '../../../lib/connectors/catalog';
import type { ConnectorAction } from '../../../lib/shared/schemas/connectors';
import type { ActionCtx } from '../../_generated/server';
import {
  sessionDeleteFiles,
  sessionListFiles,
  sessionStageFiles,
  type SessionStageFile,
} from './helpers/session_client';

export const CONNECTOR_SKILL_PREFIX = 'connector-';

/** One-line YAML-safe frontmatter description. */
function yamlInline(value: string): string {
  return value.replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 280);
}

/** Managed external turns run with the harness's native WebSearch/WebFetch
 * disabled (governance: all egress rides audited lanes), so every connector
 * skill carries the routing rule the legacy backend shipped. */
const WEB_ACCESS_DISABLED = `The built-in WebSearch and WebFetch tools are DISABLED — route ALL web access
through an equipped connector: search the web via a search connector's
\`search\` operation, and read a specific page via its \`extract\`/fetch
operation. Never use the browser to scrape a search engine or fetch pages as a
substitute; if no suitable connector is equipped, guide the user to add one.`;

const SLUG_APPENDIX: Record<string, string> = {
  github: `
## Cloning or pushing a repo

GitHub also backs \`git\` here: while this conversation has the GitHub
connector equipped AND the organization has a connected credential, a scoped
token is injected for the turn, so \`git clone\`/\`fetch\`/\`push\` over HTTPS
just works (the \`gh\` CLI reads the same token). Public repos clone without a
token.

If a \`git\` operation fails with an auth error ("could not read Username",
"Authentication failed", or an unexpected "Repository not found" on a repo you
expect to exist), do NOT retry blindly or give up — that almost always means
the GitHub connector is not equipped for this conversation or has no working
credential. Call \`connector_status\`, then relay its guidance to the user
in ONE message and stop until they fix it.
`,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Render one action's parameters from its JSON-Schema input: required names
 * bare, optional names with `?`. Empty when the schema declares none. */
function argsHint(action: ConnectorAction): string {
  const properties = isRecord(action.input.properties)
    ? action.input.properties
    : {};
  const names = Object.keys(properties);
  if (names.length === 0) return '';
  const requiredRaw: unknown = action.input.required;
  const required = new Set(
    Array.isArray(requiredRaw)
      ? requiredRaw.filter((name): name is string => typeof name === 'string')
      : [],
  );
  const rendered = names
    .map((name) => (required.has(name) ? name : `${name}?`))
    .join(', ');
  return ` (args: ${rendered})`;
}

/**
 * Build one connector's SKILL.md. Readiness-independent — live availability
 * is `connector_status`'s job — but honest about the V1 write rule: write
 * operations are listed as not callable from this agent.
 */
export function buildConnectorSkillMd(slug: string): string | null {
  const connector = findConnector(slug);
  if (!connector) return null;
  const title = connector.displayName;
  const reads = connector.actions.filter((action) => action.effects === 'read');
  const writes = connector.actions.filter(
    (action) => action.effects !== 'read',
  );
  const readBullets = reads
    .map(
      (action) =>
        `- \`${action.name}\`${argsHint(action)} — ${action.description} Returns \`${action.output}\`.`,
    )
    .join('\n');
  const description = yamlInline(
    `Use the ${title} connector — ${connector.description} Call it via the connector tool.`,
  );
  return `---
name: ${CONNECTOR_SKILL_PREFIX}${slug}
description: "${description}"
---

# ${title}

${connector.description}

## How to use

Call the \`connector\` MCP tool:

\`\`\`
connector({ slug: "${slug}", operation: "<operation>", args: { ... } })
\`\`\`
${
  readBullets !== ''
    ? `\n## Operations\n\n${readBullets}\n`
    : '\nCall `connector_status` to discover the available operations.\n'
}${
    writes.length > 0
      ? `\nWrite operations (${writes.map((action) => `\`${action.name}\``).join(', ')}) are NOT callable from this agent yet — ask the user to run them from the chat, where approvals work.\n`
      : ''
  }
## If it is not available

The result may be \`status: "unavailable"\` with a \`blockers\` array — relay
EVERY \`blocker.guidance\` to the user verbatim in a single message rather than
one at a time. \`no_credential\` means the organization has no working
credential: the user connects one under Settings → Connectors. Call
\`connector_status\` anytime to see which connectors are usable right now.

${WEB_ACCESS_DISABLED}
${SLUG_APPENDIX[slug] ?? ''}`;
}

/**
 * Stage the granted connectors' skills into the session and return the
 * instructions addendum listing them ('' when nothing staged). Reconciles
 * first: an `connector-*` skill dir the grant set no longer covers is
 * deleted, so a thread without a connector never sees a stale skill a
 * previous thread's turn staged on this per-user session.
 */
export async function stageConnectorSkills(
  ctx: ActionCtx,
  args: {
    sessionId: string;
    /** Session-relative skills dir — the same tree the caller stages its
     * org skills into (`SKILLS_DIR`). */
    skillsDir: string;
    grants: readonly string[];
  },
): Promise<string> {
  void ctx;
  const wanted = new Set(args.grants);

  try {
    const entries = await sessionListFiles(args.sessionId, args.skillsDir);
    const stale = (entries ?? [])
      .filter(
        (entry) =>
          entry.type === 'dir' &&
          entry.name.startsWith(CONNECTOR_SKILL_PREFIX) &&
          !wanted.has(entry.name.slice(CONNECTOR_SKILL_PREFIX.length)),
      )
      .map((entry) => `${args.skillsDir}/${entry.name}`);
    if (stale.length > 0) {
      await sessionDeleteFiles(args.sessionId, stale);
    }
  } catch (err) {
    console.warn('[connector-skills] stale-skill reconcile failed:', err);
  }

  if (args.grants.length === 0) return '';

  const files: SessionStageFile[] = [];
  const staged: string[] = [];
  for (const slug of args.grants) {
    const skillMd = buildConnectorSkillMd(slug);
    if (skillMd === null) {
      console.warn(
        `[connector-skills] granted connector '${slug}' is not in the shipped catalog; skipping`,
      );
      continue;
    }
    files.push({
      path: `${args.skillsDir}/${CONNECTOR_SKILL_PREFIX}${slug}/SKILL.md`,
      contentBase64: Buffer.from(skillMd, 'utf8').toString('base64'),
    });
    staged.push(slug);
  }
  if (files.length === 0) return '';

  try {
    const result = await sessionStageFiles(args.sessionId, files);
    if (result.skipped.length > 0) {
      console.warn(
        '[connector-skills] some connector skills were skipped:',
        result.skipped.map((skip) => skip.path),
      );
    }
  } catch (err) {
    // Best-effort: the turn still runs; the agent falls back to the generic
    // `connector` tool description and `connector_status`.
    console.warn('[connector-skills] staging failed (continuing):', err);
    return '';
  }

  return [
    "Connectors equipped for this conversation (call them via the `connector` MCP tool; read a connector's skill before first using it):",
    ...staged.map(
      (slug) =>
        `- ${slug} — /user/${args.skillsDir}/${CONNECTOR_SKILL_PREFIX}${slug}/SKILL.md`,
    ),
    'Call `connector_status` to see what is usable right now.',
  ].join('\n');
}
