import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveHostAddresses } = vi.hoisted(() => ({
  resolveHostAddresses: vi.fn(),
}));

vi.mock('../../../../lib/net/safe-fetch', () => ({
  resolveHostAddresses,
}));

const ORG = 'org_1';
const PROVIDER = {
  name: 'openrouter',
  apiKey: 'key-A',
  models: ['anthropic/claude-sonnet-5'],
};
const KEY_NAME = `tale-${ORG}-openrouter`;

interface RecordedCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string>;
}

/**
 * Stub global fetch with a minimal management plane:
 *   GET  /api/providers/:p/keys        → the org's key (when `keyExists`)
 *   PUT  /api/providers/:p             → provider config (`configStatus`)
 *   POST /api/providers/:p/keys       → create key
 *   PUT  /api/providers/:p/keys/*     → rotate key
 *   POST /api/governance/virtual-keys → mint (returns id + value)
 *   GET  /api/config                  → current client_config
 *   GET  /api/providers[/:p]          → the provider records (`providerRecords`)
 * Returns the recorded calls, in order.
 */
function stubGateway(
  opts: {
    keyExists?: boolean;
    keyName?: string;
    writeStatus?: number;
    configStatus?: number;
    configBody?: string;
    clientConfig?: Record<string, unknown>;
    /** GET /api/config reports auth already enabled (a password is stored), so
     * applyGatewayConfig must PRESERVE it rather than re-send a plaintext one. */
    authEnabled?: boolean;
    /** The gateway stored the minted key WITHOUT its budget. */
    mintWithoutBudget?: boolean;
    /** The gateway refuses the mint with this status and body. */
    mintRefusal?: { status: number; body: string };
    /** Overrides `GET /api/governance/pricing-overrides` lists. */
    pricingOverrides?: Record<string, unknown>[];
    /** `POST /api/providers/:p/keys` answers the stored key under this id
     * (as the gateway does); otherwise an empty object. */
    createdKeyId?: string;
    /** `GET /api/providers` lists these provider records. */
    providerRecords?: Record<string, unknown>[];
  } = {},
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const u = String(url);
      calls.push({
        url: u,
        method,
        body:
          typeof init?.body === 'string'
            ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
              (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      if (method === 'GET' && u.includes('/keys')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              keys: opts.keyExists
                ? [{ id: 'kid-A', name: opts.keyName ?? KEY_NAME, models: [] }]
                : [],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === 'GET' && u.endsWith('/api/providers')) {
        const providers = opts.providerRecords ?? [];
        return Promise.resolve(
          new Response(JSON.stringify({ providers, total: providers.length }), {
            status: 200,
          }),
        );
      }
      if (
        method === 'GET' &&
        u.includes('/api/providers/') &&
        opts.providerRecords !== undefined
      ) {
        const name = decodeURIComponent(u.split('/api/providers/')[1] ?? '');
        const record = opts.providerRecords.find((r) => r.name === name);
        return Promise.resolve(
          record === undefined
            ? new Response('Provider not found', { status: 404 })
            : new Response(JSON.stringify(record), { status: 200 }),
        );
      }
      if (method === 'GET' && u.endsWith('/api/config')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              client_config: opts.clientConfig ?? {},
              ...(opts.authEnabled
                ? {
                    auth_config: {
                      is_enabled: true,
                      admin_username: { value: 'admin', type: 'plain_text' },
                      admin_password: { value: '<redacted>' },
                    },
                  }
                : {}),
            }),
            { status: 200 },
          ),
        );
      }
      if (method === 'POST' && u.includes('/governance/virtual-keys')) {
        if (opts.mintRefusal) {
          return Promise.resolve(
            new Response(opts.mintRefusal.body, {
              status: opts.mintRefusal.status,
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              virtual_key: {
                id: 'vk-1',
                value: 'sk-bf-x',
                budgets: opts.mintWithoutBudget ? [] : [{ id: 'budget-1' }],
              },
            }),
            { status: opts.writeStatus ?? 200 },
          ),
        );
      }
      if (
        method === 'POST' &&
        u.endsWith('/keys') &&
        opts.createdKeyId !== undefined
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: opts.createdKeyId,
              name: opts.keyName ?? KEY_NAME,
              value: '<redacted>',
            }),
            { status: 200 },
          ),
        );
      }
      if (method === 'GET' && u.includes('/governance/pricing-overrides')) {
        const overrides = opts.pricingOverrides ?? [];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              pricing_overrides: overrides,
              total_count: overrides.length,
            }),
            { status: 200 },
          ),
        );
      }
      if (method === 'PUT' && u.includes('/api/providers/')) {
        return Promise.resolve(
          new Response(opts.configBody ?? '{}', {
            status: opts.configStatus ?? opts.writeStatus ?? 200,
          }),
        );
      }
      return Promise.resolve(
        new Response('{}', { status: opts.writeStatus ?? 200 }),
      );
    }),
  );
  return calls;
}

/** Fresh module instance so the module-scoped fingerprint memo starts empty
 * (the "new Node process" state). */
async function loadModule() {
  vi.resetModules();
  return import('./llm_gateway_admin');
}

function writes(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.method !== 'GET');
}

/** Run `call` with the client's waits between repeats of a call the gateway
 * answered with a 5xx elapsed at once. */
async function withRetryWaitsElapsed<T>(call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const settled = call().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await settled;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } finally {
    vi.useRealTimers();
  }
}

// The management plane is fail-closed on the admin password; give every test a
// default so only the auth-specific cases below vary it.
const DEFAULT_PW = 'pw-test';
const basicFor = (pw: string) =>
  `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}`;

