import { normalizeExternalMessageId } from './normalize_external_message_id';
import type { EmailType } from './types';

/**
 * Thread anchor IDs to try when routing an email, most specific first.
 *
 * Requires `In-Reply-To` — standalone emails (newsletters, first invites) must not
 * merge via `References` alone, which some providers populate incorrectly.
 */
export function parseThreadReferenceIds(email: EmailType): string[] {
  const inReplyTo = normalizeExternalMessageId(email.headers?.['in-reply-to']);
  if (!inReplyTo) return [];

  const candidates: string[] = [inReplyTo];
  const seen = new Set<string>([inReplyTo]);

  const references = email.headers?.references;
  if (references) {
    const refIds = references
      .split(/\s+/)
      .map((id) => normalizeExternalMessageId(id))
      .filter((id): id is string => !!id);
    for (let i = refIds.length - 1; i >= 0; i--) {
      const id = refIds[i];
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(id);
    }
  }

  return candidates;
}
