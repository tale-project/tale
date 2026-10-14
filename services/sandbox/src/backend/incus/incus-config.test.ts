// The Incus settings: what they default to, what they require, and what they
// refuse, each in words that name the variable.

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_INCUS_DOCKER_CONFIG,
  readIncusConfig,
  type IncusConfigContext,
} from './incus-config.ts';

const CONTEXT: IncusConfigContext = {
  egressProxy: 'http://10.20.0.2:3128',
  maxSessions: 32,
};

const MINIMAL: Record<string, string> = {
  SANDBOX_INCUS_ENDPOINT: 'https://incus.example:8443',
  SANDBOX_INCUS_PROJECT: 'sandbox-pr',
  SANDBOX_INCUS_PROFILE: 'sandbox',
  SANDBOX_INCUS_NETWORK: 'sbx0',
  SANDBOX_INCUS_STORAGE_POOL: 'tank',
  SANDBOX_INCUS_IMAGE: 'tale-sandbox-runtime',
  SANDBOX_INCUS_CLIENT_CERT_FILE: '/run/incus/client.crt',
  SANDBOX_INCUS_CLIENT_KEY_FILE: '/run/incus/client.key',
  SANDBOX_INCUS_SERVER_CERT_FILE: '/run/incus/server.crt',
};

function read(
  extra: Record<string, string | undefined> = {},
  ctx: IncusConfigContext = CONTEXT,
) {
  return readIncusConfig({ ...MINIMAL, ...extra }, ctx);
}

