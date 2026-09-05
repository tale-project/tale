import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 * Returns the recorded calls, in order.
 */
function stubGateway(
  opts: {
    keyExists?: boolean;
    writeStatus?: number;
    configStatus?: number;
    configBody?: string;
    clientConfig?: Record<string, unknown>;
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
                ? [{ id: 'kid-A', name: KEY_NAME, models: [] }]
                : [],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === 'GET' && u.endsWith('/api/config')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ client_config: opts.clientConfig ?? {} }),
            { status: 200 },
          ),
        );
      }
      if (method === 'POST' && u.includes('/governance/virtual-keys')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ virtual_key: { id: 'vk-1', value: 'sk-bf-x' } }),
            { status: opts.writeStatus ?? 200 },
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

// The management plane is fail-closed on the admin password; give every test a
// default so only the auth-specific cases below vary it.
const DEFAULT_PW = 'pw-test';
const basicFor = (pw: string) =>
  `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}`;

beforeEach(() => {
  vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', DEFAULT_PW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('provisionProviders', () => {
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
    const failures = await mod.provisionProviders(ORG, [PROVIDER]);
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
    await mod.provisionProviders(ORG, [
      {
        name: 'broken',
        baseUrl: 'https://b.example.com/v1',
        apiKey: 'x',
        models: ['m'],
      },
      PROVIDER,
    ]);
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

describe('mintVirtualKey', () => {
  it('binds the VK to the org key id with allow_all_keys:false, scoped allowed_models (bare + full), and a dollar budget', async () => {
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
          allow_all_keys: false,
          allowed_models: [
            'anthropic/claude-sonnet-5',
            'openrouter/anthropic/claude-sonnet-5',
          ],
        },
      ],
      budget: { max_limit: 2.5, reset_duration: '1M' },
      is_active: true,
    });
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
            JSON.stringify({ virtual_key: { id: 'vk-2', value: 'sk-bf-y' } }),
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
        allow_all_keys: false,
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
    stubGateway({ writeStatus: 500 });
    const mod = await loadModule();
    await expect(mod.revokeVirtualKey('vk-1')).rejects.toThrow(
      'llm-gateway revoke key failed (500)',
    );
  });
});

describe('getVirtualKeySpendCents', () => {
  it('converts the budget usage dollars to fractional cents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              virtual_key: { budget: { current_usage: 0.1234 } },
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    const mod = await loadModule();
    await expect(mod.getVirtualKeySpendCents('vk-1')).resolves.toBeCloseTo(
      12.34,
    );
  });

  it('returns null (with a warning) when the gateway read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubGateway({ writeStatus: 502 });
    const mod = await loadModule();
    // The stub returns 502 for the plain GET (no /keys, no /config match).
    await expect(mod.getVirtualKeySpendCents('vk-1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('spend read failed'),
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
        enforce_governance_header: true,
      },
      // Always pushed — the management plane is never left anonymous.
      auth_config: {
        is_enabled: true,
        admin_username: 'admin',
        admin_password: DEFAULT_PW,
        disable_auth_on_inference: true,
      },
    });
  });

  it('pushes admin Basic auth (plaintext password — the gateway hashes it) on every apply', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-2');
    const calls = stubGateway({ clientConfig: { log_retention_days: 14 } });
    const mod = await loadModule();
    await mod.applyGatewayConfig();
    const put = calls.find(
      (c) => c.method === 'PUT' && c.url.endsWith('/api/config'),
    );
    expect(put?.body?.auth_config).toEqual({
      is_enabled: true,
      admin_username: 'admin',
      admin_password: 'pw-2',
      disable_auth_on_inference: true,
    });
    // And the apply itself authenticated with the same credential.
    for (const call of calls) {
      expect(call.headers.authorization).toBe(basicFor('pw-2'));
    }
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
