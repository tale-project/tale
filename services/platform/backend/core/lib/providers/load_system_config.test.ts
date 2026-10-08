// @vitest-environment node

import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isKnowledgeVectorWidth } from '@tale/shared/schemas/knowledge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSystemConfigRoot } from '../../../../lib/shared/config/system-root';
import { buildHarnessTable } from '../../../../lib/shared/providers/resolve_execution';
import { HNSW_DIMENSION_LIMIT } from '../../knowledge/dimensions';
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

  it('anthropic ships a pasted OAuth token method forcing claude-code', () => {
    const anthropic = loadProviderDefinitions().find(
      (c) => c.name === 'anthropic',
    );
    const key = anthropic?.auth.find((a) => a.method === 'subscription-key');
    expect(key).toEqual({
      method: 'subscription-key',
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    });
  });

  it('every subscription-key targetEnvVar is a variable its forced harness accepts', () => {
    const harnesses = loadHarnesses();
    for (const provider of loadProviderDefinitions()) {
      for (const auth of provider.auth) {
        if (
          auth.method !== 'subscription-key' ||
          auth.targetEnvVar === undefined
        ) {
          continue;
        }
        const delivery = harnesses.find(
          (h) => h.slug === auth.constraints.harness,
        )?.subscription;
        expect(
          delivery?.kind,
          `${provider.name} names ${auth.targetEnvVar} on a harness with no env delivery`,
        ).toBe('env');
        if (delivery?.kind !== 'env') continue;
        expect(
          [delivery.tokenVar, ...(delivery.tokenVarOverrides ?? [])],
          `${provider.name} names ${auth.targetEnvVar}, which ${auth.constraints.harness} does not accept`,
        ).toContain(auth.targetEnvVar);
      }
    }
  });

  it('declares a native Anthropic harness endpoint only where the vendor serves one', () => {
    // Claude Code rides these instead of the gateway's Anthropic→OpenAI
    // down-conversion. Vendors that also serve one but are NOT listed here
    // do so on purpose — see the comment in each provider.yml (zai drops
    // images on that door, qwen's host is workspace-specific; xAI's door is
    // deprecated, Gemini has none).
    const lanes = loadProviderDefinitions()
      .filter((c) => c.harnessEndpoint !== undefined)
      .map((c) => [c.name, c.harnessEndpoint?.baseUrl]);
    expect(lanes).toEqual([
      ['deepseek', 'https://api.deepseek.com/anthropic'],
      ['moonshot', 'https://api.moonshot.ai/anthropic'],
      ['openrouter', 'https://openrouter.ai/api'],
      ['vercel-ai-gateway', 'https://ai-gateway.vercel.sh'],
    ]);
    for (const provider of loadProviderDefinitions()) {
      if (provider.harnessEndpoint !== undefined) {
        expect(provider.harnessEndpoint.apiFormat).toBe('anthropic');
      }
    }
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
  it('ships Sol 6.1 for Responses tool calls without an unsupported reasoning off value', () => {
    const model = loadStaticCatalogs()
      .get('openai')
      ?.find((entry) => entry.id === 'gpt-6.1-sol');
    expect(model).toMatchObject({
      id: 'gpt-6.1-sol',
      provider: 'openai',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: true,
      toolCallingApi: 'responses',
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      reasoning: { knob: 'effort' },
      pricing: {
        inputCentsPerMillion: 200,
        outputCentsPerMillion: 1000,
        cacheReadCentsPerMillion: 10,
        cacheWriteCentsPerMillion: 250,
      },
    });
    expect(model?.reasoning?.off).toBeUndefined();
    expect(model?.reasoning?.toolsRequireOff).toBeUndefined();
  });

  // The vendor's latest-model guide: Astra, like Sol 6.1, takes tools only
  // on Responses and cannot switch reasoning off; Sol and Luna take tools on
  // Chat Completions only with reasoning_effort none.
  it('ships the GPT-6 family with the tool API and reasoning switch the vendor documents', () => {
    const openai = loadStaticCatalogs().get('openai') ?? [];
    const byId = new Map(openai.map((entry) => [entry.id, entry] as const));
    const family = {
      tags: ['chat'],
      supportsTools: true,
      supportsVision: true,
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
    };
    expect(byId.get('gpt-6-astra')).toEqual({
      id: 'gpt-6-astra',
      provider: 'openai',
      ...family,
      toolCallingApi: 'responses',
      reasoning: { knob: 'effort' },
      pricing: {
        inputCentsPerMillion: 1000,
        outputCentsPerMillion: 5000,
        cacheReadCentsPerMillion: 100,
        cacheWriteCentsPerMillion: 1250,
      },
    });
    expect(byId.get('gpt-6-sol')).toEqual({
      id: 'gpt-6-sol',
      provider: 'openai',
      ...family,
      reasoning: { knob: 'effort', off: 'none', toolsRequireOff: true },
      pricing: {
        inputCentsPerMillion: 200,
        outputCentsPerMillion: 1000,
        cacheReadCentsPerMillion: 20,
        cacheWriteCentsPerMillion: 250,
      },
    });
    expect(byId.get('gpt-6-luna')).toEqual({
      id: 'gpt-6-luna',
      provider: 'openai',
      ...family,
      reasoning: { knob: 'effort', off: 'none', toolsRequireOff: true },
      pricing: {
        inputCentsPerMillion: 10,
        outputCentsPerMillion: 50,
        cacheReadCentsPerMillion: 1,
        cacheWriteCentsPerMillion: 12.5,
      },
    });
  });

  // The Responses API is an OpenAI surface: direct chat calls a model that
  // declares it at `<baseUrl>/responses`, which an Anthropic-format
  // connector does not have — the chat walk would hide such an entry.
  it('declares the Responses tool API only on an OpenAI-format connector', () => {
    const formatBySlug = new Map(
      loadProviderDefinitions().map((p) => [p.name, p.apiFormat] as const),
    );
    const misplaced: string[] = [];
    for (const [provider, entries] of loadStaticCatalogs()) {
      for (const entry of entries) {
        if (
          entry.toolCallingApi === 'responses' &&
          formatBySlug.get(provider) !== 'openai'
        ) {
          misplaced.push(`${provider}/${entry.id}`);
        }
      }
    }
    expect(misplaced).toEqual([]);
  });

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

  it('prices a prompt-cache hit at or below the input rate wherever it prices one', () => {
    // A hit that costs more than a miss is a typo, and it would bill every
    // cached token of every turn above the vendor's own invoice.
    const catalogs = loadStaticCatalogs();
    let priced = 0;
    for (const [provider, entries] of catalogs) {
      for (const entry of entries) {
        const pricing = entry.pricing;
        if (pricing?.cacheReadCentsPerMillion === undefined) continue;
        priced++;
        expect(
          { provider, id: entry.id, hit: pricing.cacheReadCentsPerMillion },
          `${provider}/${entry.id} prices a cache hit above its input rate`,
        ).toEqual({
          provider,
          id: entry.id,
          hit: expect.any(Number),
        });
        expect(pricing.cacheReadCentsPerMillion).toBeLessThanOrEqual(
          pricing.inputCentsPerMillion,
        );
      }
    }
    // Every vendor connector with a static catalog discounts cache hits —
    // a catalog that lost them would silently overbill again.
    expect(priced).toBeGreaterThan(30);
  });

  it('prices the deepseek cache hit at the vendor peak rate ($0.006/M flash, $0.044/M pro)', () => {
    const deepseek = loadStaticCatalogs().get('deepseek');
    expect(
      deepseek?.map((m) => [m.id, m.pricing?.cacheReadCentsPerMillion]),
    ).toEqual([
      ['deepseek-flash', 0.6],
      ['deepseek-v4-pro', 4.4],
    ]);
  });

  it('ships the current deepseek lineup, not the retired aliases', () => {
    const deepseek = loadStaticCatalogs().get('deepseek');
    expect(deepseek?.map((m) => m.id)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
    for (const model of deepseek ?? []) {
      expect(model.supportsTools).toBe(true);
      expect(model.reasoning).toEqual({ knob: 'effort', off: 'none' });
    }
    // V4.1 Flash reads images natively; Pro is text-only.
    expect(deepseek?.map((m) => m.supportsVision)).toEqual([true, false]);
  });

  it('ships the anthropic flagship lineup', () => {
    const anthropic = loadStaticCatalogs().get('anthropic');
    expect(anthropic?.map((m) => m.id)).toEqual([
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-opus-5-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    for (const model of anthropic ?? []) {
      expect(model.supportsTools).toBe(true);
      expect(model.supportsVision).toBe(true);
      // Haiku 4.5 has no effort parameter (see the docs-list guard below)
      // and stays knob-less until the chat lane can replay thinking blocks.
      expect(model.reasoning).toEqual(
        model.id === 'claude-haiku-4-5' ? undefined : { knob: 'effort' },
      );
    }
  });

  // Opus 5.5 and Fable 5.1 serve 1M by default (no opt-in exists), bill
  // cache hits below the usual 0.1x of input (0.05x and 0.025x), and cannot
  // turn thinking off — so they must never declare an off literal: the
  // Default step then leaves the parameter off the wire instead of sending a
  // value the endpoint refuses. Prices read from the vendor's pricing page
  // on 2026-09-27.
  it('ships Opus 5.5 and Fable 5.1 with their 1M window, prices and no off switch', () => {
    const anthropic = loadStaticCatalogs().get('anthropic') ?? [];
    const facts = ['claude-opus-5-5', 'claude-fable-5-1'].map((id) => {
      const entry = anthropic.find((m) => m.id === id);
      return {
        id,
        contextWindow: entry?.contextWindow,
        maxOutputTokens: entry?.maxOutputTokens,
        reasoning: entry?.reasoning,
        pricing: entry?.pricing,
      };
    });
    expect(facts).toEqual([
      {
        id: 'claude-opus-5-5',
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        reasoning: { knob: 'effort' },
        pricing: {
          inputCentsPerMillion: 400,
          outputCentsPerMillion: 2000,
          cacheReadCentsPerMillion: 20,
          cacheWriteCentsPerMillion: 500,
        },
      },
      {
        id: 'claude-fable-5-1',
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        reasoning: { knob: 'effort' },
        pricing: {
          inputCentsPerMillion: 1000,
          outputCentsPerMillion: 5000,
          cacheReadCentsPerMillion: 25,
          cacheWriteCentsPerMillion: 1250,
        },
      },
    ]);
  });

  // `output_config.effort` exists on a documented set of models
  // (platform.claude.com/docs/en/build-with-claude/effort, read 2026-09-11,
  // Opus 5.5 added 2026-09-27): the 5-series, Opus 4.5+ and Sonnet 4.6+.
  // The wire sends it for every `effort`-knob entry on this connector, and
  // a model outside the set refuses the whole request — Haiku 4.5, which
  // reasons only through a manual thinking budget, was the shipped case.
  // Extend the list from the docs when a new model ships, never from the
  // model's name.
  it('the anthropic catalog declares the effort knob only where the vendor documents it', () => {
    const EFFORT_MODELS = new Set([
      'claude-fable-5-1',
      'claude-mythos-5-1',
      'claude-fable-5',
      'claude-mythos-5',
      'claude-mythos-preview',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
    ]);
    const undocumented: string[] = [];
    for (const entry of loadStaticCatalogs().get('anthropic') ?? []) {
      if (entry.reasoning?.knob === 'effort' && !EFFORT_MODELS.has(entry.id)) {
        undocumented.push(entry.id);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it('zai curates embedding-3 as its knowledge-embedding pick', () => {
    const zai = loadStaticCatalogs().get('zai');
    const embedding = zai?.find((m) => m.id === 'embedding-3');
    expect(embedding?.tags).toEqual(['embedding']);
    expect(embedding?.supportsTools).toBe(false);
    expect(embedding?.supportsVision).toBe(false);
    // The vendor's 2048 default is above pgvector's HNSW ceiling; 1536 is the
    // width the other curated picks share, so one bundled corpus serves all.
    expect(embedding?.embedding).toEqual({
      dimensions: 1536,
      recommended: true,
    });
    // The GLM chat lineup stays chat-only and the embedding tag never leaks
    // into a chat picker: each entry is one or the other.
    for (const model of zai ?? []) {
      expect(model.tags.includes('chat')).toBe(
        !model.tags.includes('embedding'),
      );
    }
  });

  it('every curated embedding pick is embedding-tagged and HNSW-indexable', () => {
    const curated: string[] = [];
    for (const [provider, entries] of loadStaticCatalogs()) {
      for (const entry of entries) {
        if (entry.embedding === undefined) continue;
        curated.push(`${provider}/${entry.id}`);
        expect(entry.tags).toContain('embedding');
        // A recommended width above the limit would hand the one-click setup
        // a corpus that can only scan sequentially.
        expect(entry.embedding.dimensions).toBeLessThanOrEqual(
          HNSW_DIMENSION_LIMIT,
        );
        // And a width the knowledge database has no table for would hand it
        // a pick the settings refuse to save.
        expect(
          isKnowledgeVectorWidth(entry.embedding.dimensions),
          `${provider}/${entry.id}`,
        ).toBe(true);
      }
    }
    expect(curated).toEqual([
      'openai/text-embedding-3-small',
      'openrouter/qwen/qwen3-embedding-8b',
      'zai/embedding-3',
    ]);
  });

  // The embedding form acts on each provider's `embedding` declaration:
  // `unsupported` refuses the provider at the point of choosing, anything
  // else lets the admin enter a model and its width. `supported` is what a
  // curated width in the shipped catalog establishes, so the two must agree.
  // `unsupported` is a claim about the vendor's API that this repo cannot
  // derive, so it carries the vendor's own docs in the comment above it — a
  // refusal nobody can trace back to evidence is the guess the declaration
  // exists to replace.
  it('declares embedding support only as the catalogs and vendor docs establish', () => {
    const curated = new Set<string>();
    for (const [provider, entries] of loadStaticCatalogs()) {
      if (entries.some((entry) => entry.embedding !== undefined)) {
        curated.add(provider);
      }
    }
    const root = resolveSystemConfigRoot();
    if (root === null) throw new Error('no shipped config tree');
    const declared: Record<string, string | undefined> = {};
    const uncited: string[] = [];
    for (const provider of loadProviderDefinitions()) {
      declared[provider.name] = provider.embedding;
      if (provider.embedding !== 'unsupported') continue;
      const lines = readFileSync(
        path.join(root, 'providers', provider.name, 'provider.yml'),
        'utf8',
      ).split('\n');
      const at = lines.findIndex((line) =>
        /^embedding:\s*unsupported\b/.test(line),
      );
      const comment: string[] = [];
      for (let i = at - 1; i >= 0 && lines[i]?.startsWith('#'); i -= 1) {
        comment.push(lines[i] ?? '');
      }
      if (!comment.some((line) => line.includes('https://'))) {
        uncited.push(provider.name);
      }
    }

    expect(uncited).toEqual([]);
    expect(
      Object.keys(declared).filter((name) => declared[name] === 'supported'),
    ).toEqual([...curated].sort());
    // Anthropic's docs: "Anthropic does not offer its own embedding model."
    expect(declared.anthropic).toBe('unsupported');
  });

  // A declared knob names a WIRE PARAMETER, so it is only meaningful on a
  // connector whose dialect can spell it: `budget-tokens` is
  // `thinking.budget_tokens`, which exists on the Anthropic messages wire
  // alone. An OpenAI-format connector declaring it drops the user's effort
  // pick from the body with nothing to show for it — which is exactly what
  // every Claude entry in the openrouter catalog did until this guard
  // existed. `effort` is spellable on both (`reasoning_effort` /
  // `output_config.effort`), so it never pairs wrong.
  it('every catalog entry declares a knob its connector can spell', () => {
    const formatBySlug = new Map(
      loadProviderDefinitions().map((p) => [p.name, p.apiFormat] as const),
    );
    const unspellable: string[] = [];
    for (const [provider, entries] of loadStaticCatalogs()) {
      for (const entry of entries) {
        if (entry.reasoning?.knob !== 'budget-tokens') continue;
        if (formatBySlug.get(provider) !== 'anthropic') {
          unspellable.push(`${provider}/${entry.id}`);
        }
      }
    }
    expect(unspellable).toEqual([]);
  });
});

describe('shipped harnesses', () => {
  it('loads all nine base harnesses and the explicit compact variant', () => {
    const slugs = loadHarnesses().map((h) => h.slug);
    expect(slugs).toEqual([
      'claude-code',
      'claude-code-compact',
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
      resume: true,
    });
    expect(table.get('pi')?.capabilities.mcp).toBe(false);
    // The one harness the platform never resumes (its `--resume` replays
    // every tool result twice); every other shipped harness continues.
    for (const harness of table.values()) {
      expect(harness.capabilities.resume).toBe(harness.slug !== 'gemini');
    }
  });

  it('carries the exec facts and parser families the registry composes', () => {
    const table = buildHarnessTable(loadHarnesses());
    for (const harness of table.values()) {
      expect(harness.exec.bin.length).toBeGreaterThan(0);
      expect(harness.exec.argv.length).toBeGreaterThan(0);
    }
    // qwen-code is a gemini-cli fork, but its headless stream is the
    // Claude-style stream-json dialect — it shares claude-code's family over
    // its own wrapper binary.
    expect(table.get('qwen-code')?.parser).toBe('claude-stream-json');
    expect(table.get('qwen-code')?.exec.bin).toBe('tale-qwen-run');
    expect(table.get('gemini')?.parser).toBe('gemini-stream');
    expect(table.get('claude-code')?.parser).toBe('claude-stream-json');
    // The subscription deliveries the resolution layer plans against.
    expect(table.get('claude-code')?.subscription).toEqual({
      kind: 'env',
      tokenVar: 'ANTHROPIC_AUTH_TOKEN',
      baseUrlVar: 'ANTHROPIC_BASE_URL',
      tokenVarOverrides: ['CLAUDE_CODE_OAUTH_TOKEN'],
      clearEnv: [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ],
    });
    expect(table.get('codex')?.subscription).toEqual({
      kind: 'env',
      tokenVar: 'TALE_SUBSCRIPTION_TOKEN',
      accountIdVar: 'TALE_SUBSCRIPTION_ACCOUNT_ID',
      clearEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'],
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

describe('harness variant loading', () => {
  let root: string;
  const base = loadHarnesses().find((h) => h.slug === 'codex')!;
  const variant = {
    slug: 'synthetic-compact',
    displayName: 'Synthetic compact',
    env: { base: { SYNTHETIC_FLAG: '1' } },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'harness-variants-'));
    await mkdir(path.join(root, 'harnesses'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeHarness(slug: string, variants: unknown) {
    const folder = path.join(root, 'harnesses', slug);
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'harness.yml'),
      JSON.stringify({
        ...base,
        slug,
        exec: {
          ...base.exec,
          env: {
            ...base.exec.env,
            base: {
              ...base.exec.env?.base,
              KEEP_ME: 'original',
              SYNTHETIC_FLAG: 'base',
            },
          },
        },
        variants,
      }),
    );
  }

  it('inherits one complete base and shallowly overrides only env.base', async () => {
    await writeHarness('synthetic-base', [variant]);
    const facts = loadHarnesses({ root });
    expect(facts.map((fact) => fact.slug)).toEqual([
      'synthetic-base',
      'synthetic-compact',
    ]);
    const [original, derived] = facts;
    expect(original).not.toHaveProperty('variants');
    expect(derived).not.toHaveProperty('variants');
    expect(derived).toEqual({
      ...original,
      slug: variant.slug,
      displayName: variant.displayName,
      exec: {
        ...original!.exec,
        env: {
          ...original!.exec.env,
          base: { ...original!.exec.env?.base, SYNTHETIC_FLAG: '1' },
        },
      },
    });
    expect(original!.exec.env?.base?.SYNTHETIC_FLAG).toBe('base');
    expect(derived!.exec.env?.base?.KEEP_ME).toBe('original');
    expect(derived!.exec.env?.managed).toEqual(original!.exec.env?.managed);
  });

  it('keeps stable references and invalidates both facts after a base-file change', async () => {
    await writeHarness('synthetic-base', [variant]);
    const before = loadHarnesses({ root });
    expect(loadHarnesses({ root })).toBe(before);
    await writeHarness('synthetic-base', [
      { ...variant, env: { base: { SYNTHETIC_FLAG: 'changed-value' } } },
    ]);
    const after = loadHarnesses({ root });
    expect(after).not.toBe(before);
    expect(after[1]!.exec.env?.base?.SYNTHETIC_FLAG).toBe('changed-value');
    expect(before[1]!.exec.env?.base?.SYNTHETIC_FLAG).toBe('1');
  });

  it('rejects a variant shadowing another base regardless of file order', async () => {
    await writeHarness('alpha-base', [{ ...variant, slug: 'omega-base' }]);
    await writeHarness('omega-base', undefined);
    expect(() => loadHarnesses({ root })).toThrow(
      /duplicate harness slug.*omega-base/i,
    );
    await writeHarness('alpha-base', undefined);
    await writeHarness('omega-base', [{ ...variant, slug: 'alpha-base' }]);
    expect(() => loadHarnesses({ root })).toThrow(
      /duplicate harness slug.*alpha-base/i,
    );
  });

  it('rejects duplicate variant slugs across base files before returning a catalog', async () => {
    await writeHarness('alpha-base', [variant]);
    await writeHarness('omega-base', [variant]);
    expect(() => loadHarnesses({ root })).toThrow(
      /duplicate harness slug.*synthetic-compact/i,
    );
  });

  it('rejects an unknown base or arbitrary override with the source path', async () => {
    await writeHarness('synthetic-base', [{ ...variant, base: 'missing' }]);
    expect(() => loadHarnesses({ root })).toThrow(
      /synthetic-base.*harness\.yml/,
    );
    await writeHarness('synthetic-base', [
      { ...variant, command: 'other-binary' },
    ]);
    expect(() => loadHarnesses({ root })).toThrow(
      /synthetic-base.*harness\.yml/,
    );
  });
});
