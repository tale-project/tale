import dns from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ProviderAddressRefused, providerLookup } from './dial.ts';
import { relayFetch } from './passthrough.ts';

type Answer = { address: string; family: number };

/** What the resolver answers for every name, for one test. */
function resolverAnswers(answers: Answer[]): void {
  vi.spyOn(dns, 'lookup').mockImplementation(((
    _hostname: string,
    _options: unknown,
    callback: (error: Error | null, found: Answer[]) => void,
  ) => {
    callback(null, answers);
  }) as unknown as typeof dns.lookup);
}

/** The dial's answer for `options`: the address(es), or the refusal. */
function dial(
  options: { all?: boolean } = {},
): Promise<{ error: Error | null; address: unknown; family: unknown }> {
  return new Promise((done) => {
    providerLookup('llm.example.com', options, (error, address, family) => {
      done({ error, address, family });
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The relay's dial to a provider (tale-project/tale#4942). */
describe('providerLookup', () => {
  it('connects to a public address the name resolves to', async () => {
    resolverAnswers([{ address: '203.0.113.7', family: 4 }]);
    await expect(dial()).resolves.toEqual({
      error: null,
      address: '203.0.113.7',
      family: 4,
    });
    await expect(dial({ all: true })).resolves.toMatchObject({
      error: null,
      address: [{ address: '203.0.113.7', family: 4 }],
    });
  });

  it('never connects to a cloud metadata address, whatever the operator admitted [RELAY-R10]', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    resolverAnswers([{ address: '169.254.169.254', family: 4 }]);
    const { error } = await dial();
    expect(error).toBeInstanceOf(ProviderAddressRefused);
    expect(error?.message).toContain('169.254.169.254');
  });

  it('connects to a private address only where private provider hosts are admitted [RELAY-R10]', async () => {
    resolverAnswers([{ address: '10.0.0.5', family: 4 }]);
    expect((await dial()).error).toBeInstanceOf(ProviderAddressRefused);
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    await expect(dial()).resolves.toMatchObject({
      error: null,
      address: '10.0.0.5',
    });
  });

  it('refuses a name that answers a private address beside a public one', async () => {
    resolverAnswers([
      { address: '203.0.113.7', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    expect((await dial({ all: true })).error).toBeInstanceOf(
      ProviderAddressRefused,
    );
  });

  it('passes on a resolver failure as it is', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _hostname: string,
      _options: unknown,
      callback: (error: Error | null) => void,
    ) => {
      callback(
        Object.assign(new Error('getaddrinfo ENOTFOUND'), {
          code: 'ENOTFOUND',
        }),
      );
    }) as unknown as typeof dns.lookup);
    const { error } = await dial();
    expect(error).not.toBeInstanceOf(ProviderAddressRefused);
    expect(error).toMatchObject({ code: 'ENOTFOUND' });
  });
});

describe("the relay's fetch dials through it", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.end('ok');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('refuses a name that resolves to the loopback unless private hosts are admitted [RELAY-R10]', async () => {
    resolverAnswers([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      relayFetch(`http://provider.example:${port}/v1/models`, {}),
    ).rejects.toMatchObject({
      cause: { code: 'EPROVIDERADDRESS' },
    });
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    const answer = await relayFetch(
      `http://provider.example:${port}/v1/models`,
      {},
    );
    expect(await answer.text()).toBe('ok');
  });
});
