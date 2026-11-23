// @vitest-environment node

/**
 * The client of the sandbox LLM gateway an earlier release ran: what the
 * settlement of the keys it minted, and a deleted organization's teardown,
 * still ask of it — and how it reads a gateway whose container was retired
 * (its name no longer resolves) apart from one that is away for a while.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup }));

const ORG = 'org_1';

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Stub fetch: `answer` decides each call's reply from its method and URL
 * and how often that method+URL was called before. Returns the recorded
 * calls, in order. */
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
      calls.push({
        url: u,
        method,
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      const key = `${method} ${u}`;
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      return Promise.resolve(answer(method, u, count));
    }),
  );
  return calls;
}

/** Stub fetch so every call fails the way `error` says, before any answer. */
function stubFailure(error: unknown): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: undefined,
        headers: {},
      });
      return Promise.reject(error);
    }),
  );
  return calls;
}

/** What Node's fetch throws for a name the resolver says does not exist: the
 * resolver's error rides as the cause. */
function nodeLookupFailure(code: string, host = 'sandbox-llm-gateway') {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`getaddrinfo ${code} ${host}`), {
      code,
      syscall: 'getaddrinfo',
      hostname: host,
    }),
  });
}

/** Bun's fetch throws the resolver's error as it is. */
function bunLookupFailure(code: string, host = 'sandbox-llm-gateway') {
  return Object.assign(new TypeError(`getaddrinfo ${code} ${host}`), {
    code,
    syscall: 'getaddrinfo',
    hostname: host,
  });
}

/** A refused connection, as Node's fetch reports it. */
const REFUSED = new TypeError('fetch failed', {
  cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:8080'), {
    code: 'ECONNREFUSED',
  }),
});

/** A call past its 15 s bound. */
const TIMED_OUT = new DOMException(
  'The operation was aborted due to timeout',
  'TimeoutError',
);

/** Fresh module instance, so the once-per-process notice starts unsaid. */
async function loadModule() {
  vi.resetModules();
  return import('./llm_gateway_admin');
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

// Every management call needs the admin password; give every test a default
// so only the cases below vary it.
const DEFAULT_PW = 'pw-test';
const basicFor = (pw: string) =>
  `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}`;

beforeEach(() => {
  vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', DEFAULT_PW);
  vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', undefined);
  vi.stubEnv('SANDBOX_LLM_GATEWAY_URL', undefined);
  vi.stubEnv('LLM_GATEWAY_URL', undefined);
  lookup.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('management-plane auth', () => {
  it('sends Basic auth from SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD on every management call, and nothing else that carries it', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-1');
    // The empty key reads as unmetered, which the client says.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await mod.revokeVirtualKey('vk-1');
    await mod.readVirtualKeySpend('vk-1');
    await mod.setVirtualKeyBudget('vk-1', 100);
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      expect(call.headers.authorization).toBe(basicFor('pw-1'));
      expect(Object.keys(call.headers).sort()).toEqual([
        'authorization',
        'content-type',
      ]);
    }
  });

  it('falls back to the pre-rename LLM_GATEWAY_ADMIN_PASSWORD env name', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', 'pw-old');
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await mod.revokeVirtualKey('vk-1');
    expect(calls[0]?.headers.authorization).toBe(basicFor('pw-old'));
  });

  it('calls the gateway at SANDBOX_LLM_GATEWAY_URL, else at its old address', async () => {
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await mod.revokeVirtualKey('vk-1');
    vi.stubEnv('SANDBOX_LLM_GATEWAY_URL', 'http://10.0.0.7:9090');
    await mod.revokeVirtualKey('vk-2');
    expect(calls.map((call) => call.url)).toEqual([
      'http://sandbox-llm-gateway:8080/api/governance/virtual-keys/vk-1',
      'http://10.0.0.7:9090/api/governance/virtual-keys/vk-2',
    ]);
  });
});

/**
 * The gateway's SQLite store turns away a write that collides with another
 * one, answering 500 — with "database is locked" in the body, except a
 * virtual key's DELETE, which says only that it failed. Every call the
 * client still makes is idempotent.
 */
