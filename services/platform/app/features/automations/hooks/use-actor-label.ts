import { useCallback } from 'react';

import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { parseRunStarter } from '@/lib/shared/run-starter';

/**
 * Who an actor is, as a page can say it:
 *
 * - `you`: the reader;
 * - `member`: a member the directory lists, by `name` (display name, else
 *   e-mail);
 * - `former`: someone the directory no longer lists — a member who left, or
 *   one whose data was erased;
 * - `system`: the platform itself (`system:<what>`), "Tale";
 * - `pending`: a person the directory has not answered about yet — never a
 *   verdict on someone the page has not looked up;
 * - `unavailable`: a person the directory could not be asked about, since
 *   its read failed — no verdict either, and no placeholder that waits for
 *   an answer that will not come;
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
 * reaches the page: the reader is "you" without waiting for the directory,
 * a listed member is named, and anyone else is a former member only once
 * the directory has answered.
 */
export function useActorLabel(
  organizationId: string,
): (actor: string) => ActorLabel {
  const { members, unavailable } = useMembers(organizationId);
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
      // Until the directory has answered nobody is a former member yet: the
      // name is pending while it loads, and unavailable once its read has
      // failed (a retry may still bring it).
      if (members === undefined) {
        return { kind: unavailable ? 'unavailable' : 'pending', api };
      }
      const member = members.find((m) => m.userId === parsed.userId);
      const name = member?.displayName || member?.email;
      return name === undefined || name === ''
        ? { kind: 'former', api }
        : { kind: 'member', name, api };
    },
    [currentUserId, members, unavailable],
  );
}