beforeEach(() => {
  vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', DEFAULT_PW);
  resolveHostAddresses.mockReset();
  resolveHostAddresses.mockResolvedValue([
    { address: '203.0.113.10', family: 4 },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('provisionProviders', () => {
  it('carries the freshly verified org key into its mint without a second listing', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    const keyIds = new Map<string, string>();
    const options = { provisionedKeys: { organizationId: ORG, keyIds } };
    expect(
      await mod.provisionProviders(ORG, [PROVIDER], {
        onProviderKey: (provider, keyId) => keyIds.set(provider, keyId),
      }),
    ).toEqual([]);
    await mod.mintVirtualKey(
      {
        organizationId: ORG,
        sessionId: 'verified-session',
        budgetCents: 100,
        allowedModels: [
          { providerSlug: PROVIDER.name, modelId: PROVIDER.models[0]! },
        ],
      },
      options,
    );
    expect(
      calls.filter(
        (call) => call.method === 'GET' && call.url.endsWith('/keys'),
      ),
    ).toHaveLength(1);
    expect(
      calls.find((call) => call.url.endsWith('/virtual-keys'))?.body
        ?.provider_configs,
    ).toMatchObject([{ key_ids: ['kid-A'] }]);
    // The request-owned map is scoped to the organization as well as record.
    await expect(
      mod.mintVirtualKey(
        {
          organizationId: 'other-org',
          sessionId: 'other-session',
          budgetCents: 100,
          allowedModels: [
            { providerSlug: PROVIDER.name, modelId: PROVIDER.models[0]! },
          ],
        },
        options,
      ),
    ).rejects.toThrow('provisioned keys belong to another organization');
  });

  it('coalesces simultaneous identical reconciliations and forgets them afterward', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await Promise.all(
      Array.from({ length: 5 }, () => mod.provisionProviders(ORG, [PROVIDER])),
    );
    expect(
      calls.filter(
        (call) => call.method === 'GET' && call.url.endsWith('/keys'),
      ),
    ).toHaveLength(1);
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(
      calls.filter(
        (call) => call.method === 'GET' && call.url.endsWith('/keys'),
      ),
    ).toHaveLength(2);
  });

  it('creates an absent org key: config PUT + key POST with the stable per-org name and the catalog model ids as-is', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);

    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({
      method: 'PUT',
      url: expect.stringContaining('/api/providers/openrouter'),
    });
    expect(w[1]).toMatchObject({
      method: 'POST',
      url: expect.stringContaining('/api/providers/openrouter/keys'),
    });
    expect(w[1]?.body).toMatchObject({
      name: KEY_NAME,
      value: 'key-A',
      models: ['anthropic/claude-sonnet-5'],
      weight: 1,
    });
  });

  it('rotates a present org key with PUT to /keys/:id (not POST)', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);

    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({
      method: 'PUT',
      url: expect.stringContaining('/api/providers/openrouter/keys/kid-A'),
    });
  });

  it('skips entirely when the key exists and the fingerprint matches (one GET, no writes)', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);
    calls.length = 0;
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
  });

  it('rewrites when the gateway lost the key even though the memo matches', async () => {
    stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);
    vi.unstubAllGlobals();
    const second = stubGateway({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(writes(second)).toHaveLength(2);
  });

  it('rewrites when the key rotates', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);
    calls.length = 0;
    await mod.provisionProviders(ORG, [{ ...PROVIDER, apiKey: 'key-B' }]);
    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[1]?.body).toMatchObject({ value: 'key-B' });
  });

  it('a failed write warns, RETURNS the failure and leaves no memo (no throw), so the next provision retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubGateway({ keyExists: false, writeStatus: 500 });
    const mod = await loadModule();
    const failures = await withRetryWaitsElapsed(() =>
      mod.provisionProviders(ORG, [PROVIDER]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.name).toBe('openrouter');
    expect(String(failures[0]?.error)).toContain(
      'llm-gateway provider config openrouter failed (500)',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("provisioning provider 'openrouter'"),
      expect.anything(),
    );
    vi.unstubAllGlobals();
    const retry = stubGateway({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(writes(retry)).toHaveLength(2);
  });

  it('adds OpenRouter attribution extra_headers, and none for other providers', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      PROVIDER,
      { name: 'anthropic', apiKey: 'key-C', models: ['claude-fable-5'] },
    ]);
    const configPuts = writes(calls).filter((c) => !c.url.includes('/keys'));
    const openrouterPut = configPuts.find((c) =>
      c.url.endsWith('/api/providers/openrouter'),
    );
    const anthropicPut = configPuts.find((c) =>
      c.url.endsWith('/api/providers/anthropic'),
    );
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const orNetwork = openrouterPut?.body?.network_config as Record<
      string,
      unknown
    >;
    expect(orNetwork.extra_headers).toEqual({
      'HTTP-Referer': 'https://tale.dev',
      'X-Title': 'Tale',
    });
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const anNetwork = anthropicPut?.body?.network_config as Record<
      string,
      unknown
    >;
    expect(anNetwork.extra_headers).toBeUndefined();
  });

  it('two orgs coexist under one provider (distinct per-org key names)', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders('org_1', [PROVIDER]);
    await mod.provisionProviders('org_2', [PROVIDER]);
    const keyPosts = writes(calls).filter((c) => c.url.includes('/keys'));
    expect(keyPosts.map((c) => c.body?.name)).toEqual([
      'tale-org_1-openrouter',
      'tale-org_2-openrouter',
    ]);
  });

  it('provisions a custom (non-standard) provider as OpenAI-compatible with base_url + custom_provider_config', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      {
        name: 'my-vllm',
        baseUrl: 'https://llm.example.com/v1',
        apiKey: 'key-D',
        models: ['llama-3.3-70b'],
      },
    ]);
    const configPut = writes(calls)[0];
    expect(configPut?.url).toContain('/api/providers/my-vllm');
    expect(configPut?.body).toMatchObject({
      network_config: expect.objectContaining({
        base_url: 'https://llm.example.com/v1',
      }),
      custom_provider_config: {
        base_provider_type: 'openai',
        allowed_requests: {
          chat_completion: true,
          chat_completion_stream: true,
        },
        request_path_overrides: {
          chat_completion: '/chat/completions',
          chat_completion_stream: '/chat/completions',
        },
      },
    });
  });

  it('preserves a non-/v1 version path and strips only a trailing slash', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      {
        name: 'bigmodel',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        apiKey: 'key-E',
        models: ['glm-5'],
      },
    ]);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const network = writes(calls)[0]?.body?.network_config as Record<
      string,
      unknown
    >;
    expect(network.base_url).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  it('admits a private self-hosted upstream to the gateway only with the operator opt-in', async () => {
    // The gateway refuses a private base_url by default ("Invalid base URL:
    // private IP addresses are not allowed") and resolves the host first, so
    // a LAN hostname is refused too. `allow_private_network` lifts it for the
    // providers TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 already admitted.
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      {
        name: 'selfhosted',
        baseUrl: 'http://172.21.255.254:8081/inference/reasoning/v1',
        apiKey: 'key-P',
        models: ['glm-5.3'],
      },
    ]);
    expect(writes(calls)[0]?.body).toMatchObject({
      network_config: expect.objectContaining({
        base_url: 'http://172.21.255.254:8081/inference/reasoning/v1',
        allow_private_network: true,
      }),
    });
  });

  it.each(['llm.internal', 'ollama', 'models.example.com'])(
    'admits HTTPS hostname %s resolving privately with the operator opt-in',
    async (hostname) => {
      vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
      resolveHostAddresses.mockResolvedValue([
        { address: '172.21.255.254', family: 4 },
      ]);
      const calls = stubGateway();
      const mod = await loadModule();
      expect(
        await mod.provisionProviders(ORG, [
          {
            name: 'selfhosted',
            baseUrl: `https://${hostname}/v1`,
            apiKey: 'key-P',
            models: ['m-1'],
          },
        ]),
      ).toEqual([]);
      expect(writes(calls)[0]?.body).toMatchObject({
        network_config: {
          base_url: `https://${hostname}/v1`,
          allow_private_network: true,
        },
      });
    },
  );

  it('refuses a private upstream before gateway I/O without the opt-in', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    const failures = await mod.provisionProviders(ORG, [
      {
        name: 'selfhosted',
        baseUrl: 'http://172.21.255.254:8081/v1',
        apiKey: 'key-Q',
        models: ['glm-5.3'],
      },
    ]);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error)).toContain('PRIVATE_HOST_BLOCKED');
    expect(calls).toHaveLength(0);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://[fd00:ec2::254]/latest/meta-data',
    'http://100.100.100.200/latest/meta-data',
    'https://192.0.0.192/opc/v1',
    'https://metadata.google.internal./computeMetadata/v1',
  ])(
    'refuses metadata endpoint %s even with the private-network opt-in',
    async (baseUrl) => {
      vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const calls = stubGateway({ keyExists: false });
      const mod = await loadModule();
      const failures = await mod.provisionProviders(ORG, [
        {
          name: 'selfhosted',
          baseUrl,
          apiKey: 'key-P',
          models: ['m-1'],
        },
      ]);
      expect(failures).toHaveLength(1);
      expect(String(failures[0]?.error)).toContain('BLOCKED_HOST');
      expect(calls).toHaveLength(0);
    },
  );

  it('rechecks the host policy before reusing a provisioned private upstream', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubGateway({
      keyExists: true,
      keyName: `tale-${ORG}-selfhosted`,
    });
    const mod = await loadModule();
    const provider = {
      ...PROVIDER,
      name: 'selfhosted',
      baseUrl: 'http://127.0.0.1:8081/v1',
    };
    expect(await mod.provisionProviders(ORG, [provider])).toEqual([]);
    calls.length = 0;
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
    const failures = await mod.provisionProviders(ORG, [provider]);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error)).toContain('PRIVATE_HOST_BLOCKED');
    expect(calls).toHaveLength(0);
  });

  it('refuses a DNS-resolved private upstream without the opt-in before gateway I/O', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveHostAddresses.mockResolvedValue([
      { address: '192.168.1.20', family: 4 },
    ]);
    const calls = stubGateway();
    const mod = await loadModule();
    const failures = await mod.provisionProviders(ORG, [
      {
        ...PROVIDER,
        name: 'local-models',
        baseUrl: 'https://models.example.com/v1',
      },
    ]);
    expect(String(failures[0]?.error)).toContain('PRIVATE_HOST_BLOCKED');
    expect(calls).toEqual([]);
  });

  it.each([
    '169.254.169.254',
    'fd00:ec2::254',
    '100.100.100.200',
    '192.0.0.192',
  ])(
    'refuses any metadata DNS answer %s even beside a public address and with opt-in',
    async (address) => {
      vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      resolveHostAddresses.mockResolvedValue([
        { address: '203.0.113.10', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      const calls = stubGateway();
      const mod = await loadModule();
      const failures = await mod.provisionProviders(ORG, [
        {
          ...PROVIDER,
          name: 'local-models',
          baseUrl: 'https://models.example.com/v1',
        },
      ]);
      expect(String(failures[0]?.error)).toContain('BLOCKED_HOST');
      expect(calls).toEqual([]);
    },
  );

  it('refreshes private/public DNS policy for a memoized hostname and rejects later metadata', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubGateway({
      keyExists: true,
      keyName: `tale-${ORG}-local-models`,
    });
    const mod = await loadModule();
    const provider = {
      ...PROVIDER,
      name: 'local-models',
      baseUrl: 'https://models.example.com/v1',
    };
    expect(await mod.provisionProviders(ORG, [provider])).toEqual([]);
    calls.length = 0;
    resolveHostAddresses.mockResolvedValue([
      { address: '192.168.1.20', family: 4 },
    ]);
    expect(await mod.provisionProviders(ORG, [provider])).toEqual([]);
    expect(writes(calls)[0]?.body).toMatchObject({
      network_config: { allow_private_network: true },
    });
    calls.length = 0;
    resolveHostAddresses.mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
    ]);
    expect(await mod.provisionProviders(ORG, [provider])).toEqual([]);
    expect(writes(calls)[0]?.body).toMatchObject({
      network_config: { base_url: provider.baseUrl },
    });
    // Bifrost v1.5.13 replaces NetworkConfig from the PUT payload; an
    // omitted boolean therefore resets to false instead of retaining true.
    expect(writes(calls)[0]?.body?.network_config).not.toHaveProperty(
      'allow_private_network',
    );
    calls.length = 0;
    resolveHostAddresses.mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ]);
    const failures = await mod.provisionProviders(ORG, [provider]);
    expect(String(failures[0]?.error)).toContain('BLOCKED_HOST');
    expect(calls).toEqual([]);
  });

  it('does not provision a hostname that resolves to no addresses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveHostAddresses.mockResolvedValue([]);
    const calls = stubGateway();
    const mod = await loadModule();
    const failures = await mod.provisionProviders(ORG, [
      {
        ...PROVIDER,
        name: 'local-models',
        baseUrl: 'https://models.example.com/v1',
      },
    ]);
    expect(String(failures[0]?.error)).toContain('did not resolve');
    expect(calls).toEqual([]);
  });

  it('never sends allow_private_network for a public upstream', async () => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      {
        name: 'publichost',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'key-R',
        models: ['m-1'],
      },
    ]);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const network = writes(calls)[0]?.body?.network_config as Record<
      string,
      unknown
    >;
    expect(network).not.toHaveProperty('allow_private_network');
  });

  it('provisions an apiFormat:"anthropic" custom provider with base_provider_type anthropic, no allowed_requests, un-stripped base_url', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      {
        name: 'deepseek-anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiFormat: 'anthropic',
        apiKey: 'key-F',
        models: ['deepseek-v4-flash'],
      },
    ]);
    expect(writes(calls)[0]?.body).toMatchObject({
      network_config: expect.objectContaining({
        base_url: 'https://api.deepseek.com/anthropic',
      }),
      custom_provider_config: { base_provider_type: 'anthropic' },
    });
  });

  it('deletes + recreates a custom provider when the immutable base_provider_type must change', async () => {
    const calls: RecordedCall[] = [];
    let configPuts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        calls.push({
          url: u,
          method,
          body:
            typeof init?.body === 'string'
              ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
                (JSON.parse(init.body) as Record<string, unknown>)
              : undefined,
          headers: {},
        });
        if (method === 'GET' && u.includes('/keys')) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [] }), { status: 200 }),
          );
        }
        if (method === 'PUT' && !u.includes('/keys')) {
          configPuts += 1;
          // First PUT hits the immutable-field 400; the post-delete retry
          // succeeds.
          return Promise.resolve(
            configPuts === 1
              ? new Response(
                  'base_provider_type cannot be changed from openai to anthropic after creation',
                  { status: 400 },
                )
              : new Response('{}', { status: 200 }),
          );
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    const mod = await loadModule();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mod.provisionProviders(ORG, [
      {
        name: 'flippy',
        baseUrl: 'https://x.example.com/anthropic',
        apiFormat: 'anthropic',
        apiKey: 'key-G',
        models: ['m'],
      },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recreating'));
    const sequence = writes(calls).map((c) => `${c.method} ${c.url}`);
    expect(sequence[0]).toContain('PUT');
    expect(sequence[1]).toMatch(/DELETE .*\/api\/providers\/flippy$/);
    expect(sequence[2]).toContain('PUT');
    // After a recreate the key row died with the record — a POST, never a
    // stale-id PUT.
    expect(sequence[3]).toMatch(/POST .*\/keys$/);
  });

  it('treats a gateway standard provider natively — no base_url, no custom_provider_config', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      {
        name: 'fireworks',
        baseUrl: 'https://api.fireworks.ai/inference/v1',
        apiKey: 'key-H',
        models: ['llama-v3'],
      },
    ]);
    const body = writes(calls)[0]?.body;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const network = body?.network_config as Record<string, unknown>;
    expect(network.base_url).toBeUndefined();
    expect(body?.custom_provider_config).toBeUndefined();
  });

  it('one failing provider does not abort the reconcile (others still provision)', async () => {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        calls.push({ url: u, method, body: undefined, headers: {} });
        if (method === 'GET' && u.includes('/keys')) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [] }), { status: 200 }),
          );
        }
        // Config PUTs for the "broken" provider fail; everything else is ok.
        if (u.includes('/api/providers/broken')) {
          return Promise.resolve(new Response('nope', { status: 500 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
    await withRetryWaitsElapsed(() =>
      mod.provisionProviders(ORG, [
        {
          name: 'broken',
          baseUrl: 'https://b.example.com/v1',
          apiKey: 'x',
          models: ['m'],
        },
        PROVIDER,
      ]),
    );
    const keyWrites = calls.filter(
      (c) => c.method === 'POST' && c.url.includes('openrouter/keys'),
    );
    expect(keyWrites).toHaveLength(1);
  });

  it('skips a custom provider with no base URL (warns, no gateway calls)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubGateway({});
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [
      { name: 'no-base', apiKey: 'x', models: ['m'] },
    ]);
    expect(calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("skipping custom provider 'no-base'"),
    );
  });
});

