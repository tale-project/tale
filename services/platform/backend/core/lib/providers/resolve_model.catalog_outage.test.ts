// @vitest-environment node

import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';
import { AppError } from '../../../../lib/shared/errors/app-error';
import {
  CATALOG_FAILURE_BACKOFF_MS,
  CATALOG_TTL_MS,
  invalidateCatalogFetchCache,
} from './catalog_fetch';
import { resolveProvidersForOrgId } from './org_providers';
import { resolveModel } from './resolve_model';

/**
 * One connector's catalog that cannot be read — a cold failure with nothing
 * cached and no shipped defaults (the Vercel AI Gateway without egress), or
 * that failure still remembered through its back-off — must not decide a
 * lookup another connector can answer. The resolver, the servable-catalog
 * read and the live-catalog cache all run for real here; only the org's
 * connector list and the network under `safeFetch` are stand-ins, so no
 * request leaves the process.
 */

vi.mock('../../../../lib/net/safe-fetch', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../../lib/net/safe-fetch')>();
  return { ...original, safeFetch: vi.fn() };
});
vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: vi.fn(),
}));

/** Walked first, as a shipped connector is: a live listing and no shipped
 * defaults to fall back on. */
const REMOTE = providerDefinitionSchema.parse({
  name: 'remote-gateway',
  displayName: 'Remote Gateway',
  apiFormat: 'openai',
  baseUrl: 'https://gateway.remote.test/v1',
  catalog: { source: 'models-endpoint' },
  auth: [{ method: 'api-key' }],
});
/** The organization's own healthy provider. */
const LOCAL = providerDefinitionSchema.parse({
  name: 'local',
  displayName: 'Local models',
  apiFormat: 'openai',
  baseUrl: 'https://models.local.test/v1',
  catalog: { source: 'models-endpoint' },
  auth: [{ method: 'api-key' }],
});
/** A catalog-less connector: its default credential's allowlist is its
 * catalog (the picker lane's `itestdeploy`). */
const DEPLOY = providerDefinitionSchema.parse({
  name: 'deploy',
  displayName: 'Deployments',
  apiFormat: 'openai',
  baseUrl: 'https://deploy.local.test/v1',
  catalog: { source: 'none' },
  auth: [{ method: 'api-key' }],
});

const REMOTE_LISTING = 'https://gateway.remote.test/v1/models';
const LOCAL_LISTING = 'https://models.local.test/v1/models';
/** What the refused connection says — the resolver's refusals must not. */
const RAW_FAILURE = 'connect ECONNREFUSED 203.0.113.7:443';

function listing(ids: readonly string[]) {
  return {
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: JSON.stringify({
      data: ids.map((id) => ({ id, context_length: 32_768 })),
    }),
    finalUrl: '',
  };
}

/** The network as each listing answers it: the remote one refused (a
 * synthetic network error) or listing these ids, the local one listing its
 * ids. Any other request is a test bug. */
function network(
  remote: 'down' | readonly string[],
  local: readonly string[],
): void {
  vi.mocked(safeFetch).mockImplementation(async (url: string) => {
    if (url === REMOTE_LISTING) {
      if (remote === 'down') {
        throw new SafeFetchError('network_error', RAW_FAILURE);
      }
      return listing(remote);
    }
    if (url === LOCAL_LISTING) return listing(local);
    throw new Error(`unexpected request to ${url}`);
  });
}

/** Requests one listing has received so far. */
function requests(url: string): number {
  return vi.mocked(safeFetch).mock.calls.filter(([called]) => called === url)
    .length;
}

function connectors(...defs: ProviderDefinition[]): void {
  vi.mocked(resolveProvidersForOrgId).mockResolvedValue(defs);
}

const runQuery = vi.fn();
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver reaches ctx only through runQuery (catalog-less credentials)
const ctx = { runQuery } as never;

type Outcome =
  | { ok: true; value: Awaited<ReturnType<typeof resolveModel>> }
  | { ok: false; error: unknown };

