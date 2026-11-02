import { useCallback } from 'react';

import { useAskedMemberLookup } from '@/app/features/settings/organization/hooks/member-lookup';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { parseRunStarter } from '@/lib/shared/run-starter';

/**
 * Who an actor is, as a page can say it:
 *
 * - `you`: the reader;
 * - `member`: a member the lookup found, by `name` (display name, else
 *   e-mail);
 * - `former`: someone the lookup answered without — a member who left, or
 *   one whose data was erased;
 * - `system`: the platform itself (`system:<what>`), "Tale";
 * - `pending`: a person the lookup has not answered about yet — never a
 *   verdict on someone the page has not looked up;
 * - `unavailable`: a person who could not be looked up, since their lookup
 *   failed — no verdict either, and no placeholder that waits for an answer
 *   that will not come;
 * - `unknown`: a value that names nobody (none recorded, or a form this
 *   build does not read).
 *
 * `api` says the person acted with an API key — over MCP or the REST API —
 * rather than in the app.
 */
export type ActorLabel =
  | { kind: 'you'; api: boolean }
  | { kind: 'member'; name: string; api: boolean }
  | { kind: 'former'; api: boolean }
  | { kind: 'pending'; api: boolean }
  | { kind: 'unavailable'; api: boolean }
  | { kind: 'system' }
  | { kind: 'unknown' };

const SYSTEM_PREFIX = 'system:';

/**
 * Names an actor as the store records one — a bare user id, `user:<id>`,
 * `api-key:<id>` (a person's key), or `system:<what>` (the platform) — for
 * whoever saved a version, put one live, or started a run. A raw id never
 * reaches the page: the reader is "you" without waiting for anything, a
 * member is named, and anyone else is a former member only once the lookup
 * has answered for them. Each person is looked up as a render names them
 * (`useAskedMemberLookup`), never by reading every member: call the label
 * while rendering what shows it.
 */
export function useActorLabel(
  organizationId: string,
): (actor: string) => ActorLabel {
  const lookup = useAskedMemberLookup(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const currentUserId = me?.userId;

  return useCallback(
    (actor: string): ActorLabel => {
      if (actor.startsWith(SYSTEM_PREFIX)) return { kind: 'system' };
      const parsed = parseRunStarter(actor);
      if (parsed.kind !== 'user' && parsed.kind !== 'api-key') {
        return { kind: 'unknown' };
      }
      const api = parsed.kind === 'api-key';
      if (parsed.userId === currentUserId) return { kind: 'you', api };
      // Until the lookup has answered for them nobody is a former member
      // yet: the name is pending while it runs, and unavailable once it has
      // failed (a retry may still bring it).
      const person = { userId: parsed.userId };
      if (lookup.pending(person)) {
        return { kind: lookup.failed(person) ? 'unavailable' : 'pending', api };
      }
      const member = lookup.members.find((m) => m.userId === parsed.userId);
      const name = member?.displayName || member?.email;
      return name === undefined || name === ''
        ? { kind: 'former', api }
        : { kind: 'member', name, api };
    },
    [currentUserId, lookup],
  );
}