describe('provisionProviders — request workers per provider record', () => {
  const CUSTOM = {
    name: 'org_1__my-vllm__llama-3.3-70b',
    baseUrl: 'https://llm.example.com/v1',
    apiKey: 'key-D',
    models: ['llama-3.3-70b'],
  };

  /** The pool each provider record's config PUT carried, by record name. */
  function pools(calls: RecordedCall[]): Record<string, unknown> {
    return Object.fromEntries(
      writes(calls)
        .filter((c) => c.method === 'PUT' && !c.url.includes('/keys'))
        .map((c) => [
          decodeURIComponent(c.url.split('/api/providers/')[1] ?? ''),
          c.body?.concurrency_and_buffer_size,
        ]),
    );
  }

  it('gives a shared standard record 512 workers and an org-scoped custom record 64, each with a queue 16 deep per worker', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    // A standard connector on the Anthropic lane rides an org-scoped record
    // of its own, so it is sized like any other custom record.
    const lane = mod.resolveGatewayRouting(ORG, 'openrouter', 'm', {
      anthropicHarnessLane: true,
    }).gatewayProvider;
    expect(
      await mod.provisionProviders(ORG, [
        PROVIDER,
        CUSTOM,
        {
          name: lane,
          baseUrl: 'https://openrouter.ai/api',
          apiFormat: 'anthropic',
          apiKey: 'key-A',
          models: ['m'],
        },
      ]),
    ).toEqual([]);
    expect(pools(calls)).toEqual({
      openrouter: { concurrency: 512, buffer_size: 8192 },
      [CUSTOM.name]: { concurrency: 64, buffer_size: 1024 },
      [lane]: { concurrency: 64, buffer_size: 1024 },
    });
  });

  it('takes each kind of record’s worker count from its own setting', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_PROVIDER_CONCURRENCY', '200');
    vi.stubEnv('SANDBOX_LLM_GATEWAY_CUSTOM_PROVIDER_CONCURRENCY', ' 8 ');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER, CUSTOM]);
    expect(pools(calls)).toEqual({
      openrouter: { concurrency: 200, buffer_size: 3200 },
      [CUSTOM.name]: { concurrency: 8, buffer_size: 128 },
    });
  });

  it.each(['0', '-4', '1.5', 'many'])(
    'keeps the default for a setting of %j, which the gateway would refuse, and says so once',
    async (setting) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubEnv('SANDBOX_LLM_GATEWAY_CUSTOM_PROVIDER_CONCURRENCY', setting);
      const calls = stubGateway({ keyExists: false });
      const mod = await loadModule();
      await mod.provisionProviders(ORG, [CUSTOM]);
      await mod.provisionProviders('org_2', [CUSTOM]);
      expect(Object.values(pools(calls))).toEqual([
        { concurrency: 64, buffer_size: 1024 },
      ]);
      expect(
        warn.mock.calls.filter(([message]) =>
          String(message).includes(
            `SANDBOX_LLM_GATEWAY_CUSTOM_PROVIDER_CONCURRENCY=${setting} is not a positive whole number; using 64`,
          ),
        ),
      ).toHaveLength(1);
    },
  );

  it('holds a record to the 5,000 connections the gateway opens to one upstream host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SANDBOX_LLM_GATEWAY_PROVIDER_CONCURRENCY', '20000');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(pools(calls)).toEqual({
      openrouter: { concurrency: 5000, buffer_size: 80_000 },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'SANDBOX_LLM_GATEWAY_PROVIDER_CONCURRENCY=20000 is above',
      ),
    );
  });

  it('rewrites a provisioned record whose pool was resized, so the gateway restarts its workers at the new count', async () => {
    const calls = stubGateway({
      keyExists: true,
      keyName: `tale-${ORG}-${CUSTOM.name}`,
    });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [CUSTOM]);
    calls.length = 0;
    await mod.provisionProviders(ORG, [CUSTOM]);
    expect(writes(calls)).toEqual([]);

    vi.stubEnv('SANDBOX_LLM_GATEWAY_CUSTOM_PROVIDER_CONCURRENCY', '16');
    await mod.provisionProviders(ORG, [CUSTOM]);
    expect(pools(calls)).toEqual({
      [CUSTOM.name]: { concurrency: 16, buffer_size: 256 },
    });
    expect(writes(calls)).toHaveLength(2);
  });
});

