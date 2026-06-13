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
    // provider config PUT carries no keys[] (keys are a sub-resource now) and
    // no base_url override.
    expect(w[0]?.body?.keys).toBeUndefined();
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

  it('a failed key write throws and leaves no memo, so the next provision retries', async () => {
    const mod = await loadModule();
    stubBifrost({ keyExists: false, writeStatus: 500 });
    await expect(mod.provisionProviders(ORG, [PROVIDER])).rejects.toThrow(
      /failed \(500\)/,
    );
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
});

describe('reprovisionProvider', () => {
  it('creates the org key on a fresh process', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ keyExists: false });
    await mod.reprovisionProvider(ORG, PROVIDER);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(writes(calls)[1]?.body?.name).toBe(KEY_NAME);
  });

  it('skips non-native providers with a warning and no gateway calls', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
    const calls = stubBifrost({});
    await mod.reprovisionProvider(ORG, { ...PROVIDER, name: 'my-custom-llm' });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("non-native provider 'my-custom-llm'"),
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
});
