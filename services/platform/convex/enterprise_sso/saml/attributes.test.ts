import { describe, expect, it } from 'vitest';

import { mapSamlIdentity } from './attributes';

describe('mapSamlIdentity', () => {
  it('maps Okta-style claim URIs without explicit mappings', () => {
    const r = mapSamlIdentity(
      'ada@example.com',
      {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress':
          'ada@example.com',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name':
          'Ada Lovelace',
        'http://schemas.xmlsoap.org/claims/Group': ['Admins', 'Engineering'],
      },
      undefined,
    );
    expect(r).toMatchObject({
      externalId: 'ada@example.com',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      groups: ['Admins', 'Engineering'],
    });
  });

  it('honors operator-configured attribute names', () => {
    const r = mapSamlIdentity(
      'uid-123',
      { contactEmail: 'grace@example.com', team: 'Compilers' },
      { email: 'contactEmail', groups: 'team' },
    );
    expect(r).toMatchObject({
      externalId: 'uid-123',
      email: 'grace@example.com',
      groups: ['Compilers'],
    });
  });

  it('falls back to nameID when it is an email', () => {
    const r = mapSamlIdentity('person@corp.com', {}, undefined);
    expect(r).toMatchObject({
      email: 'person@corp.com',
      name: 'person@corp.com',
    });
  });

  it('composes name from given + surname when no display name', () => {
    const r = mapSamlIdentity(
      'x@y.io',
      { givenName: 'Ada', surname: 'Lovelace' },
      undefined,
    );
    expect('name' in r && r.name).toBe('Ada Lovelace');
  });

  it('errors when no email can be resolved', () => {
    const r = mapSamlIdentity('opaque-id', { foo: 'bar' }, undefined);
    expect('error' in r).toBe(true);
  });

  it('is case-insensitive on short attribute keys', () => {
    const r = mapSamlIdentity(undefined, { Email: 'z@z.io' }, undefined);
    expect(r).toMatchObject({ email: 'z@z.io' });
  });
});