describe('shrinkProviderPools — records no provision rewrites', () => {
  const CUSTOM_NAME = 'org_9__my-vllm__llama-3.3-70b';
  const CUSTOM_UPSTREAM = {
    base_provider_type: 'openai',
    allowed_requests: { chat_completion: true, chat_completion_stream: true },
    request_path_overrides: {
      chat_completion: '/chat/completions',
      chat_completion_stream: '/chat/completions',
    },
  };
  const CUSTOM_NETWORK = {
    base_url: 'https://llm.example.com/v1',
    default_request_timeout_in_seconds: 600,
    stream_idle_timeout_in_seconds: 600,
    allow_private_network: true,
  };
  /** A custom record stored with the gateway's former 1,000-worker pool, as
   * `GET /api/providers` lists it: masked proxy secrets and status fields
   * beside the config. */
  const STALE_CUSTOM = {
    name: CUSTOM_NAME,
    network_config: CUSTOM_NETWORK,
    concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 },
    proxy_config: { type: 'http', url: '<redacted>' },
    send_back_raw_request: false,
    send_back_raw_response: false,
    store_raw_request_response: false,
    custom_provider_config: CUSTOM_UPSTREAM,
    provider_status: 'active',
    config_hash: 'hash-1',
  };
  const STALE_STANDARD = {
    name: 'openai',
    network_config: {
      default_request_timeout_in_seconds: 600,
      stream_idle_timeout_in_seconds: 600,
    },
    concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 },
    proxy_config: null,
    send_back_raw_request: true,
    send_back_raw_response: false,
    store_raw_request_response: false,
    provider_status: 'active',
  };
  const SIZED_CUSTOM = {
    name: 'org_9__my-vllm__qwen-3',
    network_config: CUSTOM_NETWORK,
    concurrency_and_buffer_size: { concurrency: 64, buffer_size: 1024 },
    custom_provider_config: CUSTOM_UPSTREAM,
    provider_status: 'active',
  };

  /** The provider-record writes, by record name, with what each carried. */
  function recordWrites(calls: RecordedCall[]): [string, unknown][] {
    return calls
      .filter(
        (c) =>
          c.method === 'PUT' &&
          c.url.includes('/api/providers/') &&
          !c.url.includes('/keys'),
      )
      .map((c) => [
        decodeURIComponent(c.url.split('/api/providers/')[1] ?? ''),
        c.body,
      ]);
  }

  /**
   * A gateway whose `GET /api/providers` lists `listing` while
   * `GET /api/providers/:name` answers the record from `current` (by
   * default the listing itself; 404 for a name `current` lacks), and whose
   * record PUTs succeed except for the `refuse`d name.
   */
  function stubRecords(
    listing: Record<string, unknown>[],
    opts: { current?: Record<string, unknown>[]; refuse?: string } = {},
  ): RecordedCall[] {
    const calls: RecordedCall[] = [];
    const current = opts.current ?? listing;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        calls.push({
          url: u,
          method,
          body:
            typeof init?.body === 'string'
              ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
                (JSON.parse(init.body) as Record<string, unknown>)
              : undefined,
          headers: {},
        });
        const name = decodeURIComponent(u.split('/api/providers/')[1] ?? '');
        if (method === 'GET' && u.endsWith('/api/providers')) {
          return Promise.resolve(
            new Response(JSON.stringify({ providers: listing }), {
              status: 200,
            }),
          );
        }
        if (method === 'GET') {
          const record = current.find((r) => r.name === name);
          return Promise.resolve(
            record === undefined
              ? new Response('Provider not found', { status: 404 })
              : new Response(JSON.stringify(record), { status: 200 }),
          );
        }
        return Promise.resolve(
          name === opts.refuse
            ? new Response('Invalid base URL', { status: 400 })
            : new Response('{}', { status: 200 }),
        );
      }),
    );
    return calls;
  }

  /**
   * A gateway whose `GET /api/providers` lists `listing` and which hands
   * every other call to `answer`, with its method, the path under
   * `/api/providers/` and its body.
   */
  function stubPass(
    listing: Record<string, unknown>[],
    answer: (
      method: string,
      name: string,
      body: Record<string, unknown> | undefined,
    ) => Response | Promise<Response>,
  ): RecordedCall[] {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        const body =
          typeof init?.body === 'string'
            ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
              (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        calls.push({ url: u, method, body, headers: {} });
        if (method === 'GET' && u.endsWith('/api/providers')) {
          return Response.json({ providers: listing });
        }
        return answer(
          method,
          decodeURIComponent(u.split('/api/providers/')[1] ?? ''),
          body,
        );
      }),
    );
    return calls;
  }

  const TIMED_OUT = (): Promise<Response> =>
    Promise.reject(
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    );

  it('writes each oversized record back with its kind’s pool and its own network and upstream config', async () => {
    const calls = stubGateway({
      providerRecords: [STALE_STANDARD, STALE_CUSTOM, SIZED_CUSTOM],
    });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(recordWrites(calls)).toEqual([
      [
        'openai',
        {
          concurrency_and_buffer_size: { concurrency: 512, buffer_size: 8192 },
          network_config: STALE_STANDARD.network_config,
          send_back_raw_request: true,
          send_back_raw_response: false,
          store_raw_request_response: false,
        },
      ],
      [
        CUSTOM_NAME,
        {
          concurrency_and_buffer_size: { concurrency: 64, buffer_size: 1024 },
          network_config: CUSTOM_NETWORK,
          custom_provider_config: CUSTOM_UPSTREAM,
          send_back_raw_request: false,
          send_back_raw_response: false,
          store_raw_request_response: false,
        },
      ],
    ]);
  });

  it('lists once per process', async () => {
    const calls = stubGateway({ providerRecords: [STALE_CUSTOM] });
    const mod = await loadModule();
    await Promise.all([mod.shrinkProviderPools(), mod.shrinkProviderPools()]);
    await mod.shrinkProviderPools();
    expect(calls.filter((c) => c.url.endsWith('/api/providers'))).toHaveLength(
      1,
    );
    expect(recordWrites(calls)).toHaveLength(1);
  });

  it('starts a scheduled pass two to five minutes later, at a moment drawn at random, and only once', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const calls = stubGateway({ providerRecords: [STALE_CUSTOM] });
    const mod = await loadModule();
    const listings = () =>
      calls.filter((c) => c.url.endsWith('/api/providers')).length;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mod.scheduleProviderPoolShrink();
      mod.scheduleProviderPoolShrink();
      // 2 minutes, plus half of the 3-minute spread.
      await vi.advanceTimersByTimeAsync(210_000 - 1);
      expect(listings()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(listings()).toBe(1);
      await vi.advanceTimersByTimeAsync(600_000);
      mod.scheduleProviderPoolShrink();
      await vi.advanceTimersByTimeAsync(600_000);
    } finally {
      vi.useRealTimers();
    }
    expect(listings()).toBe(1);
    expect(recordWrites(calls).map(([name]) => name)).toEqual([CUSTOM_NAME]);
  });

  it('schedules the pass again at the next call when its listing failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let listings = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        listings += 1;
        return listings <= 4
          ? new Response('down', { status: 503 })
          : Response.json({ providers: [] });
      }),
    );
    const mod = await loadModule();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mod.scheduleProviderPoolShrink();
      await vi.advanceTimersByTimeAsync(130_000);
      expect(listings).toBe(4);
      mod.scheduleProviderPoolShrink();
      await vi.advanceTimersByTimeAsync(120_000 - 1);
      expect(listings).toBe(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(listings).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists again at the next call when the listing failed, and never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('down', { status: 503 }))),
    );
    const mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.shrinkProviderPools()),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('trying again at the next provision'),
      expect.any(Error),
    );

    vi.unstubAllGlobals();
    const calls = stubGateway({ providerRecords: [STALE_CUSTOM] });
    await mod.shrinkProviderPools();
    expect(recordWrites(calls).map(([name]) => name)).toEqual([CUSTOM_NAME]);
  });

  it('goes on past a record the gateway refuses, which keeps its pool, and never suggests deleting a built-in provider’s shared record', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const calls = stubRecords([STALE_STANDARD, STALE_CUSTOM], {
      refuse: 'openai',
    });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(recordWrites(calls).map(([name]) => name)).toEqual([
      'openai',
      CUSTOM_NAME,
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[llm-gateway] resizing provider 'openai' to 512 workers failed (400): Invalid base URL; it keeps its workers",
    );
    expect(info).toHaveBeenCalledWith(
      '[llm-gateway] provider worker resize finished: 1 resized, 1 refused, 0 unconfirmed',
    );
  });

  it('tells how to clear a record the gateway refuses because its upstream host no longer resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    stubPass([STALE_CUSTOM], (method) =>
      method === 'GET'
        ? Response.json(STALE_CUSTOM)
        : new Response(
            'Invalid base URL: failed to resolve hostname llm.example.com',
            { status: 400 },
          ),
    );
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(warn).toHaveBeenCalledWith(
      `[llm-gateway] resizing provider '${CUSTOM_NAME}' to 64 workers failed (400): Invalid base URL: failed to resolve hostname llm.example.com; it keeps its workers. If its upstream is gone for good, delete it from the gateway (DELETE /api/providers/${CUSTOM_NAME}): a provision sets up a record still in use again`,
    );
  });

  it('logs the end of a pass with its counts even when it resized nothing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    stubGateway({ providerRecords: [SIZED_CUSTOM] });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(info).toHaveBeenCalledWith(
      '[llm-gateway] provider worker resize finished: 0 resized, 0 refused, 0 unconfirmed',
    );
  });

  it('gives a resize 30 s, and counts one the gateway stored but answered too late as resized, from the record read back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const bounds = vi.spyOn(AbortSignal, 'timeout');
    let stored: Record<string, unknown> = STALE_CUSTOM;
    stubPass([STALE_CUSTOM], (method, _name, body) => {
      if (method === 'GET') return Response.json(stored);
      stored = {
        ...stored,
        concurrency_and_buffer_size: body?.concurrency_and_buffer_size,
      };
      return TIMED_OUT();
    });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(bounds.mock.calls.map(([ms]) => ms)).toEqual([
      15_000, 15_000, 30_000, 15_000,
    ]);
    expect(warn).toHaveBeenCalledWith(
      `[llm-gateway] resizing provider '${CUSTOM_NAME}' to 64 workers failed; reading it back:`,
      expect.any(DOMException),
    );
    expect(info).toHaveBeenCalledWith(
      '[llm-gateway] provider worker resize finished: 1 resized, 0 refused, 0 unconfirmed',
    );
  });

  it('counts a resize as unconfirmed when the gateway failed it and the record read back keeps its old pool', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    stubPass([STALE_STANDARD, STALE_CUSTOM], (method, name) => {
      if (method === 'GET') {
        return Response.json(name === 'openai' ? STALE_STANDARD : STALE_CUSTOM);
      }
      return name === 'openai'
        ? TIMED_OUT()
        : new Response('upstream gone', { status: 503 });
    });
    const mod = await loadModule();
    await withRetryWaitsElapsed(() => mod.shrinkProviderPools());
    expect(info).toHaveBeenCalledWith(
      '[llm-gateway] provider worker resize finished: 0 resized, 0 refused, 2 unconfirmed',
    );
  });

  it('never sends a resize again to a record deleted while the gateway’s store turned the write away, since a PUT would create it anew', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    let deleted = false;
    const calls = stubPass([STALE_CUSTOM], (method) => {
      if (method === 'GET') {
        return deleted
          ? new Response('Provider not found', { status: 404 })
          : Response.json(STALE_CUSTOM);
      }
      deleted = true;
      return new Response(
        '{"error":{"message":"failed to update: database is locked"}}',
        { status: 500 },
      );
    });
    const mod = await loadModule();
    await withRetryWaitsElapsed(() => mod.shrinkProviderPools());
    expect(recordWrites(calls)).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(
      '[llm-gateway] provider worker resize finished: 0 resized, 0 refused, 0 unconfirmed',
    );
  });

  it('sends a resize the gateway’s store turned away again with the record as it reads after the wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const newer = {
      ...STALE_CUSTOM,
      network_config: {
        ...CUSTOM_NETWORK,
        base_url: 'https://llm-new.example.com/v1',
      },
    };
    let puts = 0;
    const calls = stubPass([STALE_CUSTOM], (method) => {
      if (method === 'GET')
        return Response.json(puts === 0 ? STALE_CUSTOM : newer);
      puts += 1;
      return puts === 1
        ? new Response(
            '{"error":{"message":"failed to update: database is locked"}}',
            { status: 500 },
          )
        : Response.json({});
    });
    const mod = await loadModule();
    await withRetryWaitsElapsed(() => mod.shrinkProviderPools());
    expect(recordWrites(calls)).toEqual([
      [
        CUSTOM_NAME,
        expect.objectContaining({ network_config: CUSTOM_NETWORK }),
      ],
      [
        CUSTOM_NAME,
        expect.objectContaining({ network_config: newer.network_config }),
      ],
    ]);
    expect(info).toHaveBeenCalledWith(
      '[llm-gateway] provider worker resize finished: 1 resized, 0 refused, 0 unconfirmed',
    );
  });

  it('leaves a record a provision of this process starts on while the pass reads it, and the provision waits for no write', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const provision = {
      name: CUSTOM_NAME,
      baseUrl: 'https://llm-new.example.com/v1',
      apiKey: 'key-D',
      models: ['llama-3.3-70b'],
    };
    let releaseRead: (() => void) | undefined;
    const calls = stubPass([STALE_CUSTOM], (method, name) => {
      if (method === 'GET' && name === CUSTOM_NAME) {
        return new Promise<Response>((resolve) => {
          releaseRead = () => resolve(Response.json(STALE_CUSTOM));
        });
      }
      return Response.json(method === 'GET' ? { keys: [] } : {});
    });
    const mod = await loadModule();
    const pass = mod.shrinkProviderPools();
    await vi.waitFor(() => expect(releaseRead).toBeDefined());
    expect(await mod.provisionProviders('org_9', [provision])).toEqual([]);

    releaseRead?.();
    await pass;
    expect(recordWrites(calls)).toEqual([
      [
        CUSTOM_NAME,
        expect.objectContaining({
          network_config: expect.objectContaining({
            base_url: provision.baseUrl,
          }),
        }),
      ],
    ]);
  });

  it('keeps a record the gateway answers without the network config a resize must send back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { network_config: _dropped, ...withoutNetwork } = STALE_CUSTOM;
    const calls = stubGateway({ providerRecords: [withoutNetwork] });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(recordWrites(calls)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `provider '${CUSTOM_NAME}' came back without its network config`,
      ),
    );
  });

  it('reads each record again right before its write, so another process’s newer config is what it sends back', async () => {
    const newer = {
      ...STALE_CUSTOM,
      network_config: {
        ...CUSTOM_NETWORK,
        base_url: 'https://llm-new.example.com/v1',
      },
    };
    const calls = stubRecords([STALE_CUSTOM], { current: [newer] });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(recordWrites(calls)).toEqual([
      [
        CUSTOM_NAME,
        expect.objectContaining({ network_config: newer.network_config }),
      ],
    ]);
  });

  it('leaves a record another process resized since the listing, or deleted', async () => {
    const resized = {
      ...STALE_CUSTOM,
      concurrency_and_buffer_size: { concurrency: 64, buffer_size: 1024 },
    };
    const calls = stubRecords([STALE_CUSTOM, STALE_STANDARD], {
      current: [resized],
    });
    const mod = await loadModule();
    await mod.shrinkProviderPools();
    expect(calls.filter((c) => c.method === 'GET').map((c) => c.url)).toEqual([
      'http://sandbox-llm-gateway:8080/api/providers',
      `http://sandbox-llm-gateway:8080/api/providers/${CUSTOM_NAME}`,
      'http://sandbox-llm-gateway:8080/api/providers/openai',
    ]);
    expect(recordWrites(calls)).toEqual([]);
  });

  it('leaves a record this process already provisioned, whose config is newer than the listing', async () => {
    const provision = {
      name: CUSTOM_NAME,
      baseUrl: 'https://llm-new.example.com/v1',
      apiKey: 'key-D',
      models: ['llama-3.3-70b'],
    };
    const calls = stubGateway({ providerRecords: [STALE_CUSTOM] });
    const mod = await loadModule();
    await mod.provisionProviders('org_9', [provision]);
    calls.length = 0;
    await mod.shrinkProviderPools();
    expect(recordWrites(calls)).toEqual([]);
  });

  it('holds a provision of a record until the pass’s write to it lands, so the provision’s config is the one that stays', async () => {
    const provision = {
      name: CUSTOM_NAME,
      baseUrl: 'https://llm-new.example.com/v1',
      apiKey: 'key-D',
      models: ['llama-3.3-70b'],
    };
    const writesSent: { name: string; body: Record<string, unknown> }[] = [];
    let releaseResize: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        if (method === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                u.endsWith('/api/providers')
                  ? { providers: [STALE_CUSTOM] }
                  : u.endsWith('/keys')
                    ? { keys: [] }
                    : STALE_CUSTOM,
              ),
              { status: 200 },
            ),
          );
        }
        if (
          method === 'PUT' &&
          !u.includes('/keys') &&
          typeof init?.body === 'string'
        ) {
          writesSent.push({
            name: decodeURIComponent(u.split('/api/providers/')[1] ?? ''),
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            body: JSON.parse(init.body) as Record<string, unknown>,
          });
          if (releaseResize === undefined) {
            return new Promise<Response>((resolve) => {
              releaseResize = () => resolve(new Response('{}'));
            });
          }
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    const mod = await loadModule();
    const pass = mod.shrinkProviderPools();
    await vi.waitFor(() => expect(releaseResize).toBeDefined());
    const provisioned = mod.provisionProviders('org_9', [provision]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writesSent).toHaveLength(1);

    releaseResize?.();
    await pass;
    expect(await provisioned).toEqual([]);
    const baseUrlOf = (body: Record<string, unknown>): unknown => {
      const network = body.network_config;
      return network !== null &&
        typeof network === 'object' &&
        'base_url' in network
        ? network.base_url
        : undefined;
    };
    expect(writesSent.map(({ name, body }) => [name, baseUrlOf(body)])).toEqual(
      [
        [CUSTOM_NAME, CUSTOM_NETWORK.base_url],
        [CUSTOM_NAME, provision.baseUrl],
      ],
    );
  });
});

describe('provisionProviders — management-plane auth', () => {
  it('sends Basic auth from SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD on EVERY management call', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-1');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await expect(mod.provisionProviders(ORG, [PROVIDER])).resolves.toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers.authorization).toBe(basicFor('pw-1'));
    }
  });

  it('sends the password in no header but Basic auth: the setup token rides only the bootstrap body', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-1');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);
    await mod.applyGatewayConfig();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Object.keys(call.headers).sort()).toEqual([
        'authorization',
        'content-type',
      ]);
    }
  });

  it('falls back to the pre-rename LLM_GATEWAY_ADMIN_PASSWORD env name', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', 'pw-old');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(calls[0]?.headers.authorization).toBe(basicFor('pw-old'));
  });

  it('fails closed — no management call at all — when no admin password is configured', async () => {
    // The gateway shares one port on the sandbox network for inference and
    // /api/*; an anonymous management plane would let sandboxed code mint its
    // own keys. Unset (both names) must refuse BEFORE touching the gateway;
    // the refusal comes back as the provider's failure.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    const failures = await mod.provisionProviders(ORG, [PROVIDER]);
    expect(String(failures[0]?.error)).toContain(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set',
    );
    expect(calls).toHaveLength(0);
  });

  it('treats a blank password as unset (fails closed)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', '   ');
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    const failures = await mod.provisionProviders(ORG, [PROVIDER]);
    expect(String(failures[0]?.error)).toContain(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set',
    );
    expect(calls).toHaveLength(0);
  });
});

/**
 * A request-scoped key (one per model-endpoint request) reuses the org key
 * this process pushed or saw listed within the last minute, under the same
 * provision fingerprint: no keys listing in the provision, the remembered
 * key id in the mint. A sandbox session keeps listing every time.
 */
/**
 * The gateway's SQLite store turns away a write that collides with another
 * one, answering 500 — with "database is locked" in the body, except a
 * virtual key's DELETE, which says only that it failed.
 */
