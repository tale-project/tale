import { describe, expect, it } from 'vitest';

import {
  assertValidOrgSlug,
  classifyOrgSlugUpdate,
  isValidOrgSlug,
  ORG_SLUG_IMMUTABLE_MESSAGE,
} from './org-slug';

describe('classifyOrgSlugUpdate', () => {
  it('treats a slug-less organization receiving a slug as initial', () => {
    expect(classifyOrgSlugUpdate(null, 'acme')).toBe('initial');
    expect(classifyOrgSlugUpdate(undefined, 'acme')).toBe('initial');
    expect(classifyOrgSlugUpdate('', 'acme')).toBe('initial');
  });

  it('lets the current slug be re-sent unchanged', () => {
    expect(classifyOrgSlugUpdate('acme', 'acme')).toBe('unchanged');
  });

  it('classifies any other value as a rename — the case the auth hook refuses', () => {
    expect(classifyOrgSlugUpdate('acme', 'acme-2')).toBe('rename');
    // Case differs → different tenant key (keys are compared verbatim; the
    // hook lower-cases the request before asking).
    expect(classifyOrgSlugUpdate('acme', 'Acme')).toBe('rename');
  });

  it('carries an actionable refusal for operators', () => {
    expect(ORG_SLUG_IMMUTABLE_MESSAGE).toMatch(/cannot be changed/);
    expect(ORG_SLUG_IMMUTABLE_MESSAGE).toMatch(/Create a new organization/);
  });
});

describe('org slug validity', () => {
  it('accepts lowercase alphanumerics with - and _', () => {
    expect(isValidOrgSlug('acme')).toBe(true);
    expect(isValidOrgSlug('acme-2_eu')).toBe(true);
    expect(() => assertValidOrgSlug('acme')).not.toThrow();
  });

  it('rejects uppercase, leading punctuation, and over-long slugs', () => {
    expect(isValidOrgSlug('Acme')).toBe(false);
    expect(isValidOrgSlug('-acme')).toBe(false);
    expect(isValidOrgSlug('a'.repeat(65))).toBe(false);
    expect(() => assertValidOrgSlug('Acme')).toThrow(/Invalid org slug/);
  });
});