describe('management calls the gateway store turned away for a moment', () => {
  it('repeats a call whatever its 5xx says, waiting 250, 750 and 2000 ms, then answers the last refusal', async () => {
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

  it('lands a cap move whose write met the locked store once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubAnswers((method, _url, seen) => {
      if (method === 'GET') {
        return Response.json({
          virtual_key: { id: 'vk-1', budgets: [{ id: 'budget-1' }] },
        });
      }
      return seen === 0
        ? new Response(
            '{"error":{"message":"failed to update: database is locked"}}',
            { status: 500 },
          )
        : Response.json({});
    });
    const mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.setVirtualKeyBudget('vk-1', 200)),
    ).resolves.toBe('ok');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
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

describe('revokeVirtualKey', () => {
  it('DELETEs the key and tolerates 404', async () => {
    let calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await mod.revokeVirtualKey('vk-1');
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: expect.stringContaining('/api/governance/virtual-keys/vk-1'),
    });

    vi.unstubAllGlobals();
    calls = stubAnswers(() => new Response('{}', { status: 404 }));
    await expect(mod.revokeVirtualKey('vk-1')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('throws on a non-404 failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubAnswers(() => new Response('{}', { status: 500 }));
    const mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.revokeVirtualKey('vk-1')),
    ).rejects.toThrow('llm-gateway revoke key failed (500)');
  });
});