describe('management calls the gateway store turned away for a moment', () => {
  const LOCKED = '{"error":{"message":"failed to update: database is locked"}}';

  /** Stub fetch: `answer` decides each call's reply from its method and URL
   * and how often that method+URL was called before. */
  function stubAnswers(
    answer: (method: string, url: string, seen: number) => Response,
  ): RecordedCall[] {
    const calls: RecordedCall[] = [];
    const seen = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        calls.push({ url: u, method, body: undefined, headers: {} });
        const key = `${method} ${u}`;
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        return Promise.resolve(answer(method, u, count));
      }),
    );
    return calls;
  }

  it('sends a write again after a locked store, and the provision lands', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubAnswers((method, url, seen) => {
      if (method === 'GET') {
        return Response.json({ keys: [] });
      }
      if (method === 'PUT' && url.endsWith('/api/providers/openrouter')) {
        return seen < 2
          ? new Response(LOCKED, { status: 500 })
          : Response.json({});
      }
      return Response.json({ id: 'kid-new' });
    });
    const mod = await loadModule();
    const failures = await withRetryWaitsElapsed(() =>
      mod.provisionProviders(ORG, [PROVIDER]),
    );
    expect(failures).toEqual([]);
    expect(
      calls.filter((c) => c.method === 'PUT').map((c) => c.url),
    ).toHaveLength(3);
  });

  it('repeats a mint only when the store said it was locked, since a POST may have created the key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mintAnswers = (first: Response) =>
      stubAnswers((method, url, seen) => {
        if (method === 'GET') {
          return Response.json({
            keys: [{ id: 'kid-A', name: KEY_NAME, models: [] }],
          });
        }
        if (method === 'POST' && url.endsWith('/api/governance/virtual-keys')) {
          return seen === 0
            ? first
            : Response.json({
                virtual_key: {
                  id: 'vk-1',
                  value: 'sk-bf-x',
                  budgets: [{ id: 'budget-1' }],
                },
              });
        }
        return Response.json({});
      });
    const args = {
      budgetCents: 100,
      organizationId: ORG,
      sessionId: 's1',
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
      ],
    };

    let calls = mintAnswers(new Response(LOCKED, { status: 500 }));
    let mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.mintVirtualKey(args)),
    ).resolves.toEqual({ key: 'sk-bf-x', keyId: 'vk-1' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);

    vi.unstubAllGlobals();
    calls = mintAnswers(
      new Response('{"error":{"message":"governance data is not available"}}', {
        status: 500,
      }),
    );
    mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.mintVirtualKey(args)),
    ).rejects.toThrow(
      'llm-gateway mint key failed (500): {"error":{"message":"governance data is not available"}}',
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('repeats an idempotent call whatever its 5xx says, waiting 250, 750 and 2000 ms, then answers the last refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubAnswers(
      () => new Response('Failed to delete virtual key', { status: 500 }),
    );
    const mod = await loadModule();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const settled = mod.revokeVirtualKey('vk-1').then(
        () => 'revoked',
        (error: unknown) => String(error),
      );
      const deletes = () => calls.filter((c) => c.method === 'DELETE').length;
      await vi.advanceTimersByTimeAsync(0);
      expect(deletes()).toBe(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(deletes()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(deletes()).toBe(2);
      await vi.advanceTimersByTimeAsync(750);
      expect(deletes()).toBe(3);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(deletes()).toBe(4);
      await expect(settled).resolves.toContain(
        'llm-gateway revoke key failed (500): Failed to delete virtual key',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('never repeats a refusal below 500', async () => {
    const calls = stubAnswers(
      () => new Response('{"error":"bad request"}', { status: 400 }),
    );
    const mod = await loadModule();
    await expect(mod.revokeVirtualKey('vk-1')).rejects.toThrow(
      'llm-gateway revoke key failed (400)',
    );
    expect(calls).toHaveLength(1);
  });
});

describe('provisionProviders + mintVirtualKey — request-scoped reuse of the org key', () => {
  const T0 = 1_790_000_000_000;
  const REUSE = { reuseRecent: true } as const;
  const MINT = {
    budgetCents: 4,
    allowedModels: [
      { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
    ],
    organizationId: ORG,
    sessionId: 'model-api:key-1',
  };
  const keyListings = (calls: RecordedCall[]) =>
    calls.filter(
      (c) =>
        c.method === 'GET' && c.url.endsWith('/api/providers/openrouter/keys'),
    );
  const mintOf = (calls: RecordedCall[]) =>
    calls.find(
      (c) =>
        c.method === 'POST' && c.url.endsWith('/api/governance/virtual-keys'),
    );
  const pathsOf = (calls: RecordedCall[]) =>
    calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

  it('lists once, then provisions and mints within the minute on the key id it pushed', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();

    // The first request of a fresh process lists, pushes (empty memo) and
    // remembers the key; its mint binds that id without listing again.
    expect(await mod.provisionProviders(ORG, [PROVIDER], REUSE)).toEqual([]);
    await mod.mintVirtualKey({ ...MINT, requestId: 'req-1' }, REUSE);
    expect(keyListings(calls)).toHaveLength(1);
    expect(mintOf(calls)?.body?.provider_configs).toMatchObject([
      { provider: 'openrouter', key_ids: ['kid-A'] },
    ]);

    // The next request, 59 s on: the mint is its only gateway call.
    calls.length = 0;
    clock.mockReturnValue(T0 + 59_000);
    expect(await mod.provisionProviders(ORG, [PROVIDER], REUSE)).toEqual([]);
    await mod.mintVirtualKey({ ...MINT, requestId: 'req-2' }, REUSE);
    expect(pathsOf(calls)).toEqual(['POST /api/governance/virtual-keys']);
    expect(mintOf(calls)?.body?.provider_configs).toMatchObject([
      { key_ids: ['kid-A'] },
    ]);
  });

  it('lists again once the minute is over, and the listing restarts it', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);

    calls.length = 0;
    clock.mockReturnValue(T0 + 60_000);
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);
    // Verified by the listing, nothing to write.
    expect(pathsOf(calls)).toEqual(['GET /api/providers/openrouter/keys']);

    calls.length = 0;
    clock.mockReturnValue(T0 + 60_000 + 59_000);
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);
    expect(calls).toEqual([]);
  });

  it('keeps a sandbox session listing on every provision and every mint, whatever the process remembers', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);

    calls.length = 0;
    await mod.provisionProviders(ORG, [PROVIDER]);
    await mod.mintVirtualKey({ ...MINT, sessionId: 'sess-1' });
    expect(keyListings(calls)).toHaveLength(2);
  });

  async function captureProvision(
    mod: Awaited<ReturnType<typeof loadModule>>,
    options: { reuseRecent?: boolean } = {},
  ) {
    const keyIds = new Map<string, string>();
    const failures = await mod.provisionProviders(ORG, [PROVIDER], {
      ...options,
      onProviderKey: (provider, keyId) => {
        keyIds.set(provider, keyId);
      },
    });
    return { failures, verifiedKeys: { organizationId: ORG, keyIds } };
  }

  it('uses this sandbox provision’s verified ids without a second listing, but checks every next session', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    for (const sessionId of ['session-1', 'session-2']) {
      calls.length = 0;
      const provision = await captureProvision(mod);
      expect(provision.failures).toEqual([]);
      await mod.mintVirtualKey(
        { ...MINT, sessionId },
        {
          provisionedKeys: provision.verifiedKeys,
        },
      );
      expect(keyListings(calls)).toHaveLength(1);
      expect(mintOf(calls)?.body?.provider_configs).toMatchObject([
        { provider: 'openrouter', key_ids: ['kid-A'] },
      ]);
    }
  });

  it('refuses another org’s verified ids before any gateway call', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    const provision = await captureProvision(mod);
    calls.length = 0;
    await expect(
      mod.mintVirtualKey(
        { ...MINT, organizationId: 'org_other' },
        {
          provisionedKeys: provision.verifiedKeys,
        },
      ),
    ).rejects.toThrow('provisioned keys belong to another organization');
    expect(calls).toEqual([]);
  });

  it('lists at mint when a successful create did not return its key id', async () => {
    stubGateway({ keyExists: false });
    const mod = await loadModule();
    const provision = await captureProvision(mod);
    expect(provision.failures).toEqual([]);
    expect(provision.verifiedKeys.keyIds.size).toBe(0);
    // The older gateway omitted the id from its write response, but its
    // listing now contains the created key. A fallback still binds by org.
    const calls = stubGateway({ keyExists: true });
    await mod.mintVirtualKey(MINT, { provisionedKeys: provision.verifiedKeys });
    expect(keyListings(calls)).toHaveLength(1);
    expect(mintOf(calls)?.body?.provider_configs).toMatchObject([
      { key_ids: ['kid-A'] },
    ]);
  });

  it('a removed key still fails the mint and invalidates the recent-key memo', async () => {
    const calls = stubGateway({
      keyExists: true,
      mintRefusal: { status: 400, body: 'provider key was removed' },
    });
    const mod = await loadModule();
    const provision = await captureProvision(mod, REUSE);
    await expect(
      mod.mintVirtualKey(MINT, {
        ...REUSE,
        provisionedKeys: provision.verifiedKeys,
      }),
    ).rejects.toThrow('provider key was removed');
    calls.length = 0;
    await captureProvision(mod, REUSE);
    expect(keyListings(calls)).toHaveLength(1);
  });

  it('pushes a changed secret at once, even within the minute', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);

    calls.length = 0;
    await mod.provisionProviders(
      ORG,
      [{ ...PROVIDER, apiKey: 'key-B' }],
      REUSE,
    );
    expect(keyListings(calls)).toHaveLength(1);
    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({
      method: 'PUT',
      url: expect.stringContaining('/api/providers/openrouter/keys/kid-A'),
      body: { value: 'key-B' },
    });
  });

  it('forgets the key a failed mint bound, so the next request lists again', async () => {
    // The gateway refuses a binding to a key id it no longer holds — a
    // record another process recreated, a reset store.
    const calls = stubGateway({
      keyExists: true,
      mintRefusal: {
        status: 500,
        body: 'some keys not found for provider openrouter: expected 1, found 0',
      },
    });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);
    await expect(
      mod.mintVirtualKey({ ...MINT, requestId: 'req-1' }, REUSE),
    ).rejects.toThrow('llm-gateway mint key failed (500)');

    calls.length = 0;
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);
    expect(keyListings(calls)).toHaveLength(1);
  });

  it('remembers a created key by the id the gateway answered', async () => {
    const calls = stubGateway({ keyExists: false, createdKeyId: 'kid-new' });
    const mod = await loadModule();
    await mod.provisionProviders(ORG, [PROVIDER], REUSE);

    calls.length = 0;
    await mod.mintVirtualKey({ ...MINT, requestId: 'req-1' }, REUSE);
    expect(keyListings(calls)).toHaveLength(0);
    expect(mintOf(calls)?.body?.provider_configs).toMatchObject([
      { key_ids: ['kid-new'] },
    ]);
  });
});

