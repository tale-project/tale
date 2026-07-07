import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

import { parseConvexRunJson, stripConvexBannerLines } from './convex-run';

/** v0.3.2 and earlier: unanchored Enter/Open/Paste in `grep -v` (GNU ERE). */
const LEGACY_BANNER_GREP_V =
  '^Admin key|^📋|^✅ Admin|^━|^🌐|^$|Steps:|Open|Enter|Paste';

/** Mirrors GNU `grep -vE` in the platform container (JS RegExp ≠ ERE here). */
function legacyGrepStrip(stdout: string): string {
  const result = spawnSync('grep', ['-vE', LEGACY_BANNER_GREP_V], {
    input: stdout,
    encoding: 'utf8',
  });
  return result.stdout ?? '';
}

const ENTERPRISE_SSO_META = {
  description:
    'For each org with a legacy ssoProviders row, writes its unified ' +
    'connection.json (protocol oidc/oauth2, oidc block from issuer + scopes + ' +
    'claim/feature mappings, provisioning from roleMappingRules/defaultRole/' +
    'providerFeatures) and a connection.secrets.json with the decrypted client ' +
    'credentials, then re-syncs the configCache mirror. A per-org fs-tree ' +
    'snapshot of the sso/ directory is taken first so down can restore the ' +
    'prior files. Idempotent (re-running overwrites the same files).',
  destructive: false,
  id: '0.2.87/01_enterprise_sso_unify',
  kind: 'node',
  numericId: 1,
  reversible: true,
  semver: '0.2.87',
  slug: 'enterprise_sso_unify',
  title: 'Migrate ssoProviders into the file-based Enterprise SSO connection',
  snapshot: 'fs-tree',
};

describe('stripConvexBannerLines', () => {
  test('does not strip migration JSON lines containing Enterprise or OpenRouter', () => {
    const line = `    "title": "${ENTERPRISE_SSO_META.title}",`;
    expect(stripConvexBannerLines(line)).toBe(line);
    expect(
      stripConvexBannerLines(
        '    "description": "For openrouter provider config and OpenID scopes",',
      ),
    ).toContain('openrouter');
  });

  test('strips convex CLI banner lines', () => {
    const stdout = [
      'Admin key:',
      'Enter your deployment URL',
      '[{"id":"x"}]',
    ].join('\n');
    expect(stripConvexBannerLines(stdout)).toBe('[{"id":"x"}]');
  });
});

describe('parseConvexRunJson', () => {
  test('parses planUp array after banner lines', () => {
    const payload = [ENTERPRISE_SSO_META];
    const stdout = `Admin key:\n${JSON.stringify(payload, null, 2)}`;
    const parsed = parseConvexRunJson<typeof payload>(stdout);
    expect(parsed).not.toBeNull();
    expect(parsed?.[0]?.title).toContain('Enterprise SSO');
  });

  test('legacy v0.3.2 grep corrupts planUp JSON when title contains Enterprise', () => {
    // Convex pretty-prints meta keys alphabetically; title follows snapshot.
    const stdout = `[
  {
    "slug": "enterprise_sso_unify",
    "snapshot": "fs-tree",
    "title": "${ENTERPRISE_SSO_META.title}"
  }
]`;
    const corrupted = legacyGrepStrip(stdout);
    expect(() => JSON.parse(corrupted)).toThrow();
    expect(
      parseConvexRunJson<{ title: string }[]>(stdout)?.[0]?.title,
    ).toContain('Enterprise SSO');
  });
});
