import { afterEach, describe, expect, it, vi } from 'vitest';

const PROVIDER = {
  name: 'openrouter',
  apiKey: 'key-A',
  models: ['openrouter:anthropic/claude-sonnet-4.6@fp8'],
};

interface RecordedCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string>;
}

/**
 * Stub global fetch with a minimal Bifrost management plane: GET
 * /api/providers lists `listNames`; PUT answers with `putStatus`. Returns the
 * recorded calls, in order.
 */
function stubBifrost(opts: {
  listNames?: string[];
  putStatus?: number;
}): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url: String(url),
        method,
        body:
          typeof init?.body === 'string'
            ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
              (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            providers: (opts.listNames ?? []).map((name) => ({ name })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: opts.putStatus ?? 200 });
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
  it('PUTs an absent provider with the gateway-shaped body (no base_url override)', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ listNames: [] });
    await mod.provisionProviders([PROVIDER]);
    const w = writes(calls);
    expect(w.map((c) => c.method)).toEqual(['PUT']);
    expect(w[0]?.url).toContain('/api/providers/openrouter');
    expect(w[0]?.body).toMatchObject({
      keys: [
        {
          // Globally unique per push (config_keys.idx_key_name).
          name: expect.stringMatching(/^tale-openrouter-[0-9a-f]{12}$/),
          value: 'key-A',
          // Colon → slash, quantization qualifier stripped.
          models: ['openrouter/anthropic/claude-sonnet-4.6'],
          weight: 1,
        },
      ],
      network_config: { default_request_timeout_in_seconds: 600 },
    });
    const networkConfig = w[0]?.body?.network_config as Record<string, unknown>;
    expect(networkConfig.base_url).toBeUndefined();
    // PUT body carries no provider field — the name rides in the URL.
    expect(w[0]?.body?.provider).toBeUndefined();
  });

  it('skips a present provider whose fingerprint matches the last push', async () => {
    const mod = await loadModule();
    stubBifrost({ listNames: [] });
    await mod.provisionProviders([PROVIDER]);
    const calls = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([PROVIDER]);
    expect(writes(calls)).toEqual([]);
  });

  it('rewrites a present-but-unknown provider once (fresh process), then skips', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([PROVIDER]);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT']);
    const again = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([PROVIDER]);
    expect(writes(again)).toEqual([]);
  });

  it('rewrites when the gateway lost the record even though the memo matches', async () => {
    const mod = await loadModule();
    stubBifrost({ listNames: [] });
    await mod.provisionProviders([PROVIDER]);
    // e.g. bifrost-data volume wiped while this process stayed alive
    const calls = stubBifrost({ listNames: [] });
    await mod.provisionProviders([PROVIDER]);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT']);
  });

  it('rewrites when the key rotates', async () => {
    const mod = await loadModule();
    stubBifrost({ listNames: [] });
    await mod.provisionProviders([PROVIDER]);
    const calls = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([{ ...PROVIDER, apiKey: 'key-B' }]);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT']);
    expect(writes(calls)[0]?.body?.keys).toMatchObject([{ value: 'key-B' }]);
  });

  it('rewrites when the model list changes', async () => {
    const mod = await loadModule();
    stubBifrost({ listNames: [] });
    await mod.provisionProviders([PROVIDER]);
    const calls = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([
      { ...PROVIDER, models: [...PROVIDER.models, 'openrouter:deepseek/r1'] },
    ]);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT']);
  });

  it('a failed PUT throws and leaves no memo, so the next provision retries', async () => {
    const mod = await loadModule();
    stubBifrost({ listNames: ['openrouter'], putStatus: 500 });
    await expect(mod.provisionProviders([PROVIDER])).rejects.toThrow(
      'provision provider openrouter failed (500)',
    );
    const retry = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([PROVIDER]);
    expect(writes(retry).map((c) => c.method)).toEqual(['PUT']);
    const third = stubBifrost({ listNames: ['openrouter'] });
    await mod.provisionProviders([PROVIDER]);
    expect(writes(third)).toEqual([]);
  });
});

describe('reprovisionProvider', () => {
  it('always PUTs, with a fresh unique key name per push', async () => {
    const mod = await loadModule();
    const calls = stubBifrost({});
    await mod.reprovisionProvider(PROVIDER);
    await mod.reprovisionProvider(PROVIDER);
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT', 'PUT']);
    const keyName = (call: RecordedCall | undefined) => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const keys = (call?.body?.keys ?? []) as Array<{ name: string }>;
      return keys[0]?.name;
    };
    expect(keyName(writes(calls)[0])).toBeDefined();
    expect(keyName(writes(calls)[0])).not.toBe(keyName(writes(calls)[1]));
  });

  it('skips non-native providers with a warning and no gateway calls', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();
    const calls = stubBifrost({});
    await mod.reprovisionProvider({ ...PROVIDER, name: 'my-custom-llm' });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("non-native provider 'my-custom-llm'"),
    );
  });

  it('sends Basic auth when BIFROST_ADMIN_PASSWORD is set', async () => {
    vi.stubEnv('BIFROST_ADMIN_PASSWORD', 'hunter2');
    const mod = await loadModule();
    const calls = stubBifrost({});
    await mod.reprovisionProvider(PROVIDER);
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('admin:hunter2').toString('base64')}`,
    );
  });
});
