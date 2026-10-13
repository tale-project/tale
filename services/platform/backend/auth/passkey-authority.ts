import { createHash } from 'node:crypto';

import type { PasskeyOptions } from '@better-auth/passkey';
import { parseOrgSessionCutoverAt } from '@tale/shared/utils/org-session-cutover';
import { APIError } from 'better-auth/api';
import type { Sql, TransactionSql } from 'postgres';

import {
  trustedHeaderAssertableRoleSchema,
  type TrustedHeaderAssertableRole,
} from '../../lib/shared/schemas/trusted_headers.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import {
  orgSessionCutoverActive,
  refuseScopedSession,
  sessionHasFreshAccountProof,
  sessionOrganizationId,
} from './session-authority.ts';
import type { SessionBundle } from './session.ts';

type Db = Sql | TransactionSql;
type Authority = 'global' | 'organization' | 'legacy_compatible';
interface FactorAuthority {
  credentialId: string | null;
  userId: string;
  organizationId: string | null;
  trustedRole: TrustedHeaderAssertableRole | null;
  authority: Authority;
  state: 'pending' | 'bound';
}

export interface SessionMintAuthority {
  userId: string;
  organizationId: string | null;
  trustedRole: string | null;
  independentIdentityVerifiedAt: Date | null;
}

/** Dispatch clones one context per endpoint. This private symbol cannot be
 * supplied by a body/query/header, and never sits on shared process state. */
const SESSION_MINT_AUTHORITY = Symbol('tale.sessionMintAuthority');
const REGISTRATION_FINGERPRINT = Symbol('tale.registrationFingerprint');
interface AuthorityContext {
  context: object;
  request?: Request;
  headers?: Headers;
}
/** Hooks may merge their library context. The actual request (or a direct
 * API call's per-dispatch Headers) remains stable across that merge. */
function privateContext(ctx: AuthorityContext): object {
  return ctx.request ?? ctx.headers ?? ctx.context;
}
export function setSessionMintAuthority(
  ctx: AuthorityContext,
  value: SessionMintAuthority,
): void {
  Reflect.set(privateContext(ctx), SESSION_MINT_AUTHORITY, value);
}
export function clearSessionMintAuthority(ctx: AuthorityContext): void {
  Reflect.deleteProperty(privateContext(ctx), SESSION_MINT_AUTHORITY);
  Reflect.deleteProperty(privateContext(ctx), REGISTRATION_FINGERPRINT);
}
export function sessionMintAuthority(
  ctx: AuthorityContext,
): SessionMintAuthority | null {
  const value: unknown = Reflect.get(
    privateContext(ctx),
    SESSION_MINT_AUTHORITY,
  );
  if (
    !isRecord(value) ||
    typeof value.userId !== 'string' ||
    (value.organizationId !== null &&
      typeof value.organizationId !== 'string') ||
    (value.trustedRole !== null && typeof value.trustedRole !== 'string') ||
    (value.independentIdentityVerifiedAt !== null &&
      !(value.independentIdentityVerifiedAt instanceof Date))
  )
    return null;
  return {
    userId: value.userId,
    organizationId: value.organizationId,
    trustedRole: value.trustedRole,
    independentIdentityVerifiedAt: value.independentIdentityVerifiedAt,
  };
}

export function mintAuthorityOf(bundle: SessionBundle): SessionMintAuthority {
  const scope = sessionOrganizationId(bundle.session);
  if (scope === undefined) throw refuseScopedSession();
  const role: unknown = Reflect.get(bundle.session, 'trustedRole');
  const proof: unknown = Reflect.get(
    bundle.session,
    'independentIdentityVerifiedAt',
  );
  const proofAt =
    proof instanceof Date
      ? proof
      : typeof proof === 'string'
        ? new Date(proof)
        : null;
  return {
    userId: bundle.user.id,
    organizationId: scope,
    trustedRole: typeof role === 'string' ? role : null,
    independentIdentityVerifiedAt:
      proofAt !== null && Number.isFinite(proofAt.getTime()) ? proofAt : null,
  };
}

