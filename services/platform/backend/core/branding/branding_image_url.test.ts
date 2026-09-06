// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildBrandingImageUrl } from './file_utils';

/**
 * Branding images are rendered by the browser and by nothing else, so their
 * URL is origin-relative: on a deployment answering on several domains the
 * logo has to come from the domain the visitor is actually on, not from the
 * canonical one (which a white-label visitor may not even be able to reach).
 */

const ENV_KEYS = ['SITE_URL', 'ADDITIONAL_SITE_URLS', 'BASE_PATH'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('buildBrandingImageUrl', () => {
  it('is origin-relative, so it resolves on whichever domain serves the page', () => {
    process.env.SITE_URL = 'https://tale.example.com';
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    expect(buildBrandingImageUrl('acme', 'logo.png')).toBe(
      '/branding/images/acme/logo.png',
    );
  });

  it('carries BASE_PATH for subpath deployments, trailing slash trimmed', () => {
    process.env.BASE_PATH = '/app/';
    expect(buildBrandingImageUrl('acme', 'logo.png')).toBe(
      '/app/branding/images/acme/logo.png',
    );
  });

  it('passes through "no image" as null', () => {
    expect(buildBrandingImageUrl('acme', undefined)).toBeNull();
    expect(buildBrandingImageUrl('acme', '')).toBeNull();
  });

  it("segments by org slug so one org cannot serve another's bucket", () => {
    expect(buildBrandingImageUrl('other-org', 'logo.png')).toBe(
      '/branding/images/other-org/logo.png',
    );
  });
});
