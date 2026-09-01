/**
 * Client-side mirror of the server's mention-handle derivation
 * (`backend/domains/collab/mention-directory.ts::memberHandles`). The composer inserts the
 * FIRST server-resolvable handle; the read views resolve EVERY variant back
 * to a display name, so a mention typed in any form (`@alice.smith`,
 * `@alicesmith`, `@alice`) renders as the person's name.
 */

/** The plain-text token charset the server's mention parser accepts
 *  (`backend/core/tasks/mentions.ts::MENTION_RE`) — a handle outside it can never
 *  resolve, so such candidates are skipped. Includes `/` so pack agent
 *  slugs (`github/create-pull-requests/pr-creator`) round-trip. */
export const MENTION_TOKEN_RE = /^[a-zA-Z0-9._/-]+$/;

export interface MentionableMember {
  id: string;
  name: string;
  email?: string;
}

/** All candidate handles for a member, lowercased, server-derivation order:
 *  email local part → dotted name → squashed name → userId. */
export function memberHandleVariants(member: MentionableMember): string[] {
  const candidates = [
    member.email?.split('@')[0],
    member.name.trim().toLowerCase().replace(/\s+/g, '.'),
    member.name.trim().toLowerCase().replace(/\s+/g, ''),
    member.id,
  ];
  const variants: string[] = [];
  for (const candidate of candidates) {
    if (candidate && MENTION_TOKEN_RE.test(candidate)) {
      variants.push(candidate.toLowerCase());
    }
  }
  return variants;
}

/** The preferred handle the composer inserts (first resolvable variant). */
export function memberInsertHandle(member: MentionableMember): string | null {
  return memberHandleVariants(member)[0] ?? null;
}

export interface MentionableAgent {
  id: string;
  name: string;
}

/** All candidate handles for a project agent instance, lowercased, the
 *  server derivation order (`backend/domains/collab/mention-directory.ts::agentInstanceHandles`):
 *  dotted name → squashed name → instance id (the collision-proof fallback
 *  the server also resolves). */
export function agentHandleVariants(agent: MentionableAgent): string[] {
  const name = agent.name.trim().toLowerCase();
  const candidates = [
    name.replace(/\s+/g, '.'),
    name.replace(/\s+/g, ''),
    agent.id,
  ];
  const variants: string[] = [];
  for (const candidate of candidates) {
    if (candidate && MENTION_TOKEN_RE.test(candidate)) {
      const lowered = candidate.toLowerCase();
      if (!variants.includes(lowered)) variants.push(lowered);
    }
  }
  return variants;
}

/** The preferred handle the composer inserts — the readable name form, never
 *  the raw instance id (that form still resolves, for older comments). */
export function agentInsertHandle(agent: MentionableAgent): string | null {
  return agentHandleVariants(agent)[0] ?? null;
}

export interface MentionableAutomation {
  /** The automation's store name (slug) — the stable addressing form. */
  slug: string;
  /** Display name in the reader's locale. */
  name: string;
}

/** All candidate handles for a deployed automation, lowercased, the server
 *  derivation order (`backend/domains/collab/mention-directory.ts::automationHandles`): store
 *  name → dotted display name → squashed display name. */
export function automationHandleVariants(
  automation: MentionableAutomation,
): string[] {
  const name = automation.name.trim().toLowerCase();
  const candidates = [
    automation.slug,
    name.replace(/\s+/g, '.'),
    name.replace(/\s+/g, ''),
  ];
  const variants: string[] = [];
  for (const candidate of candidates) {
    if (candidate && MENTION_TOKEN_RE.test(candidate)) {
      const lowered = candidate.toLowerCase();
      if (!variants.includes(lowered)) variants.push(lowered);
    }
  }
  return variants;
}

/** The handle the composer inserts for an automation: the store name — it is
 *  already readable (`vat-return-desk`) and, unlike the localized display
 *  name, identical for every teammate reading the comment back. */
export function automationInsertHandle(
  automation: MentionableAutomation,
): string | null {
  return automationHandleVariants(automation)[0] ?? null;
}