describe('mintVirtualKey', () => {
  it('binds the VK to the org key id, scoped allowed_models (bare + full), and a dollar budget', async () => {
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    const minted = await mod.mintVirtualKey({
      budgetCents: 250,
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
      ],
      organizationId: ORG,
      sessionId: 'sess-1',
    });
    expect(minted).toEqual({ key: 'sk-bf-x', keyId: 'vk-1' });
    const mint = calls.find((c) => c.url.includes('/governance/virtual-keys'));
    expect(mint?.body).toMatchObject({
      name: expect.stringContaining(`tale-${ORG}-sess-1-`),
      provider_configs: [
        {
          provider: 'openrouter',
          key_ids: ['kid-A'],
          allowed_models: [
            'anthropic/claude-sonnet-5',
            'openrouter/anthropic/claude-sonnet-5',
          ],
        },
      ],
      // Plural `budgets`: the gateway's multi-budget contract. Its decoder
      // drops unknown fields, so the old singular `budget` was accepted with
      // a 200 and stored an uncapped, unmetered key.
      budgets: [{ max_limit: 2.5, reset_duration: '1M' }],
      is_active: true,
    });
    expect(mint?.body).not.toHaveProperty('budget');
  });

  it('names each whitelist spelling once when the serving and the vision model are the same', async () => {
    // A turn names the org's vision model beside its serving model, and for
    // most connectors they are one model. On the OpenAI-wire lane both land
    // on the same record, and the gateway refuses a duplicate whitelist
    // value outright — every managed Codex + DeepSeek run failed to start
    // on it (2026-09-26 evaluation, C-08).
    const calls = stubGateway({
      keyExists: true,
      // The org's key under its per-model custom record.
      keyName: `tale-${ORG}-${ORG}__deepseek__deepseek-flash`,
    });
    const mod = await loadModule();
    await mod.mintVirtualKey({
      budgetCents: 500,
      allowedModels: [
        { providerSlug: 'deepseek', modelId: 'deepseek-flash' },
        { providerSlug: 'deepseek', modelId: 'deepseek-flash' },
      ],
      organizationId: ORG,
      sessionId: 'sess-1',
    });
    const mint = calls.find((c) => c.url.includes('/governance/virtual-keys'));
    expect(mint?.body).toMatchObject({
      provider_configs: [
        {
          provider: `${ORG}__deepseek__deepseek-flash`,
          allowed_models: [
            'deepseek-flash',
            `${ORG}__deepseek__deepseek-flash/deepseek-flash`,
          ],
        },
      ],
    });
  });

  it("quotes the gateway's refusal so a failed start says what was refused", async () => {
    stubGateway({
      keyExists: true,
      mintRefusal: {
        status: 400,
        body: '{"error":{"message":"invalid allowed_models for provider p: duplicate value \'x\' in whitelist"}}',
      },
    });
    const mod = await loadModule();
    await expect(
      mod.mintVirtualKey({
        budgetCents: 500,
        allowedModels: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
        ],
        organizationId: ORG,
        sessionId: 'sess-1',
      }),
    ).rejects.toThrow(
      'llm-gateway mint key failed (400): {"error":{"message":"invalid allowed_models for provider p: duplicate value \'x\' in whitelist"}}',
    );
  });

  it('revokes and refuses a key the gateway stored without its budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubGateway({ keyExists: true, mintWithoutBudget: true });
    const mod = await loadModule();
    await expect(
      mod.mintVirtualKey({
        budgetCents: 250,
        allowedModels: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
        ],
        organizationId: ORG,
        sessionId: 'sess-1',
      }),
    ).rejects.toThrow('without its budget');
    // The uncapped key must not outlive the refusal.
    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      url: expect.stringContaining('/api/governance/virtual-keys/vk-1'),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails closed (throws, never mints) when the org has no provider key', async () => {
    const calls = stubGateway({ keyExists: false });
    const mod = await loadModule();
    await expect(
      mod.mintVirtualKey({
        budgetCents: 100,
        allowedModels: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
        ],
        organizationId: ORG,
        sessionId: 'sess-1',
      }),
    ).rejects.toThrow("no gateway key for provider 'openrouter'");
    expect(calls.some((c) => c.url.includes('/governance/virtual-keys'))).toBe(
      false,
    );
  });

  it("binds a CUSTOM provider model to THIS org's per-model gateway record", async () => {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        calls.push({
          url: u,
          method,
          body:
            typeof init?.body === 'string'
              ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
                (JSON.parse(init.body) as Record<string, unknown>)
              : undefined,
          headers: {},
        });
        if (method === 'GET' && u.includes('/keys')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                keys: [
                  {
                    id: 'kid-C',
                    name: 'tale-org_1-org_1__my-vllm__llama-3',
                    models: [],
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              virtual_key: {
                id: 'vk-2',
                value: 'sk-bf-y',
                budgets: [{ id: 'budget-2' }],
              },
            }),
            { status: 200 },
          ),
        );
      }),
    );
    const mod = await loadModule();
    await mod.mintVirtualKey({
      budgetCents: 100,
      allowedModels: [{ providerSlug: 'my-vllm', modelId: 'llama-3' }],
      organizationId: ORG,
      sessionId: 'sess-2',
    });
    // The key lookup and the VK binding both name the ORG-scoped record —
    // never a `my-vllm__llama-3` record another org could have rewritten.
    expect(calls[0]?.url).toContain(
      '/api/providers/org_1__my-vllm__llama-3/keys',
    );
    const mint = calls.find((c) => c.url.includes('/governance/virtual-keys'));
    expect(mint?.body?.provider_configs).toEqual([
      {
        provider: 'org_1__my-vllm__llama-3',
        key_ids: ['kid-C'],
        allowed_models: ['llama-3', 'org_1__my-vllm__llama-3/llama-3'],
      },
    ]);
  });

  it('throws on an empty allowed-model list (deny-all key must never mint)', async () => {
    stubGateway({ keyExists: true });
    const mod = await loadModule();
    await expect(
      mod.mintVirtualKey({
        budgetCents: 100,
        allowedModels: [],
        organizationId: ORG,
        sessionId: 'sess-3',
      }),
    ).rejects.toThrow('no allowed models resolved');
  });
});

describe('mintVirtualKey — the key name', () => {
  const T0 = 1_790_000_000_000;
  const MINT = {
    budgetCents: 4,
    allowedModels: [
      { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
    ],
    organizationId: ORG,
    sessionId: 'model-api:key-1',
  };
  const mintNames = (calls: RecordedCall[]) =>
    calls
      .filter(
        (c) =>
          c.method === 'POST' && c.url.endsWith('/api/governance/virtual-keys'),
      )
      .map((c) => c.body?.name);

  it('ends with the request id a request-scoped key serves', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();

    await mod.mintVirtualKey({ ...MINT, requestId: 'req-1' });

    expect(mintNames(calls)).toEqual([
      `tale-${ORG}-model-api:key-1-${T0.toString(36)}-req-1`,
    ]);
  });

  it('gives two requests of one API key minting in the same millisecond distinct names', async () => {
    // Every request of a key mints under the key's session, and the
    // gateway's name index is unique: without the request id the second
    // mint would answer 409.
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();

    await mod.mintVirtualKey({ ...MINT, requestId: 'req-1' });
    await mod.mintVirtualKey({ ...MINT, requestId: 'req-2' });

    const names = mintNames(calls);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('names a session key as before: no request id, no suffix', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();

    await mod.mintVirtualKey({ ...MINT, sessionId: 'sess-1' });

    expect(mintNames(calls)).toEqual([`tale-${ORG}-sess-1-${T0.toString(36)}`]);
  });

  it("stays within the gateway's 255 characters, shortening the attribution and never the unique tail", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ keyExists: true });
    const mod = await loadModule();
    const requestId = '0b6f1a52-8a55-4d0e-9d3b-2f9f3c1d7e11';

    await mod.mintVirtualKey({
      ...MINT,
      sessionId: `model-api:${'k'.repeat(300)}`,
      requestId,
    });

    const [name] = mintNames(calls);
    expect(name).toHaveLength(255);
    expect(name).toMatch(
      new RegExp(`^tale-${ORG}-model-api:k+-${T0.toString(36)}-${requestId}$`),
    );
  });
});

describe('revokeVirtualKey', () => {
  it('DELETEs the key and tolerates 404', async () => {
    const calls = stubGateway({});
    const mod = await loadModule();
    await mod.revokeVirtualKey('vk-1');
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: expect.stringContaining('/api/governance/virtual-keys/vk-1'),
    });

    vi.unstubAllGlobals();
    stubGateway({ writeStatus: 404 });
    await expect(mod.revokeVirtualKey('vk-1')).resolves.toBeUndefined();
  });

  it('throws on a non-404 failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubGateway({ writeStatus: 500 });
    const mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.revokeVirtualKey('vk-1')),
    ).rejects.toThrow('llm-gateway revoke key failed (500)');
  });
});

describe('setVirtualKeyBudget', () => {
  /** A gateway holding one key whose one budget row is `budget-1`. */
  function stubKey(options: { getStatus?: number; putStatus?: number } = {}) {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({
          method,
          url: String(url),
          ...(typeof init?.body === 'string'
            ? { body: JSON.parse(init.body) }
            : {}),
        });
        if (method === 'GET') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                virtual_key: {
                  id: 'vk-1',
                  budgets: [
                    { id: 'budget-1', max_limit: 5, current_usage: 1.2 },
                  ],
                },
              }),
              { status: options.getStatus ?? 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response('{"error":{"message":"refused"}}', {
            status: options.putStatus ?? 200,
          }),
        );
      }),
    );
    return calls;
  }

  it("moves the key's one budget row to the new cap, in dollars", async () => {
    const calls = stubKey();
    const mod = await loadModule();
    await expect(mod.setVirtualKeyBudget('vk-1', 350)).resolves.toBe('ok');
    expect(calls[1]).toEqual({
      method: 'PUT',
      url: expect.stringContaining('/api/governance/virtual-keys/vk-1'),
      // The row keeps its id — and with it the usage counted against it.
      body: {
        budgets: [{ id: 'budget-1', max_limit: 3.5, reset_duration: '1M' }],
      },
    });
  });

  it('never moves a cap below the smallest the gateway takes', async () => {
    const calls = stubKey();
    const mod = await loadModule();
    await mod.setVirtualKeyBudget('vk-1', -20);
    expect(calls[1]?.body).toEqual({
      budgets: [{ id: 'budget-1', max_limit: 0.0001, reset_duration: '1M' }],
    });
  });

  it('answers gone for a key the gateway no longer holds', async () => {
    stubKey({ getStatus: 404 });
    const mod = await loadModule();
    await expect(mod.setVirtualKeyBudget('vk-1', 100)).resolves.toBe('gone');
  });

  it("throws with the gateway's reason when it refuses the update", async () => {
    stubKey({ putStatus: 400 });
    const mod = await loadModule();
    await expect(mod.setVirtualKeyBudget('vk-1', 100)).rejects.toThrow(
      'llm-gateway update key budget failed (400): {"error":{"message":"refused"}}',
    );
  });
});

