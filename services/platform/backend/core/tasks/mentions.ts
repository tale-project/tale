/**
 * Mentions in task text: who a comment or a description names, and the form
 * it is stored in.
 *
 * A mention is stored as who it names — a mention token,
 * `[@Ada Lovelace](mention:user/<id>)` (`@tale/ui/mentions/mention-token`) —
 * so a rename never breaks it and every reader can show today's name. A
 * plain `@handle` (typed through the API, written by an agent, or saved
 * before tokens existed) is looked up by its handle
 * (`lib/shared/mention-handles.ts`), and a saving door turns the ones it
 * resolves into tokens. Where a mention can be is decided by the markdown
 * parse the screen renders with (`@tale/ui/mentions/scan-mentions`), so code,
 * math and link text never mention anyone.
 *
 * Pure: the caller supplies the directory of who can be mentioned on the
 * surface, so this stays testable without a database.
 */

import {
  formatMentionToken,
  escapeMentionLabel,
  normalizeMentionLabel,
} from '@tale/ui/mentions/mention-token';
import {
  cutMentionText,
  dropPartialMentionToken,
  findMentions,
  type MentionOccurrence,
  mentionPlainText,
  relabelMentionTokens,
  spliceMentions,
} from '@tale/ui/mentions/scan-mentions';

import {
  MENTION_KINDS,
  type MentionActorEntry,
  type MentionHandleIndex,
  type MentionKind,
  mentionRefKey,
} from '../../../lib/shared/mention-handles.ts';

export type MentionActorType = MentionKind;

export interface ResolvedMention {
  type: MentionActorType;
  id: string;
}

/** Which text named the agent on a `mention` kick or steer: a posted
 * comment, whose body the run carries as its feedback, or the task
 * description, which the turn reads as it stands when it starts. */
export type MentionSource = 'comment' | 'description';

type Occurrence = MentionOccurrence<MentionKind>;

/** Where a task text mentions someone, as written. */
export function findTaskMentions(body: string): Occurrence[] {
  return findMentions(body, { kinds: MENTION_KINDS });
}

/**
 * The plain `@handles` of a text (without the `@`), lowercased, de-duped,
 * in order of first appearance. A handle inside code or a link is none.
 */
export function parseMentionTokens(body: string): string[] {
  const seen = new Set<string>();
  for (const occurrence of findTaskMentions(body)) {
    if (occurrence.type === 'plain') seen.add(occurrence.handle);
  }
  return [...seen];
}

/** How many times each plain handle occurs in a text. */
function plainHandleCounts(occurrences: readonly Occurrence[]) {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (occurrence.type !== 'plain') continue;
    counts.set(occurrence.handle, (counts.get(occurrence.handle) ?? 0) + 1);
  }
  return counts;
}

/** The plain handles of a text before an edit, counted, so the edit's own
 * occurrences can be told from those it kept. */
export function previousPlainHandles(
  previousBody: string,
): Map<string, number> {
  return plainHandleCounts(findTaskMentions(previousBody));
}

/** The people, agents and automations a text before an edit named by token. */
export function previousTokenRefs(previousBody: string): Set<string> {
  const refs = new Set<string>();
  for (const occurrence of findTaskMentions(previousBody)) {
    if (occurrence.type === 'token') {
      refs.add(mentionRefKey(occurrence.ref));
    }
  }
  return refs;
}

/**
 * How a saving door treats a text's mentions.
 *
 * - `full`: a resolved plain handle becomes a token, a token gets the
 *   current name, and a token naming nobody who can be mentioned here
 *   becomes plain text.
 * - `tokens`: only tokens are checked and relabelled; typed handles stay as
 *   typed. For text imported from another system, whose `@names` are that
 *   system's people.
 * - `verbatim`: nothing is rewritten; the caller refuses a text whose tokens
 *   name nobody who can be mentioned here (`invalidTokens`). For a lane that
 *   must store exactly what it was sent.
 */
export type MentionTextMode = 'full' | 'tokens' | 'verbatim';

