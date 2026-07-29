// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHarnessTable } from '../../../lib/shared/providers/resolve_execution';
import {
  loadHarnesses,
  loadProviderDefinitions,
  loadStaticCatalogs,
} from './load_system_config';

// The shipped tree is the fixture: these tests walk the real
// configs/platform/system/{providers,models,harnesses} directories (found by
// the loader's repo walk-up from the vitest working directory), so a
// malformed or incoherent shipped file fails the suite — the
// registry-completeness gate for the provider foundation.

describe('shipped providers', () => {
  it('loads the twelve shipped providers', () => {
    const names = loadProviderDefinitions().map((c) => c.name);
    expect(names).toEqual([
      'anthropic',
      'azure',
      'deepseek',
      'gemini',
      'moonshot',
      'nous-portal',
      'openai',
      'openrouter',
      'qwen',
      'vercel-ai-gateway',
      'xai',
      'zai',
    ]);
  });

  it('anthropic ships the subscription-broker method forcing claude-code', () => {
    const anthropic = loadProviderDefinitions().find(
      (c) => c.name === 'anthropic',
    );
    expect(anthropic?.apiFormat).toBe('anthropic');
    const broker = anthropic?.auth.find(
      (a) => a.method === 'subscription-broker',
    );
    expect(broker).toEqual({
      method: 'subscription-broker',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    });
  });

  it('every subscription constraint names a shipped, byo-capable harness', () => {
    const harnesses = buildHarnessTable(loadHarnesses());
    for (const provider of loadProviderDefinitions()) {
      for (const auth of provider.auth) {
        if (
          auth.method !== 'subscription-broker' &&
          auth.method !== 'subscription-key'
        ) {
          continue;
        }
        const forced = harnesses.get(auth.constraints.harness);
        expect(
          forced,
          `${provider.name} forces an unshipped harness`,
        ).toBeDefined();
        // The subscription secret is injected byo-style into the forced
        // harness, so that harness must accept byo credentials.
        expect(forced?.credentialPolicy.byo).toBe(true);
      }
    }
  });

  it('every static-source provider ships a models file, and every models file belongs to a provider', () => {
    const providers = loadProviderDefinitions();
    const catalogProviders = new Set(loadStaticCatalogs().keys());
    for (const provider of providers) {
      if (provider.catalog.source === 'static') {
        expect(
          catalogProviders.has(provider.name),
          `${provider.name} declares a static catalog but ships no models file`,
        ).toBe(true);
      }
    }
    // A models file may also back a LIVE source as its curated default set
    // (openrouter) — but never dangle without a provider.
    const providerNames = new Set(providers.map((c) => c.name));
    for (const provider of catalogProviders) {
      expect(
        providerNames.has(provider),
        `models/${provider}.yml has no provider`,
      ).toBe(true);
    }
  });

  it('returns a stable reference while files are unchanged', () => {
    expect(loadProviderDefinitions()).toBe(loadProviderDefinitions());
    expect(loadHarnesses()).toBe(loadHarnesses());
  });
});

describe('shipped static model catalogs', () => {
  it('every catalog entry validates and carries its file provider', () => {
    const catalogs = loadStaticCatalogs();
    expect(catalogs.size).toBeGreaterThan(0);
    for (const [provider, entries] of catalogs) {
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.provider).toBe(provider);
        expect(entry.contextWindow).toBeGreaterThan(0);
      }
    }
  });

  it('ships the anthropic flagship lineup', () => {
    const anthropic = loadStaticCatalogs().get('anthropic');
    expect(anthropic?.map((m) => m.id)).toEqual([
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    for (const model of anthropic ?? []) {
      expect(model.supportsTools).toBe(true);
      expect(model.supportsVision).toBe(true);
      expect(model.reasoning).toEqual({ knob: 'effort' });
    }
  });
});