describe('applyGatewayConfig', () => {
  it('GET-merges the full client_config, flips enforcement, clamps log retention', async () => {
    const calls = stubGateway({
      clientConfig: {
        enable_logging: true,
        log_retention_days: 0,
        max_request_body_size_mb: 100,
      },
    });
    const mod = await loadModule();
    await mod.applyGatewayConfig();
    const put = calls.find(
      (c) => c.method === 'PUT' && c.url.endsWith('/api/config'),
    );
    expect(put?.body).toEqual({
      client_config: {
        enable_logging: true,
        log_retention_days: 30,
        max_request_body_size_mb: 100,
        enforce_auth_on_inference: true,
        disable_content_logging: true,
        drop_excess_requests: false,
      },
      // First-time bootstrap (GET reports auth not yet enabled): the plaintext
      // password is sent to establish it — the gateway hashes it on store. A
      // freshly minted secret is policy-compliant by construction, so the
      // gateway's >= v1.6.9 strength check passes. The same password is the
      // setup token the gateway (>= v2.2) demands before it creates its first
      // admin account; its image derives the token from it.
      auth_config: {
        is_enabled: true,
        admin_username: 'admin',
        admin_password: DEFAULT_PW,
        setup_token: DEFAULT_PW,
      },
    });
  });

  it('preserves the stored password once auth is enabled, so the gateway strength policy never trips', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-2');
    const calls = stubGateway({
      clientConfig: { log_retention_days: 14 },
      authEnabled: true,
    });
    const mod = await loadModule();
    await mod.applyGatewayConfig();
    const put = calls.find(
      (c) => c.method === 'PUT' && c.url.endsWith('/api/config'),
    );
    // Empty value → the gateway keeps its stored hash (SecretVar.
    // ShouldPreserveStored) and skips the >= v1.6.9 password policy, which a
    // secret minted before the policy (e.g. a base64url one with no special
    // char) would otherwise 400 on ("must include one special character").
    // No setup token either: the admin account it would admit exists.
    expect(put?.body?.auth_config).toEqual({
      is_enabled: true,
      admin_username: 'admin',
      admin_password: '',
    });
    // Basic auth still uses the real credential — the password is unchanged,
    // it is simply not re-asserted in the body.
    for (const call of calls) {
      expect(call.headers.authorization).toBe(basicFor('pw-2'));
    }
  });

  it('names the gateway’s own reason when it refuses the config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL, init?: RequestInit) =>
        Promise.resolve(
          (init?.method ?? 'GET') === 'GET'
            ? new Response(
                JSON.stringify({
                  client_config: {},
                  auth_config: { is_enabled: false },
                }),
                { status: 200 },
              )
            : new Response(
                '{"error":{"message":"auth password must include one special character"}}',
                { status: 400 },
              ),
        ),
      ),
    );
    const mod = await loadModule();
    await expect(mod.applyGatewayConfig()).rejects.toThrow(
      'llm-gateway apply config failed (400): {"error":{"message":"auth password must include one special character"}}',
    );
  });

  it('fails closed before touching the gateway when the admin password is unset', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    const calls = stubGateway({ clientConfig: {} });
    const mod = await loadModule();
    await expect(mod.applyGatewayConfig()).rejects.toThrow(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('applyGatewayConfig — a request-scoped key reuses a recent apply', () => {
  it('verifies every sandbox create but does not rewrite an already enforced posture', async () => {
    const calls = stubGateway({
      authEnabled: true,
      clientConfig: {
        log_retention_days: 30,
        enforce_auth_on_inference: true,
        disable_content_logging: true,
      },
    });
    const mod = await loadModule();
    await mod.applyGatewayConfig();
    await mod.applyGatewayConfig();
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET']);
  });

  it('turns off a gateway’s dropping of requests its full queue cannot take, so a burst past a record’s pool waits instead of failing', async () => {
    const calls = stubGateway({
      authEnabled: true,
      clientConfig: {
        log_retention_days: 30,
        enforce_auth_on_inference: true,
        disable_content_logging: true,
        drop_excess_requests: true,
      },
    });
    const mod = await loadModule();
    await mod.applyGatewayConfig();
    const put = calls.find(
      (c) => c.method === 'PUT' && c.url.endsWith('/api/config'),
    );
    expect(put?.body?.client_config).toEqual({
      log_retention_days: 30,
      enforce_auth_on_inference: true,
      disable_content_logging: true,
      drop_excess_requests: false,
    });
  });

  it('shares a concurrent auth verification, without caching a later sandbox create', async () => {
    const calls = stubGateway({ authEnabled: true });
    const mod = await loadModule();
    await Promise.all(
      Array.from({ length: 5 }, () => mod.applyGatewayConfig()),
    );
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT']);
    await mod.applyGatewayConfig();
    expect(calls.map((call) => call.method)).toEqual([
      'GET',
      'PUT',
      'GET',
      'PUT',
    ]);
  });

  const T0 = 1_790_000_000_000;
  const configCalls = (calls: RecordedCall[]) =>
    calls.filter((c) => c.url.endsWith('/api/config')).map((c) => c.method);

  it('applies at most once per five minutes for a request-scoped key, while a sandbox session re-asserts on every create', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const calls = stubGateway({ authEnabled: true });
    const mod = await loadModule();

    await mod.applyGatewayConfig({ reuseRecent: true });
    clock.mockReturnValue(T0 + 4 * 60_000);
    await mod.applyGatewayConfig({ reuseRecent: true });
    expect(configCalls(calls)).toEqual(['GET', 'PUT']);

    // A sandbox session create reuses nothing: GET-merge-PUT every time.
    await mod.applyGatewayConfig();
    await mod.applyGatewayConfig({});
    expect(configCalls(calls)).toEqual([
      'GET',
      'PUT',
      'GET',
      'PUT',
      'GET',
      'PUT',
    ]);

    // Any successful apply restarts the window; past it, a request-scoped
    // key applies again.
    clock.mockReturnValue(T0 + 4 * 60_000 + 5 * 60_000);
    await mod.applyGatewayConfig({ reuseRecent: true });
    expect(configCalls(calls)).toHaveLength(8);
  });

  it('never remembers a failed apply: it throws, and the next request-scoped call applies again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubGateway({ writeStatus: 503 });
    const mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() =>
        mod.applyGatewayConfig({ reuseRecent: true }),
      ),
    ).rejects.toThrow('llm-gateway apply config failed (503)');

    vi.unstubAllGlobals();
    const calls = stubGateway({});
    await mod.applyGatewayConfig({ reuseRecent: true });
    expect(configCalls(calls)).toEqual(['GET', 'PUT']);
  });
});

describe('resolveGatewayRouting', () => {
  it('routes a standard connector to the shared native record, whatever the org', async () => {
    const mod = await loadModule();
    expect(
      mod.resolveGatewayRouting(ORG, 'anthropic', 'claude-fable-5'),
    ).toEqual({
      gatewayProvider: 'anthropic',
      gatewayModel: 'anthropic/claude-fable-5',
    });
    expect(
      mod.resolveGatewayRouting('org_2', 'anthropic', 'claude-fable-5'),
    ).toEqual(mod.resolveGatewayRouting(ORG, 'anthropic', 'claude-fable-5'));
  });

  it("routes a custom connector to the org's own per-model record with slashes sanitized out of the record name", async () => {
    const mod = await loadModule();
    expect(
      mod.resolveGatewayRouting(ORG, 'vercel-ai-gateway', 'alibaba/qwen-3-14b'),
    ).toEqual({
      gatewayProvider: 'org_1__vercel-ai-gateway__alibaba_qwen-3-14b',
      gatewayModel:
        'org_1__vercel-ai-gateway__alibaba_qwen-3-14b/alibaba/qwen-3-14b',
    });
  });

  it('routes a custom connector to a distinct `__anthropic` record for the Claude Code lane', async () => {
    const mod = await loadModule();
    const openai = mod.resolveGatewayRouting(
      ORG,
      'deepseek',
      'deepseek-v4-flash',
    );
    const anthropic = mod.resolveGatewayRouting(
      ORG,
      'deepseek',
      'deepseek-v4-flash',
      { anthropicHarnessLane: true },
    );
    expect(openai.gatewayProvider).toBe('org_1__deepseek__deepseek-v4-flash');
    expect(anthropic.gatewayProvider).toBe(
      'org_1__deepseek__deepseek-v4-flash__anthropic',
    );
    // Distinct records → the two upstreams (openai base vs native anthropic)
    // never overwrite each other for the same (org, model).
    expect(anthropic.gatewayProvider).not.toBe(openai.gatewayProvider);
    expect(anthropic.gatewayModel).toBe(
      'org_1__deepseek__deepseek-v4-flash__anthropic/deepseek-v4-flash',
    );
  });

  it('routes a standard connector on the Claude Code lane to an org-scoped `__anthropic` record', async () => {
    // OpenRouter is a gateway-standard connector whose built-in
    // implementation speaks OpenAI only; its Anthropic Messages door needs a
    // custom record of its own, kept apart from the shared record every
    // other harness keeps using. The lane flag is only ever set by serving,
    // for a connector that declares a harness endpoint.
    const mod = await loadModule();
    const shared = mod.resolveGatewayRouting(
      ORG,
      'openrouter',
      'anthropic/claude-sonnet-5',
    );
    const lane = mod.resolveGatewayRouting(
      ORG,
      'openrouter',
      'anthropic/claude-sonnet-5',
      { anthropicHarnessLane: true },
    );
    expect(shared).toEqual({
      gatewayProvider: 'openrouter',
      gatewayModel: 'openrouter/anthropic/claude-sonnet-5',
    });
    expect(lane).toEqual({
      gatewayProvider:
        'org_1__openrouter__anthropic_claude-sonnet-5__anthropic',
      gatewayModel:
        'org_1__openrouter__anthropic_claude-sonnet-5__anthropic/anthropic/claude-sonnet-5',
    });
    // Org-scoped: two orgs' keys never share the door's record.
    expect(
      mod.resolveGatewayRouting(
        'org_2',
        'openrouter',
        'anthropic/claude-sonnet-5',
        { anthropicHarnessLane: true },
      ).gatewayProvider,
    ).not.toBe(lane.gatewayProvider);
  });

  it('gives two orgs sharing a custom connector name two distinct records', async () => {
    // Custom connectors are org-defined files: two orgs may name one
    // `internal` with different base URLs or wire formats. A shared record
    // let the last provision rewrite base_url for both orgs, so org A's key
    // was sent to org B's endpoint.
    const mod = await loadModule();
    const a = mod.resolveGatewayRouting(ORG, 'internal', 'llama-4');
    const b = mod.resolveGatewayRouting('org_2', 'internal', 'llama-4');
    expect(a.gatewayProvider).not.toBe(b.gatewayProvider);
    expect(a.gatewayModel).not.toBe(b.gatewayModel);
  });
});

