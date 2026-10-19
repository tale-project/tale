// The registry cache settings: unset means nothing, a set value is held to what
// a session can reach and to what every package manager's file can carry, and
// what the instance is given from them is exactly the cache addresses.

import { describe, expect, test } from 'bun:test';

import { isIpv4Address } from '../../network-address.ts';
import {
  deniedRegistryHosts,
  describeRegistryCaches,
  readRegistryCaches,
  REGISTRY_CACHE_ENV,
  REGISTRY_HOSTS,
  registryCacheEnvironment,
  registryCacheHosts,
} from './incus-registry-caches.ts';

const NPM = 'http://10.200.41.8:4873/';
const PYPI = 'http://10.200.41.9:3141/root/pypi/+simple/';

function refusal(env: Record<string, string>): string {
  try {
    readRegistryCaches(env);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('expected the settings to be refused');
}

/** Whether the settings take this host, by the refusal's own message. */
function accepts(host: string): boolean {
  try {
    readRegistryCaches({ SANDBOX_INCUS_NPM_REGISTRY: `http://${host}/` });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('IPv4 address'))
      return false;
    throw error;
  }
}

describe('reading the settings', () => {
  test('nothing set, or only blanks, is no caches at all', () => {
    expect(readRegistryCaches({})).toBeUndefined();
    expect(
      readRegistryCaches({
        SANDBOX_INCUS_NPM_REGISTRY: '  ',
        SANDBOX_INCUS_PYPI_INDEX: '',
      }),
    ).toBeUndefined();
  });

  test('each cache stands alone', () => {
    expect(readRegistryCaches({ SANDBOX_INCUS_NPM_REGISTRY: NPM })).toEqual({
      npm: NPM,
    });
    expect(readRegistryCaches({ SANDBOX_INCUS_PYPI_INDEX: PYPI })).toEqual({
      pypi: PYPI,
    });
  });

  test('both are read as written, trimmed', () => {
    expect(
      readRegistryCaches({
        SANDBOX_INCUS_NPM_REGISTRY: ` ${NPM} `,
        SANDBOX_INCUS_PYPI_INDEX: PYPI,
      }),
    ).toEqual({ npm: NPM, pypi: PYPI });
  });

  test('an address without a path reads as its root, and the default port goes', () => {
    expect(
      readRegistryCaches({
        SANDBOX_INCUS_NPM_REGISTRY: 'http://10.200.41.8:4873',
      }),
    ).toEqual({ npm: NPM });
    expect(
      readRegistryCaches({
        SANDBOX_INCUS_NPM_REGISTRY: 'http://10.200.41.8:80/',
      }),
    ).toEqual({ npm: 'http://10.200.41.8/' });
  });

  test.each([
    ['a name', 'http://npm.cache.tale.internal:4873/'],
    ['a name that looks like an address', 'http://10.200.41.8.nip.io/'],
    ['TLS', 'https://10.200.41.8:4873/'],
    ['no scheme', '10.200.41.8:4873'],
    ['an address with leading zeros', 'http://010.200.41.8:4873/'],
    ['an address in hexadecimal', 'http://0xa.200.41.8:4873/'],
    ['an address of five parts', 'http://10.200.41.8.1:4873/'],
    ['credentials', 'http://user:secret@10.200.41.8:4873/'],
    ['a query', 'http://10.200.41.8:4873/?x=1'],
    ['a fragment', 'http://10.200.41.8:4873/#x'],
    ['a port past 65535', 'http://10.200.41.8:70000/'],
    ['port zero', 'http://10.200.41.8:0/'],
    ['a quote in the path', 'http://10.200.41.8:4873/a"b'],
    ['a space in the path', 'http://10.200.41.8:4873/a b'],
    ['a newline in the path', 'http://10.200.41.8:4873/a\nregistry=x'],
    ['a backslash', 'http://10.200.41.8:4873/a\\b'],
    ['a hash in the path', 'http://10.200.41.8:4873/a#b'],
    ['a semicolon', 'http://10.200.41.8:4873/a;b'],
    ['a dollar sign', 'http://10.200.41.8:4873/$HOME'],
    ['two values', 'http://10.200.41.8:4873/ http://10.200.41.9:3141/'],
  ])('refuses %s, naming the variable', (_what, value) => {
    for (const name of [
      'SANDBOX_INCUS_NPM_REGISTRY',
      'SANDBOX_INCUS_PYPI_INDEX',
    ]) {
      const message = refusal({ [name]: value });
      expect(message).toContain(`Env var ${name} must be an http URL`);
      expect(message).toContain('IPv4 address');
    }
  });
});

describe('the host of a cache', () => {
  test.each([
    '10.200.41.8',
    '0.0.0.0',
    '255.255.255.255',
    '256.0.0.1',
    '01.2.3.4',
    '1.2.3',
    '1.2.3.4.5',
    '1..2.3',
  ])('is judged as every other IPv4 address of the spawner is: %s', (host) => {
    expect(accepts(host)).toBe(isIpv4Address(host));
  });
});

describe('what the instance is given', () => {
  test('nothing for no caches', () => {
    expect(registryCacheEnvironment(undefined)).toEqual({});
    expect(registryCacheHosts(undefined)).toEqual([]);
    expect(deniedRegistryHosts(undefined)).toEqual([]);
  });

  test('the two addresses, for the entrypoint to write its files from', () => {
    expect(registryCacheEnvironment({ npm: NPM, pypi: PYPI })).toEqual({
      TALE_REGISTRY_CACHE_NPM: NPM,
      TALE_REGISTRY_CACHE_PYPI: PYPI,
    });
    expect(registryCacheEnvironment({ npm: NPM })).toEqual({
      [REGISTRY_CACHE_ENV.npm]: NPM,
    });
  });

  test('each cache host joins NO_PROXY once, without its port', () => {
    expect(registryCacheHosts({ npm: NPM, pypi: PYPI })).toEqual([
      '10.200.41.8',
      '10.200.41.9',
    ]);
    expect(
      registryCacheHosts({
        npm: 'http://10.200.41.8:4873/',
        pypi: 'http://10.200.41.8:3141/root/pypi/+simple/',
      }),
    ).toEqual(['10.200.41.8']);
  });

  test('the proxy is told to refuse the registries a configured cache replaces, and only those', () => {
    expect(deniedRegistryHosts({ npm: NPM })).toEqual([
      'registry.npmjs.org',
      'registry.yarnpkg.com',
    ]);
    expect(deniedRegistryHosts({ pypi: PYPI })).toEqual([
      'pypi.org',
      'files.pythonhosted.org',
    ]);
    expect(deniedRegistryHosts({ npm: NPM, pypi: PYPI })).toEqual([
      ...REGISTRY_HOSTS.npm,
      ...REGISTRY_HOSTS.pypi,
    ]);
  });

  test('the boot line names the caches and the proxy setting that goes with them', () => {
    const line = describeRegistryCaches({ npm: NPM, pypi: PYPI });
    expect(line).toContain(`npm ${NPM}`);
    expect(line).toContain(`pypi ${PYPI}`);
    expect(line).toContain(
      'SANDBOX_EGRESS_DENIED_HOSTS=registry.npmjs.org,registry.yarnpkg.com,pypi.org,files.pythonhosted.org',
    );
  });
});
