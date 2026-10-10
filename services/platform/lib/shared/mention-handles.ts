/**
 * Who a plain `@handle` in a task text names.
 *
 * A mention written through the app is stored as the id it names (a mention
 * link, `@tale/ui/mentions/mention-token`), so its words never have to be
 * looked up again. Plain `@handle` text still arrives: through the API,
 * from agents, and in everything written before mentions stored ids. This
 * module is the one place that decides whom such a handle names, for the
 * server that resolves a text when it is saved and for the app that renders
 * an older text; the two cannot disagree.
 *
 * Each person, automation and agent answers to several handles, and two of
 * them can answer to the same one. A handle's TIER decides who wins it,
 * strongest first:
 *
 *  1. `id` — an agent's id or a person's user id: opaque, never shared.
 *  2. `frozen` — what an agent answered to before agents had handles (its
 *     name with dots or without spaces, as it was then). Text written in
 *     those days keeps naming the agent it named, also after a rename.
 *  3. `primary` — an automation's store name and the local part of a
 *     person's email: an agent handle made later never takes them over.
 *  4. `stored` — an agent's handle (`agent-handle.ts`).
 *  5. `name` — a person's, an automation's or an agent's CURRENT name with
 *     dots or without spaces.
 *
 * Within a tier the entry listed last wins, so a directory listed as people,
 * automations, agents keeps the order every earlier release resolved by.
 *
 * Pure and import-free: the data migration that freezes the older agent
 * handles imports it.
 */

export type MentionKind = 'user' | 'agent' | 'automation';

/** The kinds a Tale mention link may name, in the order a directory lists
 * them. */
export const MENTION_KINDS: readonly MentionKind[] = [
  'user',
  'automation',
  'agent',
];

/** The characters a plain `@handle` may hold; a handle outside them can never
 * be typed, so it is never offered. */
const HANDLE_CHARSET_RE = /^[a-z0-9._/-]+$/;

export const MENTION_HANDLE_TIER = {
  id: 1,
  frozen: 2,
  primary: 3,
  stored: 4,
  name: 5,
} as const;

export type MentionHandleTier =
  (typeof MENTION_HANDLE_TIER)[keyof typeof MENTION_HANDLE_TIER];

export interface MentionHandle {
  handle: string;
  tier: MentionHandleTier;
}

export interface MentionActorEntry {
  kind: MentionKind;
  id: string;
  /** What a mention of this actor reads as today. */
  name: string;
  handles: MentionHandle[];
}

