// @vitest-environment node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'vitest';

import { parseYamlOrThrow } from '../../../../../lib/shared/config/yaml';
import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/01_governance_config_json_to_yaml';

// Seeded governance fixtures for org1 (org2 stays empty — the per-org no-op
// path). Covers a plain policy, a legacy-pair system_prompt, the retention
// bounds catalog, the nested SSO connection + its secrets sidecar, and one
// unknown file no schema claims.
const PASSWORD_POLICY = {
  minLength: 14,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSpecial: false,
  rotationDays: 90,
};
const SYSTEM_PROMPT = {
  mandatoryPrefixPrompt: 'Prefix rule.',
  mandatorySuffixPrompt: 'Suffix rule.',
};
const RETENTION = {
  auditLog: { min: 365, max: 3650, default: 400, unit: 'days' },
};
const SSO_CONNECTION = {
  enabled: true,
  protocol: 'oidc',
  displayName: 'Corp SSO',
  oidc: {
    providerId: 'generic-oidc',
    issuer: 'https://idp.example.com',
    scopes: ['openid', 'email'],
  },
  provisioning: {
    autoProvisionRole: false,
    defaultRole: 'member',
    roleMappingRules: [],
    autoProvisionTeam: false,
    excludeGroups: [],
  },
};
const SSO_SECRETS_TEXT =
  '{\n  "clientId": "cid",\n  "clientSecret": "s3cret"\n}\n';
const UNKNOWN_TEXT = '{\n  "custom": true\n}\n';

// Harness ritual: real fleet up (incl. the real yml-first configCache sync),
// handler idempotency over migrated state, down restoring the seed digest
// byte-for-byte from the fs-tree snapshot, ledger coverage per org.
defineMigrationTest({
  id: '0.4.0/01_governance_config_json_to_yaml',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const gov = path.join(root, orgs[0].slug, 'governance');
    await mkdir(path.join(gov, 'sso'), { recursive: true });
    const json = (data: unknown): string =>
      JSON.stringify(data, null, 2) + '\n';
    await writeFile(
      path.join(gov, 'password-policy.json'),
      json(PASSWORD_POLICY),
    );
    await writeFile(path.join(gov, 'system-prompt.json'), json(SYSTEM_PROMPT));
    await writeFile(path.join(gov, 'retention.json'), json(RETENTION));
    await writeFile(
      path.join(gov, 'sso', 'connection.json'),
      json(SSO_CONNECTION),
    );
    await writeFile(
      path.join(gov, 'sso', 'connection.secrets.json'),
      SSO_SECRETS_TEXT,
    );
    await writeFile(path.join(gov, 'org-notes.json'), UNKNOWN_TEXT);
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const gov = (slug: string, ...parts: string[]) =>
      path.join(world.configRoot, slug, 'governance', ...parts);

    // Known files: converted to .yml with identical values, .json removed.
    const converted: Array<[string[], unknown]> = [
      [['password-policy'], PASSWORD_POLICY],
      [['system-prompt'], SYSTEM_PROMPT],
      [['retention'], RETENTION],
      [['sso', 'connection'], SSO_CONNECTION],
    ];
    for (const [parts, expected] of converted) {
      const base = gov(org1.slug, ...parts);
      const yaml = await readFile(`${base}.yml`, 'utf-8');
      expect(parseYamlOrThrow(yaml)).toMatchObject(
        expected as Record<string, unknown>,
      );
      expect(await readFileSafe(`${base}.json`)).toBeNull();
    }

    // The legacy system_prompt pair survives conversion verbatim — old files
    // must stay readable; nothing rewrites them onto the unified field.
    const systemPrompt = parseYamlOrThrow(
      await readFile(`${gov(org1.slug, 'system-prompt')}.yml`, 'utf-8'),
    ) as Record<string, unknown>;
    expect(systemPrompt.mandatoryPrefixPrompt).toBe('Prefix rule.');
    expect(systemPrompt.mandatoryInstructions).toBeUndefined();

    // Secrets sidecar: byte-identical, and no .yml sibling appeared.
    expect(
      await readFile(gov(org1.slug, 'sso', 'connection.secrets.json'), 'utf-8'),
    ).toBe(SSO_SECRETS_TEXT);
    expect(
      await readFileSafe(gov(org1.slug, 'sso', 'connection.secrets.yml')),
    ).toBeNull();

    // Unknown file: untouched, not converted.
    expect(await readFile(gov(org1.slug, 'org-notes.json'), 'utf-8')).toBe(
      UNKNOWN_TEXT,
    );
    expect(await readFileSafe(gov(org1.slug, 'org-notes.yml'))).toBeNull();

    // The real yml-first file→cache sync mirrored the converted files.
    const cache = await world.run<Array<Record<string, unknown>>>((ctx) =>
      ctx.db.query('configCache').collect(),
    );
    const keysFor = (orgId: string, domain: string): string[] =>
      cache
        .filter((row) => row.organizationId === orgId && row.domain === domain)
        .map((row) => String(row.key))
        .sort();
    expect(keysFor(org1.id, 'governance')).toEqual([
      'password_policy',
      'system_prompt',
    ]);
    expect(keysFor(org1.id, 'sso')).toEqual(['connection']);

    // org2 had no governance tree — nothing appears.
    expect(
      await readFileSafe(gov(org2.slug, 'password-policy.yml')),
    ).toBeNull();
    expect(keysFor(org2.id, 'governance')).toEqual([]);
  },
});