describe('setVirtualKeyBudget', () => {
  /** A gateway holding one key whose one budget row is `budget-1`. */
  function stubKey(options: { getStatus?: number; putStatus?: number } = {}) {
    return stubAnswers((method) =>
      method === 'GET'
        ? new Response(
            JSON.stringify({
              virtual_key: {
                id: 'vk-1',
                budgets: [{ id: 'budget-1', max_limit: 5, current_usage: 1.2 }],
              },
            }),
            { status: options.getStatus ?? 200 },
          )
        : new Response('{"error":{"message":"refused"}}', {
            status: options.putStatus ?? 200,
          }),
    );
  }

  it("moves the key's one budget row to the new cap, in dollars", async () => {
    const calls = stubKey();
    const mod = await loadModule();
    await expect(mod.setVirtualKeyBudget('vk-1', 350)).resolves.toBe('ok');
    expect(calls[1]).toMatchObject({
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

describe('readVirtualKeySpend', () => {
  it('reads the live figure of the largest budget, in cents', async () => {
    const calls = stubAnswers(() =>
      Response.json({
        virtual_key: {
          budgets: [{ current_usage: 0.12 }, { current_usage: 0.3456 }],
        },
      }),
    );
    const mod = await loadModule();
    const reading = await mod.readVirtualKeySpend('vk-1');
    expect(reading.status).toBe('ok');
    expect(reading.status === 'ok' ? reading.cents : 0).toBeCloseTo(34.56, 9);
    expect(calls[0]?.url).toContain(
      '/api/governance/virtual-keys/vk-1?from_memory=true',
    );
  });

  it('falls back to the stored row before it calls a key gone', async () => {
    let calls = stubAnswers((_method, url) =>
      url.endsWith('?from_memory=true')
        ? new Response('{}', { status: 404 })
        : Response.json({ virtual_key: { budgets: [{ current_usage: 1 }] } }),
    );
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).resolves.toEqual({
      status: 'ok',
      cents: 100,
    });
    expect(calls).toHaveLength(2);

    vi.unstubAllGlobals();
    calls = stubAnswers(() => new Response('{}', { status: 404 }));
    await expect(mod.readVirtualKeySpend('vk-1')).resolves.toEqual({
      status: 'gone',
    });
    expect(calls).toHaveLength(2);
  });

  it('flags a key held without a budget as unmetered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubAnswers(() => Response.json({ virtual_key: { budgets: [] } }));
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).resolves.toEqual({
      status: 'ok',
      cents: 0,
      unmetered: true,
    });
  });

  it('answers unavailable while the gateway answers a 5xx, so the key is kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubAnswers(() => new Response('{}', { status: 503 }));
    const mod = await loadModule();
    await expect(
      withRetryWaitsElapsed(() => mod.readVirtualKeySpend('vk-1')),
    ).resolves.toEqual({ status: 'unavailable' });
  });
});

/**
 * The gateway's container was retired: Docker no longer answers to its name,
 * and the resolver says so (`ENOTFOUND`). Nothing it held can be read or
 * changed again, so nothing may wait for it.
 */
describe('a retired gateway: its name no longer resolves', () => {
  it.each([
    ['Node', nodeLookupFailure('ENOTFOUND')],
    ['Bun', bunLookupFailure('ENOTFOUND')],
  ])(
    "closes a key's spend without a figure, as Node and Bun report it (%s) [SBX-R15]",
    async (_runtime, failure) => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const calls = stubFailure(failure);
      const mod = await loadModule();
      await expect(mod.readVirtualKeySpend('vk-1')).resolves.toEqual({
        status: 'gone',
      });
      // One look is enough: no second read of the stored row.
      expect(calls).toHaveLength(1);
    },
  );

  it('has nothing to revoke and no cap to move', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const calls = stubFailure(nodeLookupFailure('ENOTFOUND'));
    const mod = await loadModule();
    await expect(mod.revokeVirtualKey('vk-1')).resolves.toBeUndefined();
    await expect(mod.setVirtualKeyBudget('vk-1', 100)).resolves.toBe('gone');
    expect(calls).toHaveLength(2);
  });

  it("has nothing of a deleted organization's to remove [SBX-R13]", async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFailure(nodeLookupFailure('ENOTFOUND'));
    const mod = await loadModule();
    await expect(mod.removeOrganizationFromGateway(ORG)).resolves.toEqual({
      records: 0,
      keys: 0,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('stops a removal the retirement cut short, with what it had removed', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let listed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        if (!listed && path === '/api/providers') {
          listed = true;
          return Promise.resolve(
            Response.json({
              providers: [{ name: `${ORG}__acme__llama` }, { name: 'openai' }],
            }),
          );
        }
        if (init?.method === 'DELETE' && path.endsWith(`${ORG}__acme__llama`)) {
          return Promise.resolve(Response.json({}));
        }
        return Promise.reject(nodeLookupFailure('ENOTFOUND'));
      }),
    );
    const mod = await loadModule();
    await expect(mod.removeOrganizationFromGateway(ORG)).resolves.toEqual({
      records: 1,
      keys: 0,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('says once per process that the gateway is retired', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    stubFailure(nodeLookupFailure('ENOTFOUND'));
    const mod = await loadModule();
    await mod.readVirtualKeySpend('vk-1');
    await mod.readVirtualKeySpend('vk-2');
    await mod.revokeVirtualKey('vk-3');
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain(
      'the sandbox LLM gateway at http://sandbox-llm-gateway:8080 no longer resolves: it is retired',
    );
  });
});

/**
 * A gateway away for a while — a lookup the resolver could not finish, a
 * refused connection, a call past its bound — is not a retired one: the
 * settlement keeps the key and tries again.
 */
describe('a gateway away for a while is not retired', () => {
  it.each([
    ['a lookup the resolver could not finish', nodeLookupFailure('EAI_AGAIN')],
    ['the same, as Bun reports it', bunLookupFailure('EAI_AGAIN')],
    ['a refused connection', REFUSED],
    ['a call past its bound', TIMED_OUT],
  ])(
    '%s fails a spend read, a revoke and a cap move',
    async (_label, failure) => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      stubFailure(failure);
      const mod = await loadModule();
      await expect(mod.readVirtualKeySpend('vk-1')).rejects.toBe(failure);
      await expect(mod.revokeVirtualKey('vk-1')).rejects.toBe(failure);
      await expect(mod.setVirtualKeyBudget('vk-1', 100)).rejects.toBe(failure);
      await expect(mod.removeOrganizationFromGateway(ORG)).rejects.toBe(
        failure,
      );
      expect(info).not.toHaveBeenCalled();
    },
  );
});

/**
 * `tale deploy` says the gateway is retired: once its container is gone it
 * starts every backend role with SANDBOX_LLM_GATEWAY_URL empty. That holds
 * where the resolver could never say a gone name does not exist, a host
 * without a reachable DNS server answering every lookup it does not know
 * with EAI_AGAIN.
 */
describe('a gateway the deployment says is retired: an empty address', () => {
  beforeEach(() => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_URL', '');
    lookup.mockRejectedValue(
      Object.assign(new Error('getaddrinfo EAI_AGAIN sandbox-llm-gateway'), {
        code: 'EAI_AGAIN',
      }),
    );
  });

  it('closes a key without a figure, with no lookup and no call [SBX-R15]', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const calls = stubFailure(nodeLookupFailure('EAI_AGAIN'));
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).resolves.toEqual({
      status: 'gone',
    });
    await expect(mod.revokeVirtualKey('vk-1')).resolves.toBeUndefined();
    await expect(mod.setVirtualKeyBudget('vk-1', 100)).resolves.toBe('gone');
    expect(calls).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['with the admin password', DEFAULT_PW],
    ['without it', undefined],
  ])(
    "has nothing of a deleted organization's to remove, %s [SBX-R13]",
    async (_label, password) => {
      vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', password);
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const calls = stubFailure(nodeLookupFailure('EAI_AGAIN'));
      const mod = await loadModule();
      await expect(mod.removeOrganizationFromGateway(ORG)).resolves.toEqual({
        records: 0,
        keys: 0,
      });
      expect(calls).toHaveLength(0);
      expect(lookup).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('reads a blank address as an empty one, and says once that the deployment retired the gateway', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_URL', '  ');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const calls = stubFailure(nodeLookupFailure('EAI_AGAIN'));
    const mod = await loadModule();
    await mod.readVirtualKeySpend('vk-1');
    await mod.revokeVirtualKey('vk-2');
    expect(calls).toHaveLength(0);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain(
      'the deployment runs no sandbox LLM gateway any more (SANDBOX_LLM_GATEWAY_URL is empty): it is retired',
    );
  });
});

