/**
 * Pure, dependency-free helpers for auto-routing (see `auto_route.ts`).
 *
 * Kept separate from the `'use node'` action module so they can be unit-tested
 * without pulling in the Convex runtime or the agent SDK — the same split the
 * reasoning governor uses (`signals.ts` pure, action layer on top).
 */

import { DEFAULT_CHAT_AGENT_SLUG } from '../../lib/shared/constants/agents';

export interface AgentListEntry {
  name: string;
  displayName?: string;
  description?: string;
  visibleInChat?: boolean;
  roleRestriction?: string;
  primaryBehavior?: string;
}

/**
 * Filter a raw agent list down to the agents that can actually answer a chat
 * message under "Auto": visible in chat, not image-generation, and (when the
 * chat is inside a project that pins agents) on the allow-list.
 */
export function filterRoutingCandidates(
  raw: AgentListEntry[],
  allowedAgentSlugs?: string[],
): AgentListEntry[] {
  const allowed =
    allowedAgentSlugs && allowedAgentSlugs.length > 0
      ? new Set(allowedAgentSlugs)
      : null;
  return raw.filter(
    (a) =>
      a &&
      typeof a.name === 'string' &&
      a.visibleInChat === true &&
      a.primaryBehavior !== 'image-generation' &&
      (!allowed || allowed.has(a.name)),
  );
}

/**
 * The general-purpose default to fall back to: the conventional chat agent if
 * present, else the first candidate, else null when there are no candidates.
 */
export function pickDefault(
  candidates: AgentListEntry[],
): AgentListEntry | null {
  const preferred = candidates.find((a) => a.name === DEFAULT_CHAT_AGENT_SLUG);
  if (preferred) return preferred;
  return candidates[0] ?? null;
}

/** Build the router system prompt from the candidate shortlist. */
export function buildRouterInstructions(candidates: AgentListEntry[]): string {
  const lines = candidates.map((a) => {
    const desc = (a.description ?? '').trim() || 'General-purpose assistant.';
    return `- ${a.name}: ${desc}`;
  });
  return `You are a router that selects the single best assistant for a user's message.

Available assistants (slug: description):
${lines.join('\n')}

Reply with ONLY the slug of the best-matching assistant from the list above.
- Output the slug verbatim, nothing else — no punctuation, no explanation.
- If no assistant clearly fits, output: ${DEFAULT_CHAT_AGENT_SLUG}`;
}

/**
 * Normalize the model's free-text reply to a candidate slug, or null if it
 * doesn't map cleanly. Tolerates a leading "- ", surrounding quotes, and a
 * model that echoes "slug: description". Matching is exact first, then
 * case-insensitive.
 */
export function matchSlug(
  raw: string,
  candidates: AgentListEntry[],
): string | null {
  const cleaned = raw
    .trim()
    .replace(/^[-*\s]+/, '')
    .replace(/^["'`]|["'`]$/g, '')
    .split(/[\s:]/)[0]
    ?.trim();
  if (!cleaned) return null;
  const exact = candidates.find((a) => a.name === cleaned);
  if (exact) return exact.name;
  const lower = cleaned.toLowerCase();
  const ci = candidates.find((a) => a.name.toLowerCase() === lower);
  return ci ? ci.name : null;
}
