import { oauthProvider } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';

import { isRecord } from '../../lib/utils/type-utils.ts';
import { evaluateTwoFactorEnforcement } from '../domains/two_factor/service.ts';
import { findOrganizationMember, isAdminRole } from './membership.ts';

/** One organization, selected by the registered client, never all memberships. */
export const OIDC_ORGANIZATION_CLAIM = 'https://tale.dev/organization';
export const OIDC_SCOPES = ['openid', 'profile', 'email', 'tale:organization'];

/** Client management is exposed through the organization-aware app routes. */
export const OIDC_DISABLED_PATHS = [
  '/token',
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/client/rotate-secret',
  '/admin/oauth2/create-client',
  '/admin/oauth2/update-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
];

export async function oidcOrganizationClaims(
  sql: Sql,
  user: { id: string; emailVerified: boolean },
  organizationId: unknown,
) {
  if (!user.emailVerified || typeof organizationId !== 'string') {
    throw new APIError('FORBIDDEN', { message: 'IDENTITY_NOT_ELIGIBLE' });
  }
  const rows = await sql<{ id: string; slug: string; role: string }[]>`
    SELECT o."id", o."slug", m."role"
    FROM "organization" o
    JOIN "member" m ON m."organizationId" = o."id"
    WHERE o."id" = ${organizationId} AND m."userId" = ${user.id}
      AND m."role" IN ('owner', 'admin', 'developer', 'editor', 'member')
    LIMIT 1
  `;
  const organization = rows[0];
  if (
    !organization ||
    (await evaluateTwoFactorEnforcement(sql, user.id)).decision === 'blocked'
  ) {
    throw new APIError('FORBIDDEN', { message: 'IDENTITY_NOT_ELIGIBLE' });
  }
  return { [OIDC_ORGANIZATION_CLAIM]: organization };
}

export function createOidcProvider(sql: Sql, baseUrl: string) {
  const basePath = (process.env.BASE_PATH ?? new URL(baseUrl).pathname).replace(
    /\/$/,
    '',
  );
  return oauthProvider({
    loginPage: `${basePath}/oauth/continue`,
    consentPage: `${basePath}/oauth/consent`,
    scopes: OIDC_SCOPES,
    grantTypes: ['authorization_code'],
    codeExpiresIn: 60,
    accessTokenExpiresIn: 300,
    idTokenExpiresIn: 300,
    allowDynamicClientRegistration: false,
    silenceWarnings: { oauthAuthServerConfig: true },
    allowUnauthenticatedClientRegistration: false,
    clientReference: ({ session }) => {
      const organizationId = session?.activeOrganizationId;
      return typeof organizationId === 'string' ? organizationId : undefined;
    },
    clientPrivileges: async ({ session, user }) => {
      const organizationId = session?.activeOrganizationId;
      if (!user || typeof organizationId !== 'string') return false;
      const member = await findOrganizationMember(sql, organizationId, user.id);
      return member !== null && isAdminRole(member.role);
    },
    customIdTokenClaims: ({ user, metadata }) =>
      oidcOrganizationClaims(sql, user, metadata?.taleOrganizationId),
    customAccessTokenClaims: ({ user, metadata }) => {
      if (!user) {
        throw new APIError('FORBIDDEN', { message: 'IDENTITY_NOT_ELIGIBLE' });
      }
      return oidcOrganizationClaims(sql, user, metadata?.taleOrganizationId);
    },
    customUserInfoClaims: ({ user, jwt }) => {
      const organization = jwt[OIDC_ORGANIZATION_CLAIM];
      return oidcOrganizationClaims(
        sql,
        user,
        isRecord(organization) ? organization.id : undefined,
      );
    },
  });
}