function refusal(
  extra: Record<string, string | undefined>,
  ctx: IncusConfigContext = CONTEXT,
): string {
  try {
    read(extra, ctx);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('expected the config to be refused');
}

describe('a minimal setup', () => {
  test('reads, with the defaults it documents', () => {
    expect(read()).toEqual({
      config: {
        endpoint: 'https://incus.example:8443',
        project: 'sandbox-pr',
        profile: 'sandbox',
        network: 'sbx0',
        storagePool: 'tank',
        image: 'tale-sandbox-runtime',
        clientCertFile: '/run/incus/client.crt',
        clientKeyFile: '/run/incus/client.key',
        serverCertFile: '/run/incus/server.crt',
        poolSize: 0,
        workspaceSize: '10GiB',
        // The egress proxy's own address: the resolver the sandbox network
        // already serves its nested containers from.
        dns: ['10.20.0.2'],
        dockerConfig: DEFAULT_INCUS_DOCKER_CONFIG,
        allowUnfilteredNetwork: false,
        apiTimeoutMs: 15_000,
      },
      warnings: [],
    });
  });

  test('names every missing required variable at once', () => {
    const message = refusal({
      SANDBOX_INCUS_PROJECT: undefined,
      SANDBOX_INCUS_SERVER_CERT_FILE: '  ',
      SANDBOX_INCUS_IMAGE: '',
    });
    expect(message).toContain('SANDBOX_BACKEND=incus needs');
    expect(message).toContain('SANDBOX_INCUS_PROJECT');
    expect(message).toContain('SANDBOX_INCUS_SERVER_CERT_FILE');
    expect(message).toContain('SANDBOX_INCUS_IMAGE');
    expect(message).not.toContain('SANDBOX_INCUS_ENDPOINT');
  });
});

describe('the endpoint', () => {
  test('is reduced to its origin', () => {
    expect(
      read({ SANDBOX_INCUS_ENDPOINT: 'https://incus.example:8443/' }).config
        .endpoint,
    ).toBe('https://incus.example:8443');
  });

  test.each([
    'http://incus.example:8443',
    'incus.example:8443',
    'https://user:pass@incus.example:8443',
    'https://incus.example:8443/1.0',
    'https://incus.example:8443/?project=x',
    'not a url',
  ])('refuses %j', (endpoint) => {
    expect(refusal({ SANDBOX_INCUS_ENDPOINT: endpoint })).toContain(
      'SANDBOX_INCUS_ENDPOINT',
    );
  });
});

describe('names and paths', () => {
  test.each([
    'SANDBOX_INCUS_PROJECT',
    'SANDBOX_INCUS_PROFILE',
    'SANDBOX_INCUS_NETWORK',
    'SANDBOX_INCUS_STORAGE_POOL',
  ])('%s refuses what is no Incus name', (name) => {
    expect(refusal({ [name]: 'has space' })).toContain(name);
    expect(refusal({ [name]: '../escape' })).toContain(name);
  });

  test('an image alias may carry a path and a tag', () => {
    expect(
      read({ SANDBOX_INCUS_IMAGE: 'tale/sandbox-runtime:v0.5.77' }).config
        .image,
    ).toBe('tale/sandbox-runtime:v0.5.77');
    expect(refusal({ SANDBOX_INCUS_IMAGE: 'a b' })).toContain(
      'SANDBOX_INCUS_IMAGE',
    );
  });

  test.each([
    'SANDBOX_INCUS_CLIENT_CERT_FILE',
    'SANDBOX_INCUS_CLIENT_KEY_FILE',
    'SANDBOX_INCUS_SERVER_CERT_FILE',
  ])('%s must be an absolute path', (name) => {
    expect(refusal({ [name]: 'relative/client.crt' })).toContain(name);
  });
});

describe('the egress proxy', () => {
  test('must be an IPv4 literal: a session resolves nothing before it', () => {
    const message = refusal(
      {},
      { ...CONTEXT, egressProxy: 'http://sandbox-egress:3128' },
    );
    expect(message).toContain('SANDBOX_EGRESS_PROXY');
    expect(message).toContain('IPv4');
  });

  test('the resolver defaults to its address', () => {
    expect(
      read({}, { ...CONTEXT, egressProxy: 'http://10.147.28.9:3128' }).config
        .dns,
    ).toEqual(['10.147.28.9']);
  });
});

describe('the warm pool', () => {
  test('is sized from the environment', () => {
    expect(read({ SANDBOX_INCUS_POOL_SIZE: '4' }).config.poolSize).toBe(4);
  });

  test.each(['-1', '1.5', 'many', '257'])('refuses a size of %s', (size) => {
    expect(refusal({ SANDBOX_INCUS_POOL_SIZE: size })).toContain(
      'SANDBOX_INCUS_POOL_SIZE',
    );
  });

  test('cannot exceed the session capacity', () => {
    const message = refusal(
      { SANDBOX_INCUS_POOL_SIZE: '9' },
      { ...CONTEXT, maxSessions: 8 },
    );
    expect(message).toContain('SANDBOX_MAX_SESSIONS (8)');
    expect(
      read({ SANDBOX_INCUS_POOL_SIZE: '8' }, { ...CONTEXT, maxSessions: 8 })
        .config.poolSize,
    ).toBe(8);
  });
});

describe('sizes', () => {
  test('the workspace quota reads Docker quantities and Incus sizes', () => {
    expect(
      read({ SANDBOX_INCUS_WORKSPACE_SIZE: '20g' }).config.workspaceSize,
    ).toBe('20GiB');
    expect(
      read({ SANDBOX_INCUS_WORKSPACE_SIZE: '512MiB' }).config.workspaceSize,
    ).toBe('512MiB');
    expect(refusal({ SANDBOX_INCUS_WORKSPACE_SIZE: 'lots' })).toContain(
      'SANDBOX_INCUS_WORKSPACE_SIZE',
    );
    expect(refusal({ SANDBOX_INCUS_WORKSPACE_SIZE: '0' })).toContain(
      'SANDBOX_INCUS_WORKSPACE_SIZE',
    );
  });
});

describe('the resolver', () => {
  test('takes a list of IPv4 addresses', () => {
    expect(
      read({ SANDBOX_INCUS_DNS: '10.20.0.3, 10.20.0.4' }).config.dns,
    ).toEqual(['10.20.0.3', '10.20.0.4']);
  });

  test.each(['resolver.example', '10.20.0.3,', 'fd42::1', '10.20.0.300'])(
    'refuses %j',
    (dns) => {
      expect(refusal({ SANDBOX_INCUS_DNS: dns })).toContain(
        'SANDBOX_INCUS_DNS',
      );
    },
  );
});

describe('the image source', () => {
  test('splits an OCI reference into its registry and the rest', () => {
    expect(
      read({
        SANDBOX_INCUS_IMAGE_SOURCE:
          'ghcr.io/tale-project/tale-sandbox-runtime:v0.5.77',
      }).config.imageSource,
    ).toEqual({
      server: 'https://ghcr.io',
      alias: 'tale-project/tale-sandbox-runtime:v0.5.77',
    });
    expect(
      read({ SANDBOX_INCUS_IMAGE_SOURCE: 'registry.local:5000/runtime:1' })
        .config.imageSource,
    ).toEqual({ server: 'https://registry.local:5000', alias: 'runtime:1' });
  });

  test.each([
    'tale-project/runtime:v1',
    'ghcr.io',
    'ghcr.io/',
    'https://ghcr.io/x/y:1',
    'ghcr.io/has space',
  ])('refuses %j', (source) => {
    expect(refusal({ SANDBOX_INCUS_IMAGE_SOURCE: source })).toContain(
      'SANDBOX_INCUS_IMAGE_SOURCE',
    );
  });
});

describe('Docker inside', () => {
  test('takes a JSON object of the few keys it may set', () => {
    expect(
      read({
        SANDBOX_INCUS_DOCKER_CONFIG:
          '{"security.nesting":true,"security.syscalls.intercept.mknod":"true"}',
      }).config.dockerConfig,
    ).toEqual({
      'security.nesting': 'true',
      'security.syscalls.intercept.mknod': 'true',
    });
  });

  test('admits exactly the keys a restricted project can allow', () => {
    for (const key of [
      'security.nesting',
      'security.syscalls.intercept.bpf',
      'security.syscalls.intercept.bpf.devices',
      'security.syscalls.intercept.mknod',
      'security.syscalls.intercept.mount',
      'security.syscalls.intercept.mount.fuse',
      'security.syscalls.intercept.setxattr',
      'security.syscalls.intercept.sysinfo',
    ]) {
      expect(
        read({
          SANDBOX_INCUS_DOCKER_CONFIG: JSON.stringify({ [key]: 'false' }),
        }).config.dockerConfig,
      ).toEqual({ [key]: 'false' });
    }
  });

  test.each([
    ['{"security.privileged":"true"}', 'security.privileged'],
    ['{"raw.lxc":"lxc.cap.drop="}', 'raw.lxc'],
    // Low-level keys a restricted project forbids outright.
    ['{"security.idmap.size":"131072"}', 'security.idmap.size'],
    ['{"security.syscalls.intercept.mount.allowed":"ext4"}', 'mount.allowed'],
    [
      '{"security.syscalls.intercept.sched_setscheduler":"true"}',
      'sched_setscheduler',
    ],
    ['{"security.nesting":{"a":1}}', 'security.nesting'],
    ['{"security.nesting":"yes"}', 'true or false'],
    ['{"security.nesting":1}', 'true or false'],
    ['["security.nesting"]', 'JSON object'],
    ['not json', 'not valid JSON'],
  ])('refuses %j', (value, mention) => {
    const message = refusal({ SANDBOX_INCUS_DOCKER_CONFIG: value });
    expect(message).toContain('SANDBOX_INCUS_DOCKER_CONFIG');
    expect(message).toContain(mention);
  });
});

describe('the network', () => {
  test('may be left unfiltered for a lab, with a warning', () => {
    const { config, warnings } = read({
      SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK: 'true',
    });
    expect(config.allowUnfilteredNetwork).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('lab only');
  });
});

describe('the API timeout', () => {
  test('is bounded', () => {
    expect(
      read({ SANDBOX_INCUS_API_TIMEOUT_MS: '30000' }).config.apiTimeoutMs,
    ).toBe(30_000);
    expect(refusal({ SANDBOX_INCUS_API_TIMEOUT_MS: '10' })).toContain(
      'SANDBOX_INCUS_API_TIMEOUT_MS',
    );
    expect(refusal({ SANDBOX_INCUS_API_TIMEOUT_MS: 'slow' })).toContain(
      'SANDBOX_INCUS_API_TIMEOUT_MS',
    );
  });
});