export interface NormalizeMentionTextArgs {
  body: string;
  /** Who can be mentioned on this surface. */
  index: MentionHandleIndex;
  /** The surface's length limit: a rewrite never makes the text longer. */
  cap: number;
  mode: MentionTextMode;
  /** Tokens already in the text being edited: kept as they are even when
   * whoever they name can no longer be mentioned here. */
  keepRefs?: ReadonlySet<string>;
  /** Plain handles already in the text being edited, counted: that many
   * occurrences of each stay as typed, so an edit rewrites only what it
   * adds. */
  previousPlain?: ReadonlyMap<string, number>;
  /** Who the text was saved naming: a handle two of them answer to goes to
   * the one it named then. */
  prefer?: ReadonlySet<string>;
}

export interface MentionTextResult {
  /** The text to store. */
  text: string;
  /** Who the text names, de-duped, in order of first appearance. */
  mentions: ResolvedMention[];
  /** Typed handles nobody answers to, and the names of mentions that were
   * saved as plain text because nobody here can be mentioned by them. */
  unresolvedMentionTokens: string[];
  /** Tokens naming nobody who can be mentioned here (and not kept from the
   * text before an edit). */
  invalidTokens: ResolvedMention[];
}

/**
 * Resolve a text's mentions and give it its stored form (the rules of
 * `NormalizeMentionTextArgs.mode`). Rewrites go left to right; one that would
 * take the text past `cap` is skipped — a plain handle then stays as typed
 * and still names whoever it names, a token keeps its older label — while a
 * rewrite that shortens the text always applies.
 */