describe('shipped harnesses', () => {
  it('loads all nine harnesses', () => {
    const slugs = loadHarnesses().map((h) => h.slug);
    expect(slugs).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'gemini',
      'hermes',
      'openclaw',
      'opencode',
      'pi',
      'qwen-code',
    ]);
  });

  it('carries the credential-policy edges the case split relies on', () => {
    const table = buildHarnessTable(loadHarnesses());
    expect(table.get('cursor')?.credentialPolicy).toEqual({
      managed: false,
      byo: true,
    });
    expect(table.get('opencode')?.credentialPolicy).toEqual({
      managed: true,
      byo: false,
    });
    expect(table.get('claude-code')?.capabilities).toEqual({
      planMode: true,
      steering: true,
      mcp: true,
    });
    expect(table.get('pi')?.capabilities.mcp).toBe(false);
  });

  it('carries the exec facts and parser families the registry composes', () => {
    const table = buildHarnessTable(loadHarnesses());
    for (const harness of table.values()) {
      expect(harness.exec.bin.length).toBeGreaterThan(0);
      expect(harness.exec.argv.length).toBeGreaterThan(0);
    }
    // qwen-code is the gemini-cli fork: it reuses the gemini stream family
    // over its own wrapper binary.
    expect(table.get('qwen-code')?.parser).toBe('gemini-stream');
    expect(table.get('qwen-code')?.exec.bin).toBe('tale-qwen-run');
    expect(table.get('gemini')?.parser).toBe('gemini-stream');
    expect(table.get('claude-code')?.parser).toBe('claude-stream-json');
    // The subscription deliveries the resolution layer plans against.
    expect(table.get('claude-code')?.subscription).toEqual({
      kind: 'env',
      tokenVar: 'ANTHROPIC_AUTH_TOKEN',
      baseUrlVar: 'ANTHROPIC_BASE_URL',
    });
    expect(table.get('hermes')?.subscription).toEqual({
      kind: 'env',
      tokenVar: 'OPENAI_API_KEY',
      baseUrlVar: 'OPENAI_BASE_URL',
    });
    expect(table.get('gemini')?.subscription).toEqual({
      kind: 'staged-file',
      path: '.runtime/home/.gemini/oauth_creds.json',
    });
    expect(table.get('qwen-code')?.subscription).toBeUndefined();
  });
});

describe('registry-completeness posture (fixture tree)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'system-config-'));
    for (const subdir of ['providers', 'models', 'harnesses']) {
      await mkdir(path.join(root, subdir));
    }
    await mkdir(path.join(root, 'providers', 'openai'));
    await writeFile(
      path.join(root, 'providers', 'openai', 'provider.yml'),
      [
        'name: openai',
        'displayName: OpenAI',
        'apiFormat: openai',
        'baseUrl: https://api.openai.com/v1',
        'catalog:',
        '  source: static',
        'auth:',
        '  - method: api-key',
        '',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads a valid fixture tree', () => {
    expect(loadProviderDefinitions({ root }).map((c) => c.name)).toEqual([
      'openai',
    ]);
  });

  it('errors on an unexpected file in a shipped directory', async () => {
    await writeFile(path.join(root, 'providers', 'notes.txt'), 'scratch');
    expect(() => loadProviderDefinitions({ root })).toThrow(/notes\.txt/);
  });

  it('errors on a provider whose name differs from its directory name', async () => {
    await mkdir(path.join(root, 'providers', 'renamed'));
    await writeFile(
      path.join(root, 'providers', 'renamed', 'provider.yml'),
      [
        'name: openai-two',
        'displayName: OpenAI',
        'apiFormat: openai',
        'baseUrl: https://api.openai.com/v1',
        'catalog:',
        '  source: static',
        'auth:',
        '  - method: api-key',
        '',
      ].join('\n'),
    );
    expect(() => loadProviderDefinitions({ root })).toThrow(
      /must match its directory name "renamed"/,
    );
  });

  it('errors on a catalog entry declaring a foreign provider', async () => {
    await mkdir(path.join(root, 'models', 'openai'));
    await writeFile(
      path.join(root, 'models', 'openai', 'models.yml'),
      [
        '- id: claude-fable-5',
        '  provider: anthropic',
        '  tags: [chat]',
        '  supportsTools: true',
        '  supportsVision: true',
        '  contextWindow: 200000',
        '',
      ].join('\n'),
    );
    expect(() => loadStaticCatalogs({ root })).toThrow(
      /declares provider "anthropic"/,
    );
  });

  it('errors on a schema violation with the file path in the message', async () => {
    await mkdir(path.join(root, 'harnesses', 'cursor'));
    await writeFile(
      path.join(root, 'harnesses', 'cursor', 'harness.yml'),
      [
        'slug: cursor',
        'displayName: Cursor',
        'credentialPolicy:',
        '  managed: false',
        '  byo: false',
        'credentialEnvKeys:',
        '  - CURSOR_API_KEY',
        'modelIdDialect: vendor-native',
        'promptTransport: argv',
        'capabilities:',
        '  planMode: false',
        '  steering: false',
        '  mcp: true',
        '',
      ].join('\n'),
    );
    expect(() => loadHarnesses({ root })).toThrow(/harness\.yml/);
  });

  it('errors on an entry directory missing its canonical file', async () => {
    await mkdir(path.join(root, 'providers', 'empty-entry'));
    expect(() => loadProviderDefinitions({ root })).toThrow(
      /missing its provider\.yml/,
    );
  });

  it('leaves entry assets like icon.svg alone', async () => {
    await writeFile(
      path.join(root, 'providers', 'openai', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    expect(loadProviderDefinitions({ root }).map((c) => c.name)).toEqual([
      'openai',
    ]);
  });

  it('errors when a shipped directory is missing entirely', async () => {
    await rm(path.join(root, 'harnesses'), { recursive: true });
    expect(() => loadHarnesses({ root })).toThrow(
      /missing shipped config directory/,
    );
  });
});
