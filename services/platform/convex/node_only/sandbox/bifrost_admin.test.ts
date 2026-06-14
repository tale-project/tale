import { afterEach, describe, expect, it, vi } from 'vitest';

const ORG = 'org_1';
const PROVIDER = {
  name: 'openrouter',
  apiKey: 'key-A',
  models: ['openrouter:anthropic/claude-sonnet-4.6@fp8'],
};
const KEY_NAME = `tale-${ORG}-openrouter`;

interface RecordedCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string>;
}

/**
 * Stub global fetch with a minimal v1.5.13 management plane:
 *   GET  /api/providers/:p/keys   → the org's key (when `keyExists`)
 *   PUT  /api/providers/:p        → provider config (200)
 *   POST /api/providers/:p/keys   → create key (returns an id)
 *   PUT  /api/providers/:p/keys/* → rotate key (200)
 * Returns the recorded calls, in order.
 */
function stubBifrost(opts: {
  keyExists?: boolean;
  writeStatus?: number;
}): RecordedCall[] {
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
  return import('./bifrost_admin');
}

function writes(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.method !== 'GET');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('provisionProviders', () => {
  it('creates an absent org key: config PUT + key POST, stable per-org name, models translated', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    const w = writes(calls);
    expect(w.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'PUT /api/providers/openrouter',
      'POST /api/providers/openrouter/keys',
    ]);
    // provider config PUT carries no keys[] (keys are a sub-resource now) and,
    // for a standard provider, no base_url override + no custom_provider_config
    // (Bifrost would 400 the latter) — the proven native path is unchanged.
    expect(w[0]?.body?.keys).toBeUndefined();
    expect(w[0]?.body?.custom_provider_config).toBeUndefined();
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    expect(networkConfig.base_url).toBeUndefined();
    // OpenRouter app attribution rides as static upstream headers.
    expect(networkConfig.extra_headers).toEqual({
      'HTTP-Referer': 'https://tale.dev',
      'X-Title': 'Tale',
    });
    // key POST: stable per-org name, value, colon→slash + qualifier stripped.
    expect(w[1]?.body).toMatchObject({
      name: KEY_NAME,
      value: 'key-A',
      models: ['openrouter/anthropic/claude-sonnet-4.6'],
      weight: 1,
    });
  });

  it('rotates a present org key with PUT to /keys/:id (not POST)', async () => {
    const mod = await loadModule();
    // Present key, but fresh memo → rewrite once.
    const calls = stubBifrost({ keyExists: true });
    await mod.provisionProviders(ORG, [PROVIDER]);
    const w = writes(calls);
    expect(w.map((c) => c.method)).toEqual(['PUT', 'PUT']);
    expect(new URL(w[1]?.url ?? '').pathname).toBe(
      '/api/providers/openrouter/keys/kid-A',
    );
  });

  it('skips entirely when the key exists and the fingerprint matches (one GET, no writes)', async () => {
    const mod = await loadModule();
    stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]); // first push
    const calls = stubBifrost({ keyExists: true });
    await mod.provisionProviders(ORG, [PROVIDER]); // memo + key present
    expect(writes(calls)).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('rewrites when the gateway lost the key even though the memo matches', async () => {
    const mod = await loadModule();
    stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    // e.g. bifrost-data volume wiped while this process stayed alive
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT', 'POST']);
  });

  it('rewrites when the key rotates', async () => {
    const mod = await loadModule();
    stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    const calls = stubBifrost({ keyExists: true });
    await mod.provisionProviders(ORG, [{ ...PROVIDER, apiKey: 'key-B' }]);
    const w = writes(calls);
    expect(w.map((c) => c.method)).toEqual(['PUT', 'PUT']);
    expect(w[1]?.body).toMatchObject({ value: 'key-B' });
  });

  it('a failed write warns + leaves no memo (no throw), so the next provision retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
    stubBifrost({ keyExists: false, writeStatus: 500 });
    // provisionProviders is per-provider resilient: warns + continues, never throws.
    await expect(
      mod.provisionProviders(ORG, [PROVIDER]),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("provider 'openrouter'"),
      expect.anything(),
    );
    // memo unset on failure → next provision retries the full write.
    const retry = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(writes(retry).map((c) => c.method)).toEqual(['PUT', 'POST']);
    const third = stubBifrost({ keyExists: true });
    await mod.provisionProviders(ORG, [PROVIDER]);
    expect(writes(third)).toEqual([]);
  });

  it('sends no attribution extra_headers for a non-OpenRouter provider', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [
      {
        name: 'anthropic',
        apiKey: 'key-B',
        models: ['anthropic:claude-sonnet-4.6'],
      },
    ]);
    const w = writes(calls);
    expect(new URL(w[0]?.url ?? '').pathname).toBe('/api/providers/anthropic');
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    expect(networkConfig.extra_headers).toBeUndefined();
  });

  it('two orgs coexist under one provider (distinct per-org key names)', async () => {
    const mod = await loadModule();
    const a = stubBifrost({ keyExists: false });
    await mod.provisionProviders('orgA', [PROVIDER]);
    const b = stubBifrost({ keyExists: false });
    await mod.provisionProviders('orgB', [PROVIDER]);
    expect(writes(a)[1]?.body?.name).toBe('tale-orgA-openrouter');
    expect(writes(b)[1]?.body?.name).toBe('tale-orgB-openrouter');
  });

  const CUSTOM = {
    name: 'deepseek',
    apiKey: 'key-D',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek:deepseek-v4-flash'],
  };

  it('provisions a custom (non-standard) provider as OpenAI-compatible with base_url + custom_provider_config', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [CUSTOM]);
    const w = writes(calls);
    expect(w.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'PUT /api/providers/deepseek',
      'POST /api/providers/deepseek/keys',
    ]);
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    // Trailing /v1 stripped — Bifrost's openai handler appends it itself.
    expect(networkConfig.base_url).toBe('https://api.deepseek.com');
    expect(w[0]?.body?.custom_provider_config).toEqual({
      base_provider_type: 'openai',
      allowed_requests: {
        chat_completion: true,
        chat_completion_stream: true,
      },
    });
    // Key sub-resource is written the same way as for standard providers.
    expect(w[1]?.body).toMatchObject({
      name: `tale-${ORG}-deepseek`,
      value: 'key-D',
      models: ['deepseek/deepseek-v4-flash'],
      weight: 1,
    });
  });

  it('leaves a custom base_url without a trailing /v1 unchanged', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [
      { ...CUSTOM, baseUrl: 'https://api.deepseek.com' },
    ]);
    const networkConfig = writes(calls)[0]?.body?.network_config as Record<
      string,
      unknown
    >;
    expect(networkConfig.base_url).toBe('https://api.deepseek.com');
  });

  it('provisions an apiFormat:"anthropic" custom provider with base_provider_type anthropic, no allowed_requests, un-stripped base_url', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [
      {
        ...CUSTOM,
        apiFormat: 'anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
      },
    ]);
    const w = writes(calls);
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    // Anthropic base_url is verbatim — the native Anthropic provider appends
    // /v1/messages itself (NO /v1 strip).
    expect(networkConfig.base_url).toBe('https://api.deepseek.com/anthropic');
    // allowed_requests omitted ⇒ allow-all ⇒ Responses path ⇒ web_search survives.
    expect(w[0]?.body?.custom_provider_config).toEqual({
      base_provider_type: 'anthropic',
    });
  });

  it('re-provisions when only apiFormat changes (apiFormat is in the fingerprint)', async () => {
    const mod = await loadModule();
    const deepseekKeyName = `tale-${ORG}-deepseek`;
    const recorded: RecordedCall[] = [];
    let keyExists = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        recorded.push({
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
                keys: keyExists
                  ? [{ id: 'kid-D', name: deepseekKeyName, models: [] }]
                  : [],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    await mod.provisionProviders(ORG, [CUSTOM]); // openai (default)
    keyExists = true;
    recorded.length = 0;
    await mod.provisionProviders(ORG, [{ ...CUSTOM, apiFormat: 'anthropic' }]);
    // Memo busts on apiFormat change → config PUT + key PUT.
    expect(writes(recorded).map((c) => c.method)).toEqual(['PUT', 'PUT']);
    expect(
      (
        writes(recorded)[0]?.body?.custom_provider_config as Record<
          string,
          unknown
        >
      )?.base_provider_type,
    ).toBe('anthropic');
  });

  it('deletes + recreates a custom provider when the immutable base_provider_type must change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
    const recorded: RecordedCall[] = [];
    let configPuts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        recorded.push({
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
          // Pretend the org key already exists (created under the old base type).
          return Promise.resolve(
            new Response(
              JSON.stringify({
                keys: [
                  { id: 'kid-D', name: `tale-${ORG}-deepseek`, models: [] },
                ],
              }),
              { status: 200 },
            ),
          );
        }
        // Config PUT (no /keys): first attempt 400s on the immutable base type,
        // the post-delete retry succeeds.
        if (method === 'PUT' && !u.includes('/keys')) {
          configPuts += 1;
          if (configPuts === 1) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  error: {
                    message:
                      'Invalid custom provider config: provider deepseek: base_provider_type cannot be changed from openai to anthropic after creation',
                  },
                }),
                { status: 400 },
              ),
            );
          }
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    await mod.provisionProviders(ORG, [{ ...CUSTOM, apiFormat: 'anthropic' }]);
    const methodsAndPaths = recorded
      .filter((c) => c.method !== 'GET')
      .map((c) => `${c.method} ${new URL(c.url).pathname}`);
    // First PUT 400s → DELETE the record → PUT recreates → POST a fresh key
    // (NOT PUT — the delete wiped the previously-existing key).
    expect(methodsAndPaths).toEqual([
      'PUT /api/providers/deepseek',
      'DELETE /api/providers/deepseek',
      'PUT /api/providers/deepseek',
      'POST /api/providers/deepseek/keys',
    ]);
    expect(configPuts).toBe(2);
    warn.mockRestore();
  });

  it('treats a Bifrost standard provider (fireworks) natively — no base_url, no custom_provider_config', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.provisionProviders(ORG, [
      {
        name: 'fireworks',
        apiKey: 'key-F',
        baseUrl: 'https://api.fireworks.ai/inference/v1',
        models: ['fireworks:some-model'],
      },
    ]);
    const w = writes(calls);
    expect(w[0]?.body?.custom_provider_config).toBeUndefined();
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    expect(networkConfig.base_url).toBeUndefined();
  });

  it('skips an unchanged custom provider but re-provisions on a base_url change (baseUrl is in the fingerprint)', async () => {
    const mod = await loadModule();
    const deepseekKeyName = `tale-${ORG}-deepseek`;
    const recorded: RecordedCall[] = [];
    let keyExists = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const u = String(url);
        recorded.push({
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
                keys: keyExists
                  ? [{ id: 'kid-D', name: deepseekKeyName, models: [] }]
                  : [],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    // 1. create (memo set with a baseUrl-inclusive fingerprint).
    await mod.provisionProviders(ORG, [CUSTOM]);
    keyExists = true;
    recorded.length = 0;
    // 2. same config + key present → fully skipped (one GET, no writes).
    await mod.provisionProviders(ORG, [CUSTOM]);
    expect(writes(recorded)).toEqual([]);
    recorded.length = 0;
    // 3. base_url changed → memo busts → rewrite (config PUT + key PUT rotate).
    await mod.provisionProviders(ORG, [
      { ...CUSTOM, baseUrl: 'https://proxy.example.com/v1' },
    ]);
    const w = writes(recorded);
    expect(w.map((c) => c.method)).toEqual(['PUT', 'PUT']);
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    expect(networkConfig.base_url).toBe('https://proxy.example.com');
  });

  it('one failing provider does not abort the reconcile (others still provision)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
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
            new Response(JSON.stringify({ keys: [] }), { status: 200 }),
          );
        }
        // The bad provider's config PUT 500s; everything else succeeds.
        if (u.includes('/providers/broken')) {
          return Promise.resolve(new Response('{}', { status: 500 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    await mod.provisionProviders(ORG, [
      { ...CUSTOM, name: 'broken', baseUrl: 'https://broken.example.com/v1' },
      CUSTOM,
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("provider 'broken'"),
      expect.anything(),
    );
    // The good provider after the failing one still got its config + key.
    const goodWrites = calls.filter(
      (c) => c.method !== 'GET' && c.url.includes('/providers/deepseek'),
    );
    expect(
      goodWrites.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    ).toEqual([
      'PUT /api/providers/deepseek',
      'POST /api/providers/deepseek/keys',
    ]);
  });
});

describe('reprovisionProvider', () => {
  it('creates the org key on a fresh process', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.reprovisionProvider(ORG, PROVIDER);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(writes(calls)[1]?.body?.name).toBe(KEY_NAME);
  });

  it('skips a custom provider with no base URL (warns, no gateway calls)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
    const calls = stubBifrost({});
    // Non-standard name + no baseUrl → nothing to point a custom provider at.
    await mod.reprovisionProvider(ORG, { ...PROVIDER, name: 'my-custom-llm' });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("custom provider 'my-custom-llm'"),
    );
  });

  it('sends Basic auth when BIFROST_ADMIN_PASSWORD is set', async () => {
    vi.stubEnv('BIFROST_ADMIN_PASSWORD', 'hunter2');
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.reprovisionProvider(ORG, PROVIDER);
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('admin:hunter2').toString('base64')}`,
    );
  });

  it('throws on a failed write (eager push owns the degrade posture)', async () => {
    const mod = await loadModule();
    stubBifrost({ keyExists: false, writeStatus: 500 });
    // Unlike provisionProviders (resilient), reprovisionProvider surfaces the
    // failure to its caller — the provider-save action decides how to degrade.
    await expect(mod.reprovisionProvider(ORG, PROVIDER)).rejects.toThrow(
      /failed \(500\)/,
    );
  });
});

describe('mintVirtualKey', () => {
  /** Stub: GET keys returns the org's key id; POST virtual-keys echoes a key. */
  function stubMint(opts: { keyExists?: boolean }): RecordedCall[] {
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              virtual_key: { id: 'vk-1', value: 'sk-bf-xyz' },
            }),
            { status: 200 },
          ),
        );
      }),
    );
    return calls;
  }

  it('binds the VK to the org key id with allow_all_keys:false + scoped allowed_models', async () => {
    const mod = await loadModule();
    const calls = stubMint({ keyExists: true });
    const out = await mod.mintVirtualKey({
      budgetCents: 100,
      allowedModels: ['openrouter:deepseek/deepseek-v4-flash@fp8'],
      organizationId: ORG,
      sessionId: 'sess-1',
    });
    expect(out).toEqual({ key: 'sk-bf-xyz', keyId: 'vk-1' });
    const mintCall = calls.find(
      (c) => c.method === 'POST' && c.url.includes('/governance/virtual-keys'),
    );
    const pc = (
      mintCall?.body?.provider_configs as
        | Array<Record<string, unknown>>
        | undefined
    )?.[0];
    expect(pc).toMatchObject({
      provider: 'openrouter',
      key_ids: ['kid-A'],
      allow_all_keys: false,
    });
    expect(pc?.allowed_models).toContain(
      'openrouter/deepseek/deepseek-v4-flash',
    );
    expect(
      (pc?.allowed_models as string[] | undefined)?.length,
    ).toBeGreaterThan(0);
  });

  it('fails closed (throws, never mints) when the org has no provider key', async () => {
    const mod = await loadModule();
    const calls = stubMint({ keyExists: false });
    await expect(
      mod.mintVirtualKey({
        budgetCents: 100,
        allowedModels: ['openrouter:deepseek/deepseek-v4-flash@fp8'],
        organizationId: ORG,
        sessionId: 'sess-1',
      }),
    ).rejects.toThrow(/no gateway key/);
    // never reached the mint POST
    expect(calls.some((c) => c.url.includes('/governance/virtual-keys'))).toBe(
      false,
    );
  });

  it('binds a CUSTOM provider model to its per-model gateway record', async () => {
    const mod = await loadModule();
    const perModelKeyName = `tale-${ORG}-deepseek__deepseek-v4-flash`;
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
                keys: [{ id: 'kid-D', name: perModelKeyName, models: [] }],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ virtual_key: { id: 'vk-2', value: 'sk-bf-2' } }),
            { status: 200 },
          ),
        );
      }),
    );
    await mod.mintVirtualKey({
      budgetCents: 100,
      allowedModels: ['deepseek:deepseek-v4-flash'],
      organizationId: ORG,
      sessionId: 'sess-1',
    });
    // The key lookup hits the per-model gateway provider record.
    expect(
      calls.some((c) =>
        c.url.includes('/api/providers/deepseek__deepseek-v4-flash/keys'),
      ),
    ).toBe(true);
    const mintCall = calls.find(
      (c) => c.method === 'POST' && c.url.includes('/governance/virtual-keys'),
    );
    const pc = (
      mintCall?.body?.provider_configs as
        | Array<Record<string, unknown>>
        | undefined
    )?.[0];
    expect(pc).toMatchObject({
      provider: 'deepseek__deepseek-v4-flash',
      key_ids: ['kid-D'],
      allow_all_keys: false,
    });
    expect(pc?.allowed_models).toEqual(
      expect.arrayContaining([
        'deepseek-v4-flash',
        'deepseek__deepseek-v4-flash/deepseek-v4-flash',
      ]),
    );
  });
});

describe('resolveGatewayRouting', () => {
  it('routes a standard provider by slug (unchanged)', async () => {
    const mod = await loadModule();
    expect(
      mod.resolveGatewayRouting('openrouter', 'deepseek/deepseek-v4-flash'),
    ).toEqual({
      gatewayProvider: 'openrouter',
      gatewayModel: 'openrouter/deepseek/deepseek-v4-flash',
    });
    expect(mod.isStandardGatewayProvider('openrouter')).toBe(true);
  });

  it('routes a custom provider to a per-model upstream', async () => {
    const mod = await loadModule();
    expect(mod.resolveGatewayRouting('deepseek', 'deepseek-v4-flash')).toEqual({
      gatewayProvider: 'deepseek__deepseek-v4-flash',
      gatewayModel: 'deepseek__deepseek-v4-flash/deepseek-v4-flash',
    });
    expect(mod.isStandardGatewayProvider('deepseek')).toBe(false);
  });

  it('resolves from a full Tale ref, stripping the quantization qualifier', async () => {
    const mod = await loadModule();
    expect(
      mod.resolveGatewayRoutingFromRef(
        'openrouter:deepseek/deepseek-v4-flash@fp8',
      ),
    ).toEqual({
      gatewayProvider: 'openrouter',
      gatewayModel: 'openrouter/deepseek/deepseek-v4-flash',
    });
    expect(
      mod.resolveGatewayRoutingFromRef('deepseek:deepseek-v4-flash'),
    ).toEqual({
      gatewayProvider: 'deepseek__deepseek-v4-flash',
      gatewayModel: 'deepseek__deepseek-v4-flash/deepseek-v4-flash',
    });
  });
});
