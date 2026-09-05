/**
 * The connector × credential × catalog walk behind the composer's picker
 * and the Auto pick applies the credential's model allowlist through the
 * SAME predicate the voice resolvers and the turn-time serving checks use
 * (`modelAllowlistPermits`) — an allowlist written in one provider id
 * dialect admits the catalog's spelling of the same model, so what the
 * picker offers and what a turn resolves can never disagree on it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { providerDefinitionSchema } from '../../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../ctx';

const resolveProvidersMock = vi.fn();
vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: (...args: unknown[]) =>
    resolveProvidersMock(...(args as [])),
}));

const catalogMock = vi.fn();
vi.mock('./servable_catalog', () => ({
  getServableCatalog: (...args: unknown[]) => catalogMock(...(args as [])),
}));

import { walkChatCatalog, type ChatCatalogCredential } from './chat_catalog';

const ORG = 'org_a';
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the walk reads nothing off ctx itself
const ctx = {} as ActionCtx;

const OPENAI = providerDefinitionSchema.parse({
  name: 'openai',
  displayName: 'OpenAI',
  apiFormat: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  catalog: { source: 'static' },
  auth: [{ method: 'api-key' }],
});

function entry(id: string, tags: string[] = ['chat']) {
  return { id, tags, provider: 'openai', contextWindow: 128_000 };
}

function credential(modelAllowlist?: readonly string[]): ChatCatalogCredential {
  return { providerSlug: 'openai', authMethod: 'api-key', modelAllowlist };
}

beforeEach(() => {
  resolveProvidersMock.mockReset();
  catalogMock.mockReset();
  resolveProvidersMock.mockResolvedValue([OPENAI]);
});

describe('walkChatCatalog — model allowlist', () => {
  it('offers every catalog entry when the credential has no allowlist', async () => {
    catalogMock.mockResolvedValue([entry('gpt-5'), entry('gpt-4o-mini')]);

    const hits = await walkChatCatalog(ctx, ORG, [credential()]);

    expect(hits.map((hit) => hit.entry.id)).toEqual(['gpt-5', 'gpt-4o-mini']);
    expect(catalogMock).toHaveBeenCalledWith(OPENAI, undefined);
  });

  it('admits an allowlisted model across provider id dialects, as the voice resolvers do', async () => {
    catalogMock.mockResolvedValue([
      entry('gpt-5'),
      entry('gpt-4o-mini-tts', ['text-to-speech']),
      entry('gpt-4o-mini'),
    ]);

    const hits = await walkChatCatalog(ctx, ORG, [
      credential(['openai/gpt-4o-mini-tts']),
    ]);

    // The allowlist names the qualified id; the catalog lists the bare one —
    // the same model, so the composer's voice flag must see it exactly as
    // `resolveTtsModel` does.
    expect(hits.map((hit) => hit.entry.id)).toEqual(['gpt-4o-mini-tts']);
  });

  it('refuses every entry outside a non-empty allowlist', async () => {
    catalogMock.mockResolvedValue([entry('gpt-5'), entry('gpt-4o-mini')]);

    const hits = await walkChatCatalog(ctx, ORG, [credential(['gpt-5'])]);

    expect(hits.map((hit) => hit.entry.id)).toEqual(['gpt-5']);
  });

  it('skips a credential for a method the connector no longer declares', async () => {
    catalogMock.mockResolvedValue([entry('gpt-5')]);

    const hits = await walkChatCatalog(ctx, ORG, [
      { providerSlug: 'openai', authMethod: 'env' },
    ]);

    expect(hits).toEqual([]);
    expect(catalogMock).not.toHaveBeenCalled();
  });

  it('warn-skips a connector whose catalog is unreachable and offers the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = providerDefinitionSchema.parse({
      ...OPENAI,
      name: 'other',
      displayName: 'Other',
    });
    resolveProvidersMock.mockResolvedValue([OPENAI, other]);
    catalogMock.mockImplementation(async (provider: { name: string }) => {
      if (provider.name === 'openai') throw new Error('connect refused');
      return [entry('served')];
    });

    const hits = await walkChatCatalog(ctx, ORG, [
      credential(),
      { providerSlug: 'other', authMethod: 'api-key' },
    ]);

    expect(hits.map((hit) => `${hit.connector.name} ${hit.entry.id}`)).toEqual([
      'other served',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not resolve catalog for "openai"'),
      'connect refused',
    );
    warn.mockRestore();
  });
});
