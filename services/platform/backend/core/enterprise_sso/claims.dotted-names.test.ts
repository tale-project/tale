import { describe, expect, it } from 'vitest';

import { resolveClaimPath } from './claims';
import { mapEntraRoleToPlatformRole } from './entra_id/role_mapping';
import { mapSamlIdentity } from './saml/attributes';
import type { SsoUserInfo } from './types';

const saml = (attributes: Record<string, unknown>) =>
  mapSamlIdentity('ada@example.com', attributes, undefined) as SsoUserInfo;

describe('claim names that contain dots (#4775)', () => {
  it('OIDC: reads an Auth0-style namespaced claim', () => {
    const claims = { 'https://tale.example.com/roles': ['admin'] };
    expect(resolveClaimPath(claims, 'https://tale.example.com/roles')).toEqual([
      'admin',
    ]);
  });

  it('SAML: a claim rule on the Microsoft role claim URI maps the role', () => {
    const uri = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
    const role = mapEntraRoleToPlatformRole(
      [
        {
          source: 'claim',
          claim: uri,
          pattern: 'Tale.Admin',
          targetRole: 'admin',
        },
      ],
      'member',
      saml({ [uri]: ['Tale.Admin'] }),
    );
    expect(role).toBe('admin');
  });

  it('SAML: a claim rule on a urn:oid attribute maps the role', () => {
    const oid = 'urn:oid:1.3.6.1.4.1.5923.1.1.1.1';
    const role = mapEntraRoleToPlatformRole(
      [{ source: 'claim', claim: oid, pattern: 'staff', targetRole: 'editor' }],
      'member',
      saml({ [oid]: ['staff'] }),
    );
    expect(role).toBe('editor');
  });

  it('control: nested dot-paths and SAML group rules still work', () => {
    expect(
      resolveClaimPath(
        { realm_access: { roles: ['user'] } },
        'realm_access.roles',
      ),
    ).toEqual(['user']);
    const role = mapEntraRoleToPlatformRole(
      [{ source: 'group', pattern: 'Finance', targetRole: 'editor' }],
      'member',
      saml({
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': [
          'Finance',
        ],
      }),
    );
    expect(role).toBe('editor');
  });
});
