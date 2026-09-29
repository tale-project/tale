import type { Sql, TransactionSql } from 'postgres';

import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import type { PlatformCapability } from '../../lib/shared/competences.ts';

/**
 * Who may create a personal API key.
 *
 * A key acts as its holder in every organization they belong to, with their
 * role there, and every door it opens (REST, MCP, the model endpoints) still
 * judges each call. Holding one is a right of its own all the same: the API
 * settings offer it to owners, admins and developers, and to a member an
 * admin granted a competence whose door is reached with a key. Better Auth's
 * api-key plugin lets every signed-in user create keys, so that rule used to
 * live in the page alone — anyone could call the endpoint around it, and a
 * member granted the notification export, whom the docs send to create a
 * key, found no page to create it on. The backend now decides, with one
 * rule the create and the settings page read alike.
 *
 * The truth table:
 *   - a server-side call (no request) is the platform's own and passes;
 *   - an owner, admin or developer of any organization passes: a key is the
 *     person's, not an organization's, and works wherever they are a member;
 *   - so does a member holding a live grant of a key-using capability in an
 *     organization whose seat is not disabled;
 *   - nobody else.
 */

/** The Better Auth path this gate guards. */
export const API_KEY_CREATE_PATH = '/api-key/create';

export const API_KEY_CREATE_FORBIDDEN_MESSAGE =
  'Creating an API key takes the Owner, Admin or Developer role, or a competence an Admin grants for one: Call models over the API, Export notifications, or Act for another member.';

/**
 * The platform capabilities whose door is reached with a personal API key —
 * each one lets its holder create one. `tale:skills.publish` is exercised in
 * the app and needs none.
 */
export const API_KEY_CAPABILITIES = [
  'tale:models.api',
  'tale:notifications.export',
  'tale:rest.act-as',
] as const satisfies readonly PlatformCapability[];

/** Whether `userId` may create a personal API key at `now`. */
export async function mayCreateApiKeys(
  sql: Sql | TransactionSql,
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const seats = await sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member" WHERE "userId" = ${userId}
  `;
  if (
    seats.some((seat) =>
      defineAbilityFor(seat.role).can('read', 'developerSettings'),
    )
  ) {
    return true;
  }
  const active = seats
    .filter((seat) => seat.role.toLowerCase() !== 'disabled')
    .map((seat) => seat.organizationId);
  if (active.length === 0) return false;
  const grants = await sql<{ id: string }[]>`
    SELECT id FROM app.competence_records
    WHERE user_id = ${userId}
      AND org_id IN ${sql(active)}
      AND competence IN ${sql([...API_KEY_CAPABILITIES])}
      AND revoked_at_ms IS NULL
      AND (expires_at_ms IS NULL OR expires_at_ms > ${now})
    LIMIT 1
  `;
  return grants.length > 0;
}