export function normalizeMentionText(
  args: NormalizeMentionTextArgs,
): MentionTextResult {
  const occurrences = findTaskMentions(args.body);
  const mentions: ResolvedMention[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const named = (entry: MentionActorEntry) => {
    const key = mentionRefKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push({ type: entry.kind, id: entry.id });
  };
  const report = (token: string) => {
    if (!unresolved.includes(token)) unresolved.push(token);
  };

  const invalidTokens: ResolvedMention[] = [];
  const keptPlain = new Map(args.previousPlain ?? []);
  const rewrites = new Map<Occurrence, string>();
  for (const occurrence of occurrences) {
    if (occurrence.type === 'token') {
      const entry = args.index.byRef(occurrence.ref);
      if (entry !== null) {
        named(entry);
        if (args.mode !== 'verbatim') {
          rewrites.set(
            occurrence,
            formatMentionToken({ ...occurrence.ref, label: entry.name }),
          );
        }
        continue;
      }
      if (args.keepRefs?.has(mentionRefKey(occurrence.ref)) === true) continue;
      report(occurrence.label);
      invalidTokens.push({ type: occurrence.ref.kind, id: occurrence.ref.id });
      if (args.mode !== 'verbatim') {
        // An escaped `@`, so the name is not read as a typed handle again.
        rewrites.set(
          occurrence,
          `\\@${escapeMentionLabel(normalizeMentionLabel(occurrence.label))}`,
        );
      }
      continue;
    }
    const entry = args.index.resolve(occurrence.handle, args.prefer);
    if (entry === null) {
      report(occurrence.handle);
      continue;
    }
    named(entry);
    const kept = keptPlain.get(occurrence.handle) ?? 0;
    if (kept > 0) {
      keptPlain.set(occurrence.handle, kept - 1);
      continue;
    }
    if (args.mode === 'full') {
      rewrites.set(
        occurrence,
        formatMentionToken({
          kind: entry.kind,
          id: entry.id,
          label: entry.name,
        }),
      );
    }
  }

  let length = args.body.length;
  const applied = new Set<Occurrence>();
  for (const occurrence of occurrences) {
    const next = rewrites.get(occurrence);
    if (next === undefined) continue;
    const written = occurrence.end - occurrence.start;
    if (next === args.body.slice(occurrence.start, occurrence.end)) continue;
    const delta = next.length - written;
    if (delta > 0 && length + delta > args.cap) continue;
    length += delta;
    applied.add(occurrence);
  }
  const text =
    applied.size === 0
      ? args.body
      : spliceMentions(
          args.body,
          [...applied],
          (occurrence) => rewrites.get(occurrence) ?? null,
        );
  return { text, mentions, unresolvedMentionTokens: unresolved, invalidTokens };
}

/**
 * Mentions present in `next` but not `previous` — what a description or
 * comment EDIT newly introduces. Editing prose around an existing `@mention`
 * must not re-notify (or re-trigger) the actors already mentioned before the
 * edit.
 */
export function addedMentions(
  previous: ResolvedMention[],
  next: ResolvedMention[],
): ResolvedMention[] {
  const seen = new Set(previous.map((m) => `${m.type}:${m.id}`));
  return next.filter((m) => !seen.has(`${m.type}:${m.id}`));
}

/** The ids a text's tokens name, by kind, for one lookup of current names. */
export function mentionedRefs(texts: readonly string[]): {
  user: Set<string>;
  agent: Set<string>;
  automation: Set<string>;
} {
  const refs = {
    user: new Set<string>(),
    agent: new Set<string>(),
    automation: new Set<string>(),
  };
  for (const text of texts) {
    for (const occurrence of findTaskMentions(text)) {
      if (occurrence.type === 'token') {
        refs[occurrence.ref.kind].add(occurrence.ref.id);
      }
    }
  }
  return refs;
}

export type MentionNames = ReadonlyMap<string, string>;

/** A task text read without markdown: each token as `@` and the CURRENT
 * name of whoever it names (`names`, keyed `kind:id`), else its label. */
export function taskMentionPlainText(
  text: string,
  names: MentionNames = new Map(),
): string {
  return mentionPlainText(text, {
    kinds: MENTION_KINDS,
    nameOf: (ref) => names.get(mentionRefKey(ref)),
  });
}

/** A task text in its stored form, each token carrying the current name of
 * whoever it names: what an agent reads. */
export function relabelTaskMentions(
  text: string,
  names: MentionNames = new Map(),
): string {
  if (names.size === 0) return text;
  return relabelMentionTokens(text, {
    kinds: MENTION_KINDS,
    nameOf: (ref) => names.get(mentionRefKey(ref)),
  });
}

/**
 * A Postgres regular expression matching the address part of a stored
 * mention, `](mention:agent/<id>)`: a search replaces it with `]`, so a text
 * is matched by the names its mentions carry and never by `mention`, a kind
 * or an id.
 */
export const MENTION_URL_SQL_PATTERN = String.raw`\]\(mention:[a-z]+/[^)[:space:]]*\)`;

/** Cut a task text without leaving half a mention token at its end. */
export function cutTaskText(text: string, max: number): string {
  return cutMentionText(text, max);
}

/** A task text something else cut (a database `left()`), without the half
 * mention token the cut may have left at its end. */
export function dropPartialTaskMention(cut: string): string {
  return dropPartialMentionToken(cut);
}

/** Whether an edit names someone in a way the text it replaces did not: a
 * token of someone new, or one more occurrence of a typed handle. An edit
 * that does not has nothing to store differently and nobody new to tell. */
export function editIntroducesMentions(
  body: string,
  previousBody: string,
): boolean {
  const next = findTaskMentions(body);
  if (next.length === 0) return false;
  const previous = findTaskMentions(previousBody);
  const refs = new Set(
    previous.flatMap((occurrence) =>
      occurrence.type === 'token' ? [mentionRefKey(occurrence.ref)] : [],
    ),
  );
  const plain = plainHandleCounts(previous);
  for (const occurrence of next) {
    if (occurrence.type === 'token') {
      if (!refs.has(mentionRefKey(occurrence.ref))) return true;
      continue;
    }
    const left = plain.get(occurrence.handle) ?? 0;
    if (left === 0) return true;
    plain.set(occurrence.handle, left - 1);
  }
  return false;
}

/**
 * How a task's description treats mentions when it is saved. A task
 * mirrored from an issue tracker carries that tracker's `@people`, which
 * are not Tale's: its typed handles stay as typed, and only mention tokens
 * are checked. Every other task stores whom its text names.
 */
export function descriptionMentionMode(
  externalSystem: string | null | undefined,
): MentionTextMode {
  const system = externalSystem?.toLowerCase();
  return system === 'github' || system === 'glitchtip' ? 'tokens' : 'full';
}