/** `kind:id`, the key one mentioned actor goes by. */
export function mentionRefKey(ref: { kind: string; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

function typeable(handle: string | null | undefined): handle is string {
  return (
    handle !== null &&
    handle !== undefined &&
    handle !== '' &&
    HANDLE_CHARSET_RE.test(handle)
  );
}

/** A name with its spaces made dots, and without them: `ada.lovelace`,
 * `adalovelace`. */
export function nameHandleForms(name: string | null | undefined): string[] {
  const normalized = (name ?? '').trim().toLowerCase();
  if (normalized === '') return [];
  const forms = [
    normalized.replaceAll(/\s+/g, '.'),
    normalized.replaceAll(/\s+/g, ''),
  ].filter(typeable);
  return [...new Set(forms)];
}

/** The local part of an email address, lowercased. */
export function emailHandle(email: string | null | undefined): string | null {
  const local = (email ?? '').split('@')[0]?.toLowerCase() ?? '';
  return typeable(local) ? local : null;
}

/** What an agent answered to before agents had a stored handle, from the
 * name it had then. */
export function agentLegacyHandleVariants(name: string): string[] {
  return nameHandleForms(name);
}

function dedupe(handles: MentionHandle[]): MentionHandle[] {
  const best = new Map<string, MentionHandle>();
  for (const entry of handles) {
    if (!typeable(entry.handle)) continue;
    const seen = best.get(entry.handle);
    if (seen === undefined || entry.tier < seen.tier) {
      best.set(entry.handle, entry);
    }
  }
  return [...best.values()];
}

export interface MentionableMember {
  id: string;
  name: string | null;
  email: string | null | undefined;
}

export function memberMentionEntry(
  member: MentionableMember,
): MentionActorEntry {
  const email = emailHandle(member.email);
  const name = member.name?.trim() || email || member.id;
  return {
    kind: 'user',
    id: member.id,
    name,
    handles: dedupe([
      { handle: member.id.toLowerCase(), tier: MENTION_HANDLE_TIER.id },
      ...(email === null
        ? []
        : [{ handle: email, tier: MENTION_HANDLE_TIER.primary }]),
      ...nameHandleForms(member.name).map((handle) => ({
        handle,
        tier: MENTION_HANDLE_TIER.name,
      })),
    ]),
  };
}

export interface MentionableAutomation {
  /** The store name: the automation's id and its own handle. */
  slug: string;
  /** Its display name, when it has one. */
  name?: string | null;
}

export function automationMentionEntry(
  automation: MentionableAutomation,
): MentionActorEntry {
  const name = automation.name?.trim() || automation.slug;
  return {
    kind: 'automation',
    id: automation.slug,
    name,
    handles: dedupe([
      {
        handle: automation.slug.toLowerCase(),
        tier: MENTION_HANDLE_TIER.primary,
      },
      ...nameHandleForms(automation.name).map((handle) => ({
        handle,
        tier: MENTION_HANDLE_TIER.name,
      })),
    ]),
  };
}

export interface MentionableAgent {
  id: string;
  name: string;
  /** Its stored handle; null for an agent the previous release created. */
  handle: string | null;
  /** What it answered to before handles existed; empty for an agent created
   * since. */
  legacyHandles: readonly string[];
}

export function agentMentionEntry(agent: MentionableAgent): MentionActorEntry {
  return {
    kind: 'agent',
    id: agent.id,
    name: agent.name,
    handles: dedupe([
      { handle: agent.id.toLowerCase(), tier: MENTION_HANDLE_TIER.id },
      ...agent.legacyHandles.map((handle) => ({
        handle: handle.toLowerCase(),
        tier: MENTION_HANDLE_TIER.frozen,
      })),
      ...(agent.handle === null
        ? []
        : [{ handle: agent.handle, tier: MENTION_HANDLE_TIER.stored }]),
      ...nameHandleForms(agent.name).map((handle) => ({
        handle,
        tier: MENTION_HANDLE_TIER.name,
      })),
    ]),
  };
}

interface Candidate {
  entry: MentionActorEntry;
  tier: MentionHandleTier;
  order: number;
}

export interface MentionHandleIndex {
  /** Who `handle` names: the strongest claim, or — when `prefer` names one of
   * the claimants (the people a comment was saved naming) — that one. */
  resolve(
    handle: string,
    prefer?: ReadonlySet<string>,
  ): MentionActorEntry | null;
  /** The entry of one actor, by kind and id. */
  byRef(ref: { kind: string; id: string }): MentionActorEntry | null;
}

export function buildMentionHandleIndex(
  entries: readonly MentionActorEntry[],
): MentionHandleIndex {
  const candidates = new Map<string, Candidate[]>();
  const refs = new Map<string, MentionActorEntry>();
  entries.forEach((entry, order) => {
    refs.set(mentionRefKey(entry), entry);
    for (const { handle, tier } of entry.handles) {
      const list = candidates.get(handle);
      if (list === undefined) candidates.set(handle, [{ entry, tier, order }]);
      else list.push({ entry, tier, order });
    }
  });
  for (const list of candidates.values()) {
    list.sort((a, b) => a.tier - b.tier || b.order - a.order);
  }
  return {
    resolve(handle, prefer) {
      const list = candidates.get(handle.toLowerCase());
      if (list === undefined) return null;
      if (prefer !== undefined && prefer.size > 0) {
        const preferred = list.find((candidate) =>
          prefer.has(mentionRefKey(candidate.entry)),
        );
        if (preferred !== undefined) return preferred.entry;
      }
      return list[0]?.entry ?? null;
    },
    byRef(ref) {
      return refs.get(mentionRefKey(ref)) ?? null;
    },
  };
}

/**
 * What an agent handle may not be in one organization: every member's id and
 * email name (a disabled member's left out) and every automation's store
 * name, deployed or not. The agent saves, the agent reads and the mention
 * directory all read reserved handles through this, so an agent shows,
 * stores and answers to one handle [PROJ-R19].
 */
export function organizationReservedHandles(
  members: readonly { id: string; email: string | null | undefined }[],
  automationSlugs: readonly string[],
): Set<string> {
  return reservedAgentHandles([
    ...members.map((member) =>
      memberMentionEntry({ id: member.id, name: null, email: member.email }),
    ),
    ...automationSlugs.map((slug) => automationMentionEntry({ slug })),
  ]);
}

/** Handles an agent handle must not take: whatever the organization's people
 * and automations answer to ahead of a stored agent handle — a person's id
 * and email name, an automation's store name. An agent holding one would
 * never be reached by it. */
export function reservedAgentHandles(
  entries: readonly MentionActorEntry[],
): Set<string> {
  const reserved = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'agent') continue;
    for (const { handle, tier } of entry.handles) {
      if (tier < MENTION_HANDLE_TIER.stored) reserved.add(handle);
    }
  }
  return reserved;
}
