import { parseMentionTokens } from '@/convex/tasks/mentions';

import type { MentionActorOption } from '../../tasks/lib/mention-actor-options';
import {
  memberHandleVariants,
  MENTION_TOKEN_RE,
} from '../../tasks/lib/mention-handles';

/**
 * Actor-mention chips derived from the composer text. Unlike knowledge-base
 * mentions (where the chip state is the source of truth), an actor mention IS
 * the plain-text `@handle` — the discussion backend re-parses the body — so
 * the chips must derive from the text or they would lie the moment the user
 * edits a handle out. Parsing reuses the server's own tokenizer
 * (`convex/tasks/mentions.ts::parseMentionTokens`) and the shared handle
 * variants (`mention-handles.ts`), so a chip shows exactly when the server
 * would resolve the mention.
 */

/** All lowercased handles that resolve to an option, server-derivation order
 *  (members: email local part → dotted name → squashed name → id; agents:
 *  the slug). */
function handleVariants(option: MentionActorOption): string[] {
  if (option.type === 'agent') return [option.handle.toLowerCase()];
  return memberHandleVariants({
    id: option.id,
    name: option.name,
    email: option.email,
  });
}

/** The actors mentioned in `value`, in first-mention order (deduped). */
export function findMentionedActors(
  value: string,
  options: MentionActorOption[],
): MentionActorOption[] {
  if (!value.includes('@') || options.length === 0) return [];
  const tokens = parseMentionTokens(value);
  if (tokens.length === 0) return [];
  const byHandle = new Map<string, MentionActorOption>();
  for (const option of options) {
    for (const handle of handleVariants(option)) {
      if (!byHandle.has(handle)) byHandle.set(handle, option);
    }
  }
  const mentioned: MentionActorOption[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const option = byHandle.get(token);
    if (!option) continue;
    const key = `${option.type}:${option.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentioned.push(option);
  }
  return mentioned;
}

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Remove every `@`-mention of an actor from `value` (all handle variants,
 * with one trailing space so the surrounding prose doesn't double-space).
 * Same token boundaries as the server parser: whitespace/start before `@`,
 * no handle character after.
 */
export function stripActorMention(
  value: string,
  option: MentionActorOption,
): string {
  let next = value;
  for (const handle of handleVariants(option)) {
    if (!MENTION_TOKEN_RE.test(handle)) continue;
    const escaped = handle.replace(REGEXP_SPECIALS, String.raw`\$&`);
    next = next.replace(
      new RegExp(String.raw`(^|\s)@${escaped}(?![A-Za-z0-9._-]) ?`, 'gi'),
      '$1',
    );
  }
  return next;
}
