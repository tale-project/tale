import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';

import { isRecord } from '../../lib/utils/type-utils.ts';
import { endAgentConnectionsInTx } from '../domains/agent_connections/end.ts';

/**
 * A refresh token used twice.
 *
 * An agent's refresh token is good once: using it hands the agent a new one
 * and retires the old. The sign-in server answers a retry of that same
 * request in the few seconds after (a second process, a dropped answer) with
 * the same result; anything later is a copy of a token that was already
 * spent. The provider then ends every refresh token of that app for that
 * person — in every organization — and answers `invalid_grant`.
 *
 * Tale ends the connections too: the records of that person and app, in every
 * organization the provider just took the sign-in from, end as the platform's
 * doing with the reason "refresh reuse", with their consent and trail. The
 * provider's answer is judged where it happens, at the token endpoint, so
 * what Tale concludes is what the provider did: a refresh that fails for any
 * other reason ends nothing.
 */

/** A token request is a handful of form fields; a body past this is not one
 * this can read, and the provider's own limits apply. */
const TOKEN_REQUEST_BYTES = 64 * 1024;

/** The longest refresh token looked up; a longer one is no token the
 * provider issued. */
const REFRESH_TOKEN_CHARS = 2048;

/**
 * The string fields of a token request — its form, or the JSON it claims to
 * be — or null when it is too large to read or not readable. Read from a
 * clone, so the provider still gets the body whole.
 */
export async function tokenRequestFields(
  request: Request,
): Promise<Record<string, string> | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > TOKEN_REQUEST_BYTES) return null;
  const text = await request.clone().text();
  if (text.length > TOKEN_REQUEST_BYTES) return null;
  const media = (request.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (
    media !== undefined &&
    /^application\/([a-z0-9.+-]*\+)?json$/.test(media)
  ) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) return null;
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    } catch (error) {
      console.warn(
        '[agent-oauth] a token request whose body is not the JSON it claims to be:',
        error instanceof Error ? error.name : 'unknown',
      );
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** A refresh token as the provider stores it: the SHA-256 of the token, in
 * unpadded base64url (its default for tokens, which Tale leaves as it is). */
export function storedRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** A refresh token the provider already retired, and whose person and app
 * its row names. */
export interface UsedRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly clientId: string;
}

/**
 * The refresh token a request presents when it is one the provider has
 * already retired and no longer answers a retry for: stamped revoked, not
 * yet expired and past the seconds in which a retried refresh gets the same
 * answer again. Null for every other request and for a token the provider
 * would refuse for another reason; a lookup that fails is logged and reads
 * as null, so the token request is never held up by it.
 */
export async function usedRefreshToken(
  sql: Sql,
  fields: Readonly<Record<string, string>>,
  now: Date = new Date(),
): Promise<UsedRefreshToken | null> {
  const token = fields.refresh_token;
  if (
    fields.grant_type !== 'refresh_token' ||
    token === undefined ||
    token === '' ||
    token.length > REFRESH_TOKEN_CHARS
  ) {
    return null;
  }
  try {
    const rows = await sql<UsedRefreshToken[]>`
      SELECT "id", "userId", "clientId" FROM "oauthRefreshToken"
      WHERE "token" = ${storedRefreshToken(token)}
        AND "revoked" IS NOT NULL
        AND "expiresAt" > ${now}
        AND NOT (
          "rotatedAt" IS NOT NULL
          AND "rotationReplayExpiresAt" IS NOT NULL
          AND "rotationReplayExpiresAt" >= ${now}
        )
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    console.error(
      '[agent-oauth] could not look up the refresh token a request presented:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * After the provider refused a request that presented a used refresh token:
 * when that token is gone, the provider ended the whole sign-in of the app
 * for the person (a refusal for any other reason leaves the token where it
 * was), and so do the connections — all of the person's of this app, in
 * every organization. Never throws: the answer to the agent is the
 * provider's, whatever happens here.
 */
export async function endAgentsAfterReuse(
  sql: Sql,
  used: UsedRefreshToken,
): Promise<number> {
  try {
    const remaining = await sql<{ id: string }[]>`
      SELECT "id" FROM "oauthRefreshToken" WHERE "id" = ${used.id} LIMIT 1
    `;
    if (remaining.length > 0) return 0;
    const ended = await sql.begin((tx) =>
      endAgentConnectionsInTx(tx, {
        userId: used.userId,
        clientId: used.clientId,
        reason: 'refresh_reuse',
        revokedBy: 'system',
      }),
    );
    console.warn(
      `[agent-oauth] a refresh token was used twice: ended ${ended.length} connection(s) of the app`,
    );
    return ended.length;
  } catch (error) {
    console.error(
      '[agent-oauth] could not end the connections after a refresh token was used twice:',
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}
