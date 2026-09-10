// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { getServableCatalog } from '../lib/providers/servable_catalog';
import { resolveModel } from './turn_action';

/**
 * Two connectors serve the same model id. The composer names one as a HINT:
 * an unmatched hint falls back to whichever connector serves the id. The
 * REST door names one as a CHOICE the caller was promised: if that pair
 * stops resolving between the 202 and the run — the connector removed or
 * renamed, the model gone from its catalog — the turn refuses instead of
 * sending the conversation to a provider the caller never named.
 */

vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: vi.fn(),
}));
vi.mock('../lib/providers/servable_catalog', () => ({
  getServableCatalog: vi.fn(),
}));

const connector = (name: string, models: string[]) => ({
  name,
  catalog: { source: 'file', models },
  baseUrl: `https://${name}.example/v1`,
});

function connectors(...defs: Array<{ name: string; models: string[] }>) {
  vi.mocked(resolveProvidersForOrgId).mockResolvedValue(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver reads name, catalog.source and baseUrl
    defs.map((def) => connector(def.name, def.models)) as never,
  );
  vi.mocked(getServableCatalog).mockImplementation(
    async (c) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake connector carries its model ids
      (c as unknown as { catalog: { models: string[] } }).catalog.models.map(
        (id) => ({ id, provider: c.name }),
      ) as never,
  );
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no ctx facility is reached with file-backed catalogs
const ctx = { runQuery: vi.fn() } as never;

describe('resolveModel', () => {
  it('as a hint, falls back to the other connector serving the id', async () => {
    connectors(
      { name: 'other', models: ['m'] },
      { name: 'chosen', models: [] },
    );
    const resolved = await resolveModel(ctx, 'org-1', 'm', 'chosen');
    expect(resolved.connector.name).toBe('other');
  });

  it('as a choice, refuses when the chosen connector no longer serves the id', async () => {
    connectors(
      { name: 'other', models: ['m'] },
      { name: 'chosen', models: [] },
    );
    await expect(
      resolveModel(ctx, 'org-1', 'm', 'chosen', true),
    ).rejects.toMatchObject({
      data: { code: 'CHAT_PROVIDER_UNAVAILABLE' },
    });
  });

  it('as a choice, refuses when the chosen connector is gone', async () => {
    connectors({ name: 'other', models: ['m'] });
    await expect(
      resolveModel(ctx, 'org-1', 'm', 'chosen', true),
    ).rejects.toMatchObject({
      data: { code: 'CHAT_PROVIDER_UNAVAILABLE' },
    });
  });

  it('as a choice, resolves the chosen connector when it serves the id', async () => {
    connectors(
      { name: 'other', models: ['m'] },
      { name: 'chosen', models: ['m'] },
    );
    const resolved = await resolveModel(ctx, 'org-1', 'm', 'chosen', true);
    expect(resolved.connector.name).toBe('chosen');
  });

  it('without a provider, keeps refusing an unknown model as CHAT_MODEL_UNKNOWN', async () => {
    connectors({ name: 'other', models: [] });
    await expect(resolveModel(ctx, 'org-1', 'm')).rejects.toMatchObject({
      data: { code: 'CHAT_MODEL_UNKNOWN' },
    });
  });
});
