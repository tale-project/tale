// The registry cache settings are named in four places that no type joins: the
// spawner, the runtime entrypoint that writes the package managers' files, the
// egress proxy that refuses the registries, and the documentation an operator
// copies from. This holds them to one another: the list of hosts the proxy is
// told to refuse is the one the spawner knows, in the contract and in each
// language of the environment reference, and the entrypoint reads the variables
// the spawner sets.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REGISTRY_CACHE_ENV, REGISTRY_HOSTS } from './incus-registry-caches.ts';

const REPO = resolve(import.meta.dir, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

const HOSTS = [...REGISTRY_HOSTS.npm, ...REGISTRY_HOSTS.pypi];
const LIST = HOSTS.join(',');

describe('the registry hosts the proxy is told to refuse', () => {
  test('are the public registries of npm and PyPI, and no other host', () => {
    expect(REGISTRY_HOSTS).toEqual({
      npm: ['registry.npmjs.org', 'registry.yarnpkg.com'],
      pypi: ['pypi.org', 'files.pythonhosted.org'],
    });
  });

  test('read the same in the contract', () => {
    const contract = read('services/sandbox/docs/incus.md');
    expect(contract).toContain(`SANDBOX_EGRESS_DENIED_HOSTS=${LIST}\n`);
  });

  test.each(['en', 'de', 'fr'])(
    'read the same in the %s environment reference',
    (locale) => {
      const page = read(
        `docs/${locale}/self-hosted/configuration/environment-reference.md`,
      );
      const row = page
        .split('\n')
        .find((line) => line.startsWith('| `SANDBOX_EGRESS_DENIED_HOSTS` |'));
      expect(row).toBeDefined();
      const named =
        /`((?:[a-z0-9-]+\.)+[a-z]+(?:,(?:[a-z0-9-]+\.)+[a-z]+)+)`/.exec(
          row ?? '',
        );
      expect(named?.[1]).toBe(LIST);
    },
  );
});

describe('the settings an operator copies', () => {
  const SETTINGS = [
    'SANDBOX_INCUS_NPM_REGISTRY',
    'SANDBOX_INCUS_PYPI_INDEX',
    'SANDBOX_EGRESS_DENIED_HOSTS',
  ];

  test('are in the contract and in every language of the environment reference', () => {
    const pages = [
      read('services/sandbox/docs/incus.md'),
      ...['en', 'de', 'fr'].map((locale) =>
        read(
          `docs/${locale}/self-hosted/configuration/environment-reference.md`,
        ),
      ),
    ];
    for (const page of pages) {
      for (const name of SETTINGS) expect(page).toContain(`\`${name}\``);
    }
  });

  test('are read where the contract says: the two cache settings by the spawner, the list by the proxy', () => {
    const config = read(
      'services/sandbox/src/backend/incus/incus-registry-caches.ts',
    );
    expect(config).toContain("'SANDBOX_INCUS_NPM_REGISTRY'");
    expect(config).toContain("'SANDBOX_INCUS_PYPI_INDEX'");
    expect(read('services/sandbox-egress/entrypoint.sh')).toContain(
      '"$SANDBOX_EGRESS_DENIED_HOSTS"',
    );
  });
});

describe('the variables that carry the caches into a session', () => {
  test('are the ones the runtime entrypoint reads', () => {
    const entrypoint = read('services/sandbox-runtime/entrypoint.sh');
    for (const name of Object.values(REGISTRY_CACHE_ENV)) {
      expect(entrypoint).toContain(`"\${${name}:-}"`);
    }
  });
});