describe('ensureModelPricingOverride', () => {
  const OVERRIDE = {
    gatewayProvider: 'org_1__zai__glm-5.3-flash',
    modelId: 'glm-5.3-flash',
    inputCentsPerMillion: 15,
    outputCentsPerMillion: 50,
  };
  const NAME = 'tale-pricing-org_1__zai__glm-5.3-flash-glm-5.3-flash';
  // 15 ¢/M tokens = $0.15 / 1e6 tokens.
  const PATCH = {
    input_cost_per_token: 1.5e-7,
    output_cost_per_token: 5e-7,
  };
  const pricingCalls = (calls: RecordedCall[]) =>
    calls.filter((c) => c.url.includes('/governance/pricing-overrides'));

  it('creates a provider-scoped exact-match override at the catalog price', async () => {
    const calls = stubGateway({});
    const mod = await loadModule();
    await mod.ensureModelPricingOverride(OVERRIDE);
    const [list, create] = pricingCalls(calls);
    expect(list).toMatchObject({
      method: 'GET',
      url: expect.stringContaining(
        'provider_id=org_1__zai__glm-5.3-flash&limit=',
      ),
    });
    expect(create).toMatchObject({
      method: 'POST',
      url: expect.stringMatching(/\/api\/governance\/pricing-overrides$/),
      body: {
        name: NAME,
        scope_kind: 'provider',
        provider_id: 'org_1__zai__glm-5.3-flash',
        match_type: 'exact',
        pattern: 'glm-5.3-flash',
        request_types: ['chat_completion', 'responses', 'text_completion'],
        patch: PATCH,
      },
    });
    expect(pricingCalls(calls)).toHaveLength(2);
  });

  it('carries the catalog cache-hit and cache-write prices in the patch', async () => {
    // Without them the gateway bills a cached token at the input rate —
    // a Claude Code turn is mostly cache hits, so a DeepSeek turn billed
    // ~7× the vendor's invoice. Only the fields the catalog prices ride
    // along: an absent one leaves the gateway's own figure (or fallback).
    const calls = stubGateway({});
    const mod = await loadModule();
    await mod.ensureModelPricingOverride({
      ...OVERRIDE,
      gatewayProvider: 'org_1__deepseek__deepseek-flash__anthropic',
      modelId: 'deepseek-flash',
      inputCentsPerMillion: 30,
      outputCentsPerMillion: 120,
      cacheReadCentsPerMillion: 0.6,
      cacheWriteCentsPerMillion: 30,
    });
    const [, create] = pricingCalls(calls);
    expect(create?.body).toMatchObject({
      pattern: 'deepseek-flash',
      patch: {
        input_cost_per_token: 3e-7,
        output_cost_per_token: 1.2e-6,
        cache_read_input_token_cost: 6e-9,
        cache_creation_input_token_cost: 3e-7,
      },
    });
  });

  it('updates an override whose stored patch prices the pair right but lacks the cache-hit price', async () => {
    // The pre-cache-price override is exactly this shape on every existing
    // deployment: input/output right, cache absent — it must be rewritten,
    // not memoized as matching.
    const calls = stubGateway({
      pricingOverrides: [
        {
          id: 'po-1',
          name: NAME,
          pattern: 'glm-5.3-flash',
          match_type: 'exact',
          request_types: ['chat_completion', 'responses', 'text_completion'],
          pricing_patch: JSON.stringify(PATCH),
        },
      ],
    });
    const mod = await loadModule();
    await mod.ensureModelPricingOverride({
      ...OVERRIDE,
      cacheReadCentsPerMillion: 3,
    });
    const [, update] = pricingCalls(calls);
    expect(update).toMatchObject({
      method: 'PUT',
      url: expect.stringMatching(/\/api\/governance\/pricing-overrides\/po-1$/),
      body: {
        patch: { ...PATCH, cache_read_input_token_cost: 3e-8 },
      },
    });
    expect(pricingCalls(calls)).toHaveLength(2);
  });

  it('updates a stale override in place when the catalog price moved', async () => {
    const calls = stubGateway({
      pricingOverrides: [
        {
          id: 'po-1',
          name: NAME,
          pattern: 'glm-5.3-flash',
          match_type: 'exact',
          request_types: ['chat_completion', 'responses', 'text_completion'],
          pricing_patch: JSON.stringify({
            input_cost_per_token: 1e-7,
            output_cost_per_token: 5e-7,
          }),
        },
      ],
    });
    const mod = await loadModule();
    await mod.ensureModelPricingOverride(OVERRIDE);
    expect(pricingCalls(calls)[1]).toMatchObject({
      method: 'PUT',
      url: expect.stringContaining('/api/governance/pricing-overrides/po-1'),
      body: { pattern: 'glm-5.3-flash', patch: PATCH },
    });
    expect(pricingCalls(calls)[1]?.body).not.toHaveProperty('name');
  });

  it('leaves a matching override alone and memoizes it (one GET, then nothing)', async () => {
    const calls = stubGateway({
      pricingOverrides: [
        {
          id: 'po-1',
          name: NAME,
          pattern: 'glm-5.3-flash',
          match_type: 'exact',
          request_types: ['chat_completion', 'responses', 'text_completion'],
          pricing_patch: JSON.stringify(PATCH),
        },
      ],
    });
    const mod = await loadModule();
    await mod.ensureModelPricingOverride(OVERRIDE);
    await mod.ensureModelPricingOverride(OVERRIDE);
    expect(pricingCalls(calls)).toHaveLength(1);
    expect(pricingCalls(calls)[0]?.method).toBe('GET');
  });

  it('pushes nothing for a zero token price (free tier / non-token billing)', async () => {
    const calls = stubGateway({});
    const mod = await loadModule();
    await mod.ensureModelPricingOverride({
      ...OVERRIDE,
      inputCentsPerMillion: 0,
      outputCentsPerMillion: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it('throws (no memo) when the gateway rejects the write, so the next provision retries', async () => {
    stubGateway({ writeStatus: 500 });
    const mod = await loadModule();
    await expect(mod.ensureModelPricingOverride(OVERRIDE)).rejects.toThrow(
      `llm-gateway create pricing override ${NAME} failed (500)`,
    );
    vi.unstubAllGlobals();
    const calls = stubGateway({});
    await mod.ensureModelPricingOverride(OVERRIDE);
    expect(pricingCalls(calls).map((c) => c.method)).toEqual(['GET', 'POST']);
  });
});

describe('removeOrganizationFromGateway', () => {
  type Key = { id: string; name: string };

  /**
   * A management plane that keeps its provider records and their keys:
   *   GET    /api/providers               → every record's name
   *   GET    /api/providers/:p/keys       → its keys (404 for no record)
   *   PUT    /api/providers/:p            → creates the record
   *   POST   /api/providers/:p/keys       → adds a key, answered with its id
   *   DELETE /api/providers/:p            → the record and its keys
   *   DELETE /api/providers/:p/keys/:id   → one key (404 when gone)
   * `refuse` answers the named calls 403, which no retry repeats.
   */
  function storedGateway(
    records: Record<string, Key[]>,
    refuse: ReadonlySet<string> = new Set(),
  ) {
    const store = new Map(
      Object.entries(records).map(([name, keys]) => [name, [...keys]]),
    );
    const calls: string[] = [];
    let created = 0;
    const json = (value: unknown) =>
      Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = decodeURIComponent(new URL(String(url)).pathname);
        const call = `${method} ${path}`;
        calls.push(call);
        if (refuse.has(call)) {
          return Promise.resolve(new Response('refused', { status: 403 }));
        }
        const [, , , provider, sub, keyId] = path.split('/');
        if (method === 'GET' && provider === undefined) {
          return json({
            providers: [...store.keys()].map((name) => ({ name })),
            total: store.size,
          });
        }
        const keys = provider === undefined ? undefined : store.get(provider);
        if (method === 'PUT' && sub === undefined && provider !== undefined) {
          if (keys === undefined) store.set(provider, []);
          return json({ name: provider });
        }
        if (keys === undefined || provider === undefined) {
          return Promise.resolve(new Response('not found', { status: 404 }));
        }
        if (method === 'GET' && sub === 'keys') return json({ keys });
        if (method === 'POST' && sub === 'keys') {
          const body: unknown =
            typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          const name =
            typeof body === 'object' &&
            body !== null &&
            'name' in body &&
            typeof body.name === 'string'
              ? body.name
              : '';
          const id = `kid-new-${++created}`;
          keys.push({ id, name });
          return json({ id, name, value: '<redacted>' });
        }
        if (method === 'DELETE' && sub === undefined) {
          store.delete(provider);
          return json({ name: provider });
        }
        if (method === 'DELETE' && sub === 'keys') {
          const at = keys.findIndex((key) => key.id === keyId);
          if (at === -1) {
            return Promise.resolve(new Response('not found', { status: 404 }));
          }
          keys.splice(at, 1);
          return json({});
        }
        return json({});
      }),
    );
    return { store, calls };
  }

  // org_1's key beside another organization's on two shared records; its own
  // records (one on the Anthropic lane); another organization's own record,
  // and one of an organization whose id org_1's is a prefix of.
  const shared = () => ({
    openrouter: [
      { id: 'k-own-or', name: `tale-${ORG}-openrouter` },
      { id: 'k-other-or', name: 'tale-org_2-openrouter' },
    ],
    anthropic: [
      { id: 'k-own-an', name: `tale-${ORG}-anthropic` },
      { id: 'k-other-an', name: 'tale-org_10-anthropic' },
    ],
    [`${ORG}__acme__llama-3`]: [
      { id: 'k-own-c1', name: `tale-${ORG}-${ORG}__acme__llama-3` },
    ],
    [`${ORG}__acme__llama-3__anthropic`]: [
      { id: 'k-own-c2', name: `tale-${ORG}-${ORG}__acme__llama-3__anthropic` },
    ],
    org_2__acme__llama: [
      { id: 'k-other-c', name: 'tale-org_2-org_2__acme__llama' },
    ],
    org_10__acme__llama: [
      { id: 'k-prefix-c', name: 'tale-org_10-org_10__acme__llama' },
    ],
    // The record of an organization whose id is org_1's followed by `_`.
    [`${ORG}___acme__llama`]: [
      { id: 'k-underscore-c', name: `tale-${ORG}_-${ORG}___acme__llama` },
    ],
  });

  it("removes the organization's keys from shared records and its own records, and nothing of another organization's", async () => {
    const { store, calls } = storedGateway(shared());
    const mod = await loadModule();
    expect(await mod.removeOrganizationFromGateway(ORG)).toEqual({
      records: 2,
      keys: 2,
    });
    expect(Object.fromEntries(store)).toEqual({
      openrouter: [{ id: 'k-other-or', name: 'tale-org_2-openrouter' }],
      anthropic: [{ id: 'k-other-an', name: 'tale-org_10-anthropic' }],
      org_2__acme__llama: [
        { id: 'k-other-c', name: 'tale-org_2-org_2__acme__llama' },
      ],
      org_10__acme__llama: [
        { id: 'k-prefix-c', name: 'tale-org_10-org_10__acme__llama' },
      ],
      [`${ORG}___acme__llama`]: [
        { id: 'k-underscore-c', name: `tale-${ORG}_-${ORG}___acme__llama` },
      ],
    });
    expect(calls.filter((call) => call.startsWith('DELETE')).sort()).toEqual([
      'DELETE /api/providers/anthropic/keys/k-own-an',
      'DELETE /api/providers/openrouter/keys/k-own-or',
      `DELETE /api/providers/${ORG}__acme__llama-3`,
      `DELETE /api/providers/${ORG}__acme__llama-3__anthropic`,
    ]);
  });

  it('finds nothing left on a second run', async () => {
    const { calls } = storedGateway(shared());
    const mod = await loadModule();
    await mod.removeOrganizationFromGateway(ORG);
    calls.length = 0;
    expect(await mod.removeOrganizationFromGateway(ORG)).toEqual({
      records: 0,
      keys: 0,
    });
    expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([]);
  });

  it('throws without removing anything when the gateway cannot list its records', async () => {
    const { store, calls } = storedGateway(
      shared(),
      new Set(['GET /api/providers']),
    );
    const mod = await loadModule();
    await expect(mod.removeOrganizationFromGateway(ORG)).rejects.toThrow(
      /list providers failed \(403\)/,
    );
    expect(calls).toEqual(['GET /api/providers']);
    expect(store.size).toBe(Object.keys(shared()).length);
  });

  it('tries every record, then throws naming the ones it could not clear', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store } = storedGateway(
      shared(),
      new Set([
        'DELETE /api/providers/openrouter/keys/k-own-or',
        'GET /api/providers/org_2__acme__llama/keys',
      ]),
    );
    const mod = await loadModule();
    await expect(mod.removeOrganizationFromGateway(ORG)).rejects.toThrow(
      `llm-gateway still holds organization ${ORG} on: openrouter, org_2__acme__llama`,
    );
    // Everything else went all the same.
    expect(store.has(`${ORG}__acme__llama-3`)).toBe(false);
    expect(store.get('anthropic')).toEqual([
      { id: 'k-other-an', name: 'tale-org_10-anthropic' },
    ]);
    expect(store.get('openrouter')).toHaveLength(2);
  });

  it('forgets the key it pushed for the organization, so a later request-scoped provision lists again', async () => {
    const { store, calls } = storedGateway({ openrouter: [] });
    const mod = await loadModule();
    const keyIds: string[] = [];
    const remember = {
      reuseRecent: true,
      onProviderKey: (_name: string, keyId: string) => keyIds.push(keyId),
    };
    await mod.provisionProviders(ORG, [PROVIDER], remember);
    await mod.removeOrganizationFromGateway(ORG);
    expect(store.get('openrouter')).toEqual([]);

    calls.length = 0;
    await mod.provisionProviders(ORG, [PROVIDER], remember);
    // Not the removed key's id from memory: the record is read and the key
    // written again.
    expect(calls).toContain('GET /api/providers/openrouter/keys');
    expect(calls).toContain('POST /api/providers/openrouter/keys');
    expect(keyIds).toEqual(['kid-new-1', 'kid-new-2']);
  });
});

describe('hashVirtualKey', () => {
  it('is the sha256 hex of the plaintext', async () => {
    const mod = await loadModule();
    expect(mod.hashVirtualKey('sk-bf-x')).toMatch(/^[0-9a-f]{64}$/);
    expect(mod.hashVirtualKey('sk-bf-x')).toBe(mod.hashVirtualKey('sk-bf-x'));
    expect(mod.hashVirtualKey('sk-bf-x')).not.toBe(
      mod.hashVirtualKey('sk-bf-y'),
    );
  });
});
