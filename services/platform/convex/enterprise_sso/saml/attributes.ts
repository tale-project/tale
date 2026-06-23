/**
 * Pure mapping from a verified SAML assertion (nameId + attribute bag) to our
 * normalized identity. Honors operator-configured attribute names and falls
 * back to the common SAML / claim URIs Okta, Entra, and ADFS emit. No node deps
 * so it is fully unit-testable against fixture attribute bags.
 */

import type { AttributeMapping, SsoUserInfo } from '../types';

const EMAIL_KEYS = [
  'email',
  'emailaddress',
  'mail',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const NAME_KEYS = [
  'displayName',
  'name',
  'cn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'http://schemas.microsoft.com/identity/claims/displayname',
];
const GIVEN_KEYS = [
  'givenName',
  'firstName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
];
const SURNAME_KEYS = [
  'surname',
  'lastName',
  'sn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
];
const GROUP_KEYS = [
  'groups',
  'memberOf',
  'http://schemas.xmlsoap.org/claims/Group',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
];

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && !!v);
  }
  return [];
}

function lookup(
  attrs: Record<string, unknown>,
  configured: string | undefined,
  fallbacks: string[],
): unknown {
  if (configured && configured in attrs) return attrs[configured];
  for (const key of fallbacks) {
    if (key in attrs) return attrs[key];
    // Case-insensitive match for the short keys.
    const ci = Object.keys(attrs).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    if (ci) return attrs[ci];
  }
  return undefined;
}

function looksLikeEmail(value: string | undefined): boolean {
  return !!value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function mapSamlIdentity(
  nameId: string | undefined,
  attributes: Record<string, unknown>,
  mappings: AttributeMapping | undefined,
): SsoUserInfo | { error: string } {
  const email =
    firstString(lookup(attributes, mappings?.email, EMAIL_KEYS)) ??
    (looksLikeEmail(nameId) ? nameId : undefined);
  if (!email) {
    return {
      error: 'SAML assertion has no email (set an email attribute mapping)',
    };
  }

  const explicitName = firstString(
    lookup(attributes, mappings?.name, NAME_KEYS),
  );
  const given = firstString(lookup(attributes, undefined, GIVEN_KEYS));
  const surname = firstString(lookup(attributes, undefined, SURNAME_KEYS));
  const name =
    explicitName ??
    ([given, surname].filter(Boolean).join(' ').trim() || email);

  const groups = toStringArray(
    lookup(attributes, mappings?.groups, GROUP_KEYS),
  );

  return {
    externalId: nameId || email,
    email,
    name,
    groups,
    rawClaims: attributes,
  };
}
