// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch, SafeFetchError } from '../../../lib/net/safe-fetch';
import type { OrgEnv } from '../../auth/org';
import { invalidateCatalogFetchCache } from '../../core/lib/providers/catalog_fetch';
import { createProviderSettingRoutes } from './routes';

/**
 * The catalog listing the settings page and every model picker read, over
 * the REAL catalog fetch with only the network stubbed: OpenRouter (shipped,
 * live `openrouter-api` source) beside an organization's own
 * OpenAI-compatible provider (live `models-endpoint` source). Each row must
 * list its own provider's models, and the custom endpoint failing — the DNS
 * failure an operator met on a preview — must reach only its own row.
 */

const { caller } = vi.hoisted(() => ({
  caller: { role: 'admin', orgId: 'org-a', slug: 'north' },
}));
vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetch: vi.fn(),
}));
vi.mock('../provider_credentials/service', async (original) => ({
  ...(await original<typeof import('../provider_credentials/service')>()),
  resolveCatalogBearer: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config', async (original) => ({
  ...(await original<typeof import('../../lib/org-config')>()),
  resolveOrgSlug: vi.fn(async () => caller.slug),
}));
vi.mock('../../auth/session', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'operator', email: 'operator@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org', async (original) => ({
  ...(await original<typeof import('../../auth/org')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', caller.orgId);
      c.set('orgMember', { role: caller.role } as never);
      await next();
    },
}));

const mockedFetch = vi.mocked(safeFetch);

const CUSTOM_HOST = 'gateway.example.test';
const custom = {
  name: 'company-gateway',
  displayName: 'Company gateway',
  apiFormat: 'openai',
  baseUrl: `https://${CUSTOM_HOST}/v1`,
  catalog: { source: 'models-endpoint' },
  auth: [{ method: 'api-key' }, { method: 'env' }],
};

/** What OpenRouter's live listing answers: ids no other provider lists. */
const OPENROUTER_LIVE = ['openrouter-only/alpha', 'openrouter-only/beta'];
/** What the custom endpoint answers when it is reachable. */
const CUSTOM_LIVE = ['gateway-only/omega', 'gateway-only/sigma'];

function listing(ids: readonly string[]) {
  return {
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      data: ids.map((id) => ({ id, context_length: 128_000 })),
    }),
    finalUrl: 'https://example.test/models',
  };
}

/** Route the network per host: OpenRouter answers its listing (the modality
 * supplements and the image facts answer empty), the custom endpoint answers
 * or fails to resolve, and any other shipped live source is unreachable. */
function network(options: { customResolves: boolean }) {
  mockedFetch.mockImplementation(async (url: string) => {
    const { hostname, pathname, search } = new URL(url);
    if (hostname === 'openrouter.ai') {
      if (pathname === '/api/v1/models' && search === '') {
        return listing(OPENROUTER_LIVE);
      }
      return listing([]);
    }
    if (hostname === CUSTOM_HOST) {
      if (!options.customResolves) {
        throw new SafeFetchError(
          'dns_failed',
          `getaddrinfo ENOTFOUND ${CUSTOM_HOST}`,
        );
      }
      return listing(CUSTOM_LIVE);
    }
    throw new SafeFetchError('network_error', `no route to ${hostname}`);
  });
}

interface CatalogRow {
  name: string;
  models: Array<{ id: string; provider: string }>;
  catalogError?: string;
  catalogErrorCode?: string;
}

function app() {
  const tag = async () => [];
  const sql = Object.assign(tag, {
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  return createProviderSettingRoutes({
    sql: sql as unknown as Sql,
    auth: {} as never,
  });
}

/** The listing, with the fake clock advanced through the retry ladder a
 * failed listing climbs before it gives up. */
async function listCatalogs(): Promise<Map<string, CatalogRow>> {
  const state = { settled: false };
  const pending = Promise.resolve(
    app().request(`/catalogs?orgId=${caller.orgId}`),
  ).finally(() => {
    state.settled = true;
  });
  while (!state.settled) await vi.advanceTimersByTimeAsync(1_000);
  const response = await pending;
  expect(response.status).toBe(200);
  const body = (await response.json()) as { catalogs: CatalogRow[] };
  return new Map(body.catalogs.map((row) => [row.name, row]));
}

const ids = (row: CatalogRow | undefined) =>
  (row?.models ?? []).map((model) => model.id);

let directory: string;

async function defineCustomProvider(): Promise<void> {
  const dir = join(directory, caller.slug, 'providers');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${custom.name}.yml`),
    `${JSON.stringify(custom, null, 2)}\n`,
  );
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'provider-catalog-scope-'));
  vi.stubEnv('TALE_CONFIG_DIR', directory);
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  invalidateCatalogFetchCache();
  mockedFetch.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  invalidateCatalogFetchCache();
  await rm(directory, { recursive: true, force: true });
});

describe('each provider lists its own models in the catalog listing [PROV-R6]', () => {
  it('keeps OpenRouter and a custom OpenAI-compatible provider apart', async () => {
    await defineCustomProvider();
    network({ customResolves: true });

    const rows = await listCatalogs();
    const openrouter = rows.get('openrouter');
    const gateway = rows.get(custom.name);

    expect(ids(openrouter)).toEqual(expect.arrayContaining(OPENROUTER_LIVE));
    expect(ids(openrouter)).not.toEqual(
      expect.arrayContaining([CUSTOM_LIVE[0]]),
    );
    expect(
      ids(openrouter).filter((id) => id.startsWith('gateway-only/')),
    ).toEqual([]);
    expect(openrouter).not.toHaveProperty('catalogError');

    expect(ids(gateway)).toEqual(CUSTOM_LIVE);
    expect(
      gateway?.models.every((model) => model.provider === custom.name),
    ).toBe(true);
    expect(gateway).not.toHaveProperty('catalogError');
  });

  it('confines a custom provider whose listing cannot be resolved to its own row', async () => {
    // OpenRouter's row as the organization sees it before it defines a
    // provider of its own.
    network({ customResolves: false });
    const before = ids((await listCatalogs()).get('openrouter'));
    expect(before).toEqual(expect.arrayContaining(OPENROUTER_LIVE));

    await defineCustomProvider();
    invalidateCatalogFetchCache();
    const rows = await listCatalogs();

    // The failure is the custom provider's: no models, and the reason.
    const gateway = rows.get(custom.name);
    expect(ids(gateway)).toEqual([]);
    expect(gateway?.catalogErrorCode).toBe('PROVIDER_CATALOG_UNREACHABLE');

    // OpenRouter keeps every model it listed, neither narrowed nor blamed.
    const openrouter = rows.get('openrouter');
    expect(ids(openrouter)).toEqual(before);
    expect(openrouter).not.toHaveProperty('catalogError');
    expect(openrouter).not.toHaveProperty('catalogErrorCode');
  });
});