/**
 * A new install never ran the gateway and carries no admin password. A
 * deployment that did, and lost the password, still has a gateway that
 * answers to its name.
 */
describe('a deployment without the admin password', () => {
  beforeEach(() => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', undefined);
  });

  it("has nothing of a deleted organization's to remove, and asks nobody [SBX-R13]", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await expect(mod.removeOrganizationFromGateway(ORG)).resolves.toEqual({
      records: 0,
      keys: 0,
    });
    expect(calls).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('treats a blank password as none', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', '   ');
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await expect(mod.removeOrganizationFromGateway(ORG)).resolves.toEqual({
      records: 0,
      keys: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("closes a key without a figure once the gateway's name no longer resolves, a snapshot restored where no gateway runs [SBX-R15]", async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    lookup.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND sandbox-llm-gateway'), {
        code: 'ENOTFOUND',
      }),
    );
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).resolves.toEqual({
      status: 'gone',
    });
    await expect(mod.revokeVirtualKey('vk-1')).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('sandbox-llm-gateway');
    // No call goes out without credentials.
    expect(calls).toHaveLength(0);
  });

  it('refuses to settle against a gateway that still answers to its name, saying what is missing', async () => {
    lookup.mockResolvedValue({ address: '172.18.0.9', family: 4 });
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).rejects.toThrow(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set',
    );
    await expect(mod.revokeVirtualKey('vk-1')).rejects.toThrow(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set',
    );
    expect(calls).toHaveLength(0);
  });

  it('asks no resolver for a gateway at an address, and keeps the key', async () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_URL', 'http://[fd00::7]:8080');
    const calls = stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).rejects.toThrow(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set',
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('keeps the key while the resolver cannot finish its lookup', async () => {
    const unfinished = Object.assign(
      new Error('getaddrinfo EAI_AGAIN sandbox-llm-gateway'),
      { code: 'EAI_AGAIN' },
    );
    lookup.mockRejectedValue(unfinished);
    stubAnswers(() => Response.json({}));
    const mod = await loadModule();
    await expect(mod.readVirtualKeySpend('vk-1')).rejects.toBe(unfinished);
  });
});

describe('removeOrganizationFromGateway', () => {
  type Key = { id: string; name: string };

  /**
   * A management plane that keeps its provider records and their keys:
   *   GET    /api/providers               → every record's name
   *   GET    /api/providers/:p/keys       → its keys (404 for no record)
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
        if (keys === undefined || provider === undefined) {
          return Promise.resolve(new Response('not found', { status: 404 }));
        }
        if (method === 'GET' && sub === 'keys') return json({ keys });
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
