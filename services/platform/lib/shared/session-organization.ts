import { isRecord } from '../utils/type-utils.ts';

/**
 * The one organization a session is bound to: the organization whose single
 * sign-on or authenticating proxy signed it in (`trustedOrganizationId`, a
 * server-owned session column, never a request value). `null` is a session
 * that covers every organization of its person; `undefined` a marker that is
 * malformed, which never reads as global. The server holds every authority
 * decision to it (`backend/auth/session-authority.ts`), and the app reads the
 * session the server answered the same way — where a key its person makes
 * for themselves is made, for one. Read loosely: the field is one of the
 * deployment's own session columns, not part of the client's inferred type.
 */
export function sessionOrganizationId(
  session: unknown,
): string | null | undefined {
  if (!isRecord(session)) return undefined;
  const value = session.trustedOrganizationId;
  if (value === undefined || value === null) return null;
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value
    ? value
    : undefined;
}