function fingerprint(publicHandle: string): string {
  return createHash('sha256').update(publicHandle).digest('hex');
}

/** A non-null proxy ceiling is bounded by the maintained trusted-header
 * vocabulary. A malformed persisted/session value fails the ceremony closed. */
function trustedRoleCeiling(
  value: string | null,
): TrustedHeaderAssertableRole | null {
  if (value === null) return null;
  const parsed = trustedHeaderAssertableRoleSchema.safeParse(
    value.toLowerCase().trim(),
  );
  if (!parsed.success) throw refuseScopedSession();
  return parsed.data;
}

/** Credential existence alone cannot satisfy another realm's 2FA policy.
 * Pending custody is refused even before the fence, so a failed new
 * registration is never counted as an unknown historical factor. */
export async function qualifyingPasskeyIds(
  db: Db,
  userId: string,
  organizationId: string | undefined,
  cutoverAt: number | null,
): Promise<string[]> {
  const ids: string[] = [];
  let after = '';
  for (;;) {
    const credentials = await db<
      { id: string; userId: string; credentialID: string }[]
    >`
      SELECT "id", "userId", "credentialID" FROM "passkey"
      WHERE "userId" = ${userId} AND "id" > ${after} ORDER BY "id" ASC LIMIT 200
    `;
    if (credentials.length === 0) return ids;
    const hashes = credentials.map((credential) =>
      fingerprint(credential.credentialID),
    );
    const authorities = await db<(FactorAuthority & { fingerprint: string })[]>`
      SELECT credential_fingerprint AS fingerprint, credential_id AS "credentialId",
        user_id AS "userId", org_id AS "organizationId", trusted_role AS "trustedRole", authority, state
      FROM app.auth_factor_authorities WHERE credential_fingerprint = ANY(${hashes})
    `;
    const byFingerprint = new Map(
      authorities.map((authority) => [authority.fingerprint, authority]),
    );
    for (const credential of credentials) {
      const custody = byFingerprint.get(fingerprint(credential.credentialID));
      if (custody === undefined) {
        if (!orgSessionCutoverActive(cutoverAt)) ids.push(credential.id);
      } else if (
        custody.state === 'bound' &&
        custody.credentialId === credential.id &&
        custody.userId === userId &&
        (custody.authority !== 'organization' ||
          (organizationId !== undefined &&
            custody.organizationId === organizationId))
      ) {
        ids.push(credential.id);
      }
    }
    const next = credentials.at(-1)?.id;
    if (next === undefined || next === after)
      throw new Error('Passkey reader cursor did not progress');
    after = next;
  }
}

const INVENTORY_PREFIX = 'org_session_factor_inventory:';
const AUTHORITY_LOCK = 'tale-org-session-factor-authority';

/** Only invoked after the maintained app and Better Auth boot migrations.
 * Operators activate this after every old writer AND verifier has retired.
 * The ledger fixes the epoch; removal/change of the env cannot silently
 * recapture prospective credentials as historical global credentials. */