/** Resolve with the catalog's retry ladder run on the fake clock; settles
 * either way, so a refusal is asserted rather than reported unhandled. */
async function resolve(
  modelId: string,
  providerSlug?: string,
  strict?: boolean,
): Promise<Outcome> {
  const settled = resolveModel(
    ctx,
    'org-1',
    modelId,
    providerSlug,
    strict,
  ).then(
    (value): Outcome => ({ ok: true, value }),
    (error: unknown): Outcome => ({ ok: false, error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

/** The code and sentence of a typed platform refusal — the only kind the
 * send door answers as a refusal (`servingRefusalReason`); anything else is
 * rethrown as the fault it is. */
function refusal(outcome: Outcome): { code: unknown; message: string } {
  if (outcome.ok) throw new Error('expected a refusal, got a resolution');
  if (!(outcome.error instanceof AppError)) throw outcome.error;
  const data: unknown = outcome.error.data;
  if (data === null || typeof data !== 'object') {
    throw new Error('a refusal without data');
  }
  return {
    code: 'code' in data ? data.code : undefined,
    message:
      'message' in data && typeof data.message === 'string' ? data.message : '',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  invalidateCatalogFetchCache();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('resolveModel past an unreadable catalog', () => {
  it('resolves an unhinted model on a later provider when an unrelated catalog fails cold', async () => {
    connectors(REMOTE, LOCAL);
    network('down', ['local-chat']);

    const outcome = await resolve('local-chat');

    expect(outcome).toMatchObject({
      ok: true,
      value: { connector: { name: 'local' }, entry: { id: 'local-chat' } },
    });
    // It was asked, and failed — every attempt of the retry ladder — and the
    // skip is on the log under the connector's name.
    expect(requests(REMOTE_LISTING)).toBe(3);
    expect(console.warn).toHaveBeenCalledWith(
      '[resolve-model] could not resolve catalog for "remote-gateway"',
      RAW_FAILURE,
    );
  });

  it('keeps resolving while that failure is remembered, without asking the listing again', async () => {
    connectors(REMOTE, LOCAL);
    network('down', ['local-chat']);
    await resolve('local-chat');
    expect(requests(REMOTE_LISTING)).toBe(3);

    expect(await resolve('local-chat')).toMatchObject({
      ok: true,
      value: { connector: { name: 'local' } },
    });
    expect(requests(REMOTE_LISTING)).toBe(3);

    // The back-off lapses: the listing is asked anew, and resolution still
    // does not depend on it.
    vi.advanceTimersByTime(CATALOG_FAILURE_BACKOFF_MS);
    expect(await resolve('local-chat')).toMatchObject({
      ok: true,
      value: { connector: { name: 'local' } },
    });
    expect(requests(REMOTE_LISTING)).toBe(6);
  });

  it.each([
    ['names a provider the organization no longer has', 'retired'],
    ['names the provider whose catalog is unreadable', 'remote-gateway'],
  ])('falls back past a non-strict hint that %s', async (_label, hint) => {
    connectors(REMOTE, LOCAL);
    network('down', ['local-chat']);

    expect(await resolve('local-chat', hint)).toMatchObject({
      ok: true,
      value: { connector: { name: 'local' }, entry: { id: 'local-chat' } },
    });
  });

  it('resolves a matching hint on the hinted provider before any other is read', async () => {
    connectors(REMOTE, LOCAL);
    network('down', ['local-chat']);

    expect(await resolve('local-chat', 'local')).toMatchObject({
      ok: true,
      value: { connector: { name: 'local' } },
    });
    expect(requests(REMOTE_LISTING)).toBe(0);
  });

  it('resolves a strict choice on the chosen provider and never reads another', async () => {
    connectors(REMOTE, LOCAL);
    network('down', ['local-chat']);

    expect(await resolve('local-chat', 'local', true)).toMatchObject({
      ok: true,
      value: { connector: { name: 'local' } },
    });
    expect(requests(REMOTE_LISTING)).toBe(0);
  });

  it('refuses a strict choice whose catalog is unreadable, never moving it to a provider that lists the id', async () => {
    connectors(REMOTE, LOCAL);
    network('down', ['shared-chat']);

    const { code, message } = refusal(
      await resolve('shared-chat', 'remote-gateway', true),
    );

    expect(code).toBe('CHAT_PROVIDER_UNAVAILABLE');
    expect(message).toContain('"remote-gateway"');
    expect(message).toContain('"shared-chat"');
    expect(message).toContain(
      '(the catalog for "remote-gateway" was unreachable)',
    );
    expect(message).not.toContain('ECONNREFUSED');
    expect(message).not.toContain('203.0.113.7');
    expect(requests(LOCAL_LISTING)).toBe(0);

    // Remembered, it refuses the same way without another request.
    expect(
      refusal(await resolve('shared-chat', 'remote-gateway', true)).code,
    ).toBe('CHAT_PROVIDER_UNAVAILABLE');
    expect(requests(REMOTE_LISTING)).toBe(3);
    expect(requests(LOCAL_LISTING)).toBe(0);
  });

  it('refuses an unknown model as CHAT_MODEL_UNKNOWN, naming the unreadable catalog but not its error', async () => {
    connectors(REMOTE, LOCAL);
    network('down', ['local-chat']);

    for (const round of ['cold', 'remembered']) {
      const { code, message } = refusal(await resolve('retired-model'));
      expect(code, round).toBe('CHAT_MODEL_UNKNOWN');
      expect(message, round).toContain('No model "retired-model"');
      expect(message, round).toContain(
        '(the catalog for "remote-gateway" was unreachable)',
      );
      expect(message, round).not.toContain('ECONNREFUSED');
      expect(message, round).not.toContain('203.0.113.7');
      expect(message, round).not.toContain('gateway.remote.test');
    }
    expect(requests(REMOTE_LISTING)).toBe(3);
  });

  it('keeps the plain refusal for an unknown model when every catalog was read', async () => {
    connectors(REMOTE, LOCAL);
    network(['remote-chat'], ['local-chat']);

    const { code, message } = refusal(await resolve('retired-model'));

    expect(code).toBe('CHAT_MODEL_UNKNOWN');
    expect(message).toBe(
      'No model "retired-model" is available in this organization. Pick a model the organization has configured.',
    );
  });

  it('refuses a stale pick whose catalog-less provider lost its default credential, past the unreadable catalog', async () => {
    connectors(REMOTE, DEPLOY);
    network('down', []);
    runQuery.mockResolvedValue({
      status: 'disabled',
      authMethod: 'api-key',
      modelAllowlist: ['deploy-prod'],
    });

    const { code, message } = refusal(await resolve('deploy-prod', 'deploy'));

    expect(code).toBe('CHAT_MODEL_UNKNOWN');
    expect(message).toContain('"deploy-prod"');
  });

  it('lets a failed credential read through — only a catalog read is skipped', async () => {
    connectors(DEPLOY, LOCAL);
    network('down', ['local-chat']);
    runQuery.mockRejectedValue(new Error('credential store unavailable'));

    const outcome = await resolve('local-chat');

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? undefined : outcome.error).toEqual(
      new Error('credential store unavailable'),
    );
    expect(requests(LOCAL_LISTING)).toBe(0);
  });

  it('still serves the last good catalog of a provider whose refresh fails', async () => {
    connectors(REMOTE, LOCAL);
    network(['remote-chat'], ['local-chat']);
    expect(await resolve('remote-chat')).toMatchObject({
      ok: true,
      value: { connector: { name: 'remote-gateway' } },
    });

    network('down', ['local-chat']);
    vi.advanceTimersByTime(CATALOG_TTL_MS);

    expect(await resolve('remote-chat')).toMatchObject({
      ok: true,
      value: { connector: { name: 'remote-gateway' } },
    });
    // The refresh was attempted and failed; the previous listing served.
    expect(requests(REMOTE_LISTING)).toBe(4);
  });
});