export function createPasskeyAuthority(sql: Sql, cutoverAt: number | null) {
  let activeInventory: Promise<void> | undefined;
  let inactiveConfigChecked = false;
  const inventory = async (): Promise<void> => {
    if (cutoverAt !== null)
      parseOrgSessionCutoverAt(new Date(cutoverAt).toISOString());
    const active = orgSessionCutoverActive(cutoverAt);
    if (activeInventory !== undefined) return activeInventory;
    if (!active && inactiveConfigChecked) return;
    const run = sql
      .begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${AUTHORITY_LOCK}, 0))`;
        const ledger = await tx<{ name: string }[]>`
        SELECT name FROM app.boot_repairs WHERE starts_with(name, ${INVENTORY_PREFIX})
      `;
        const epoch =
          cutoverAt === null
            ? null
            : `${INVENTORY_PREFIX}${new Date(cutoverAt).toISOString()}`;
        if (ledger.length > 0) {
          if (!active || ledger.length !== 1 || ledger[0]?.name !== epoch) {
            throw new Error(
              'Organization-session cutover does not match the recorded factor inventory',
            );
          }
          return;
        }
        if (!active || epoch === null || cutoverAt === null) return;
        // Lock/recheck the actual sessions AND provider links in this same
        // inventory transaction. A concurrent first-party proof or unlink
        // cannot race a guessed classification. Only these exact row/user
        // pairs are refused; unrelated password and key sessions stay intact.
        await tx`
        WITH candidates AS MATERIALIZED (
          SELECT s."id", s."userId"
          FROM "session" s JOIN "account" a ON a."userId" = s."userId"
          WHERE s."trustedOrganizationId" IS NULL
            AND s."independentIdentityVerifiedAt" IS NULL
            AND a."providerId" <> 'credential'
          ORDER BY s."id", a."id"
          FOR UPDATE OF s, a
        )
        INSERT INTO app.auth_legacy_session_refusals (session_id, user_id, cutover_at)
        SELECT DISTINCT "id", "userId", ${new Date(cutoverAt)} FROM candidates
        ON CONFLICT (session_id, user_id) DO NOTHING
      `;
        // Pages are only row identity plus public join handle; not credential
        // keys/counters. All new registrations stage under this same lock.
        let after = '';
        for (;;) {
          const rows = await tx<
            { id: string; userId: string; credentialID: string }[]
          >`
          SELECT "id", "userId", "credentialID" FROM "passkey"
          WHERE "id" > ${after} ORDER BY "id" ASC LIMIT 200
        `;
          if (rows.length === 0) break;
          for (const row of rows) {
            await tx`
            INSERT INTO app.auth_factor_authorities (
              credential_fingerprint, credential_id, user_id, org_id, trusted_role, authority, state
            ) VALUES (${fingerprint(row.credentialID)}, ${row.id}, ${row.userId}, NULL, NULL, 'legacy_compatible', 'bound')
            ON CONFLICT (credential_fingerprint) DO NOTHING
          `;
          }
          const next = rows.at(-1)?.id;
          if (next === undefined || next === after)
            throw new Error('Passkey inventory cursor did not progress');
          after = next;
        }
        await tx`INSERT INTO app.boot_repairs (name) VALUES (${epoch})`;
      })
      .then(() => undefined);
    if (active) activeInventory = run;
    try {
      await run;
    } catch (error) {
      // The transaction rolls the capture and ledger back together. Boot's
      // maintained unavailable-database retry can therefore retry honestly.
      if (activeInventory === run) activeInventory = undefined;
      throw error;
    }
    inactiveConfigChecked = true;
  };

  const authorityFor = async (
    db: Db,
    args: { id: string; userId: string; credentialID: string },
  ): Promise<FactorAuthority | null> => {
    const rows = await db<FactorAuthority[]>`
      SELECT credential_id AS "credentialId", user_id AS "userId", org_id AS "organizationId", trusted_role AS "trustedRole", authority, state
      FROM app.auth_factor_authorities WHERE credential_fingerprint = ${fingerprint(args.credentialID)}
    `;
    const row = rows[0];
    if (row === undefined) {
      return orgSessionCutoverActive(cutoverAt)
        ? null
        : {
            credentialId: args.id,
            userId: args.userId,
            organizationId: null,
            trustedRole: null,
            authority: 'legacy_compatible',
            state: 'bound',
          };
    }
    return row.state === 'bound' &&
      row.credentialId === args.id &&
      row.userId === args.userId
      ? row
      : null;
  };

  const options: Pick<PasskeyOptions, 'registration' | 'authentication'> = {
    registration: {
      afterVerification: async ({ ctx, verification, user }) => {
        if (!verification.verified) throw refuseScopedSession();
        await inventory();
        const mint = sessionMintAuthority(ctx);
        if (
          mint === null ||
          mint.userId !== user.id ||
          Reflect.get(
            ctx.context.session?.session ?? {},
            'authenticationDoor',
          ) === 'api-key'
        )
          throw refuseScopedSession();
        if (mint.organizationId !== null && !orgSessionCutoverActive(cutoverAt))
          throw refuseScopedSession();
        const credential = verification.registrationInfo?.credential.id;
        if (typeof credential !== 'string' || credential === '')
          throw refuseScopedSession();
        const hash = fingerprint(credential);
        const trustedRole =
          mint.organizationId === null
            ? null
            : trustedRoleCeiling(mint.trustedRole);
        await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${AUTHORITY_LOCK}, 0))`;
          await tx`
            INSERT INTO app.auth_factor_authorities (
              credential_fingerprint, user_id, org_id, trusted_role, authority, state
            ) VALUES (${hash}, ${user.id}, ${mint.organizationId}, ${trustedRole},
              ${mint.organizationId === null ? 'global' : 'organization'}, 'pending')
          `;
        });
        Reflect.set(privateContext(ctx), REGISTRATION_FINGERPRINT, hash);
      },
    },
    authentication: {
      afterVerification: async ({ ctx, verification, clientData }) => {
        if (!verification.verified) throw refuseScopedSession();
        await inventory();
        const rows = await sql<
          { id: string; userId: string; credentialID: string }[]
        >`
          SELECT "id", "userId", "credentialID" FROM "passkey" WHERE "credentialID" = ${clientData.id} LIMIT 1
        `;
        const credential = rows[0];
        if (credential === undefined) throw refuseScopedSession();
        const factor = await authorityFor(sql, credential);
        if (factor === null) throw refuseScopedSession();
        const current = sessionMintAuthority(ctx);
        if (
          current !== null &&
          current.organizationId !== null &&
          current.userId !== credential.userId
        )
          throw refuseScopedSession();
        const bound = current?.organizationId ?? null;
        if (
          factor.organizationId !== null &&
          bound !== null &&
          factor.organizationId !== bound
        )
          throw refuseScopedSession();
        const trustedRole =
          factor.trustedRole ??
          (bound === factor.organizationId
            ? trustedRoleCeiling(current?.trustedRole ?? null)
            : null);
        setSessionMintAuthority(ctx, {
          userId: credential.userId,
          organizationId: bound ?? factor.organizationId,
          trustedRole,
          independentIdentityVerifiedAt:
            factor.authority === 'organization'
              ? (current?.independentIdentityVerifiedAt ?? null)
              : new Date(),
        });
      },
    },
  };

  /** Bind only the actual successful library response to its server stage.
   * Failure or a missing stage never makes the credential usable. */
  const finishRegistration = async (
    ctx: AuthorityContext,
    returned: unknown,
  ): Promise<void> => {
    const hash: unknown = Reflect.get(
      privateContext(ctx),
      REGISTRATION_FINGERPRINT,
    );
    if (typeof hash !== 'string' || returned instanceof APIError) return;
    if (
      !isRecord(returned) ||
      typeof returned.id !== 'string' ||
      typeof returned.userId !== 'string'
    )
      throw refuseScopedSession();
    const rows = await sql<{ id: string }[]>`
      UPDATE app.auth_factor_authorities SET credential_id = ${returned.id}, state = 'bound'
      WHERE credential_fingerprint = ${hash} AND user_id = ${returned.userId}
        AND state = 'pending' AND credential_id IS NULL
      RETURNING credential_id AS id
    `;
    if (rows.length !== 1) throw refuseScopedSession();
  };

  const mayManage = async (
    bundle: SessionBundle,
    credentialId: string,
  ): Promise<boolean> => {
    await inventory();
    const rows = await sql<
      { id: string; userId: string; credentialID: string }[]
    >`
      SELECT "id", "userId", "credentialID" FROM "passkey"
      WHERE "id" = ${credentialId} AND "userId" = ${bundle.user.id} LIMIT 1
    `;
    const credential = rows[0];
    if (credential === undefined) return false;
    const factor = await authorityFor(sql, credential);
    if (factor === null) return false;
    const realm = sessionOrganizationId(bundle.session);
    return (
      realm === null ||
      (realm !== undefined &&
        (factor.organizationId === realm ||
          (factor.organizationId === null &&
            sessionHasFreshAccountProof(bundle.session))))
    );
  };
  return { inventory, options, finishRegistration, mayManage };
}
