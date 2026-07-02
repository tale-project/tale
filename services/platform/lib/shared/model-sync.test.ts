import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  deriveNativeModelId,
  isFlagshipChatModel,
  type ModelFacts,
  parseModelId,
  syncProviderModels,
} from './model-sync';
import type { ModelDefinition } from './schemas/providers';

const chat = (
  id: string,
  extra: Partial<ModelDefinition> = {},
): ModelDefinition => ({
  id,
  displayName: id,
  tags: ['chat'],
  ...extra,
});

const fact = (id: string, extra: Partial<ModelFacts> = {}): ModelFacts => ({
  modelId: id,
  isChat: true,
  ...extra,
});

describe('parseModelId / compareVersions', () => {
  it('splits family + version and compares', () => {
    const a = parseModelId('anthropic/claude-opus-4.6');
    const b = parseModelId('anthropic/claude-opus-4.7');
    expect(a.vendor).toBe('anthropic');
    expect(a.familyKey).toBe('claude-opus');
    expect(a.familyKey).toBe(b.familyKey);
    expect(compareVersions(a.version, b.version)).toBe(-1);
    expect(compareVersions(b.version, a.version)).toBe(1);
    expect(compareVersions(a.version, a.version)).toBe(0);
  });
});

describe('isFlagshipChatModel', () => {
  it('accepts frontier chat models, rejects non-frontier / non-chat / noise', () => {
    expect(isFlagshipChatModel(fact('anthropic/claude-opus-4.7'))).toBe(true);
    // Newly-curated frontier vendors are eligible too.
    expect(isFlagshipChatModel(fact('amazon/nova-pro-v1'))).toBe(true);
    expect(isFlagshipChatModel(fact('x-ai/grok-4.20'))).toBe(true);
    // Non-frontier vendor (still outside FRONTIER_VENDORS).
    expect(isFlagshipChatModel(fact('nousresearch/hermes-4'))).toBe(false);
    // Not a text model.
    expect(
      isFlagshipChatModel(fact('openai/gpt-image-1', { isChat: false })),
    ).toBe(false);
    // Unknown modality → not auto-added.
    expect(isFlagshipChatModel({ modelId: 'openai/mystery' })).toBe(false);
    // Embedding / dated-snapshot noise.
    expect(isFlagshipChatModel(fact('qwen/qwen3-embedding-8b'))).toBe(false);
    expect(isFlagshipChatModel(fact('mistralai/mistral-large-2512'))).toBe(
      false,
    );
  });
});

describe('syncProviderModels — update (3-way)', () => {
  it('refreshes default-valued fields but preserves operator edits', () => {
    const base = [chat('anthropic/claude-opus-4.6', { contextWindow: 200000 })];
    // Operator bumped the context window away from the shipped default.
    const current = [
      chat('anthropic/claude-opus-4.6', { contextWindow: 250000 }),
    ];
    const facts = [
      fact('anthropic/claude-opus-4.6', {
        contextWindow: 400000,
        maxOutputTokens: 64000,
      }),
    ];
    const { models, changes } = syncProviderModels({ current, base, facts });
    // Operator-edited contextWindow kept; previously-unset maxOutputTokens filled.
    expect(models[0].contextWindow).toBe(250000);
    expect(models[0].maxOutputTokens).toBe(64000);
    expect(changes).toContainEqual({
      kind: 'updated',
      modelId: 'anthropic/claude-opus-4.6',
      fields: ['maxOutputTokens'],
    });
  });

  it('in repo-defaults mode (base = current) refreshes freely', () => {
    const current = [
      chat('openai/gpt-5.2', { contextWindow: 400000, qualityScore: 0.95 }),
    ];
    const facts = [fact('openai/gpt-5.2', { contextWindow: 410000 })];
    const { models } = syncProviderModels({ current, facts });
    expect(models[0].contextWindow).toBe(410000);
    // Non-catalog fields like qualityScore are never touched.
    expect(models[0].qualityScore).toBe(0.95);
  });
});

describe('syncProviderModels — cost (3-way, per sub-field)', () => {
  it('keeps an operator-edited price but fills the unset one', () => {
    const base = [
      chat('openai/gpt-5.2', {
        cost: { inputCentsPerMillion: 175, outputCentsPerMillion: 1400 },
      }),
    ];
    const current = [
      // Operator bumped input; left output at the shipped default.
      chat('openai/gpt-5.2', {
        cost: { inputCentsPerMillion: 200, outputCentsPerMillion: 1400 },
      }),
    ];
    const facts = [
      fact('openai/gpt-5.2', {
        inputCentsPerMillion: 150,
        outputCentsPerMillion: 1300,
      }),
    ];
    const { models } = syncProviderModels({ current, base, facts });
    expect(models[0].cost?.inputCentsPerMillion).toBe(200); // operator kept
    expect(models[0].cost?.outputCentsPerMillion).toBe(1300); // default refreshed
  });
});

describe('deriveNativeModelId', () => {
  it('derives the Anthropic-native id (vendor prefix off, dots to dashes)', () => {
    expect(deriveNativeModelId('anthropic/claude-opus-4.8')).toBe(
      'claude-opus-4-8',
    );
    expect(deriveNativeModelId('anthropic/claude-fable-5')).toBe(
      'claude-fable-5',
    );
  });

  it('leaves other vendors and rolling aliases to human curation', () => {
    expect(deriveNativeModelId('openai/gpt-5.5')).toBeUndefined();
    expect(
      deriveNativeModelId('~anthropic/claude-fable-latest'),
    ).toBeUndefined();
  });
});

describe('syncProviderModels — add + hide', () => {
  it('adds a new flagship and hides the superseded older version', () => {
    const current = [chat('anthropic/claude-opus-4.6')];
    const facts = [
      fact('anthropic/claude-opus-4.7', {
        displayName: 'Claude Opus 4.7',
        contextWindow: 200000,
        supportsVision: true,
      }),
    ];
    const { models, changes } = syncProviderModels({ current, facts });
    const added = models.find((m) => m.id === 'anthropic/claude-opus-4.7');
    const old = models.find((m) => m.id === 'anthropic/claude-opus-4.6');
    expect(added?.tags).toEqual(['chat', 'vision']);
    // Auto-added Anthropic models carry the vendor-native id, so BYO
    // (direct-to-Anthropic) sessions can use them without a code change.
    expect(added?.nativeModelId).toBe('claude-opus-4-7');
    expect(old?.hidden).toBe(true);
    expect(changes).toContainEqual({
      kind: 'added',
      modelId: 'anthropic/claude-opus-4.7',
    });
    expect(changes).toContainEqual({
      kind: 'hidden',
      modelId: 'anthropic/claude-opus-4.6',
    });
  });

  it('only adds newer versions of curated families, not brand-new families', () => {
    const current = [chat('anthropic/claude-opus-4.6')];
    const facts = [
      // Newer version of a curated family → added.
      fact('anthropic/claude-opus-4.7'),
      // Brand-new family (not curated here) → ignored.
      fact('anthropic/claude-neo-1'),
      // Newer version but family not curated in THIS config → ignored.
      fact('openai/gpt-6'),
    ];
    const { models } = syncProviderModels({ current, facts });
    const ids = models.map((m) => m.id).sort();
    expect(ids).toEqual([
      'anthropic/claude-opus-4.6',
      'anthropic/claude-opus-4.7',
    ]);
  });

  it('version-bumps a newly-curated frontier vendor (amazon)', () => {
    const current = [chat('amazon/nova-lite-v1')];
    const facts = [
      fact('amazon/nova-2-lite-v1', {
        displayName: 'Nova 2 Lite',
        contextWindow: 1000000,
      }),
    ];
    const { models, changes } = syncProviderModels({ current, facts });
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(byId.get('amazon/nova-2-lite-v1')).toBeDefined();
    expect(byId.get('amazon/nova-lite-v1')?.hidden).toBe(true);
    expect(changes).toContainEqual({
      kind: 'added',
      modelId: 'amazon/nova-2-lite-v1',
    });
  });

  it('hides every older version of a family when a newer one is added', () => {
    const current = [
      chat('anthropic/claude-opus-4.5'),
      chat('anthropic/claude-opus-4.6'),
    ];
    const facts = [fact('anthropic/claude-opus-4.8')];
    const { models } = syncProviderModels({ current, facts });
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(byId.get('anthropic/claude-opus-4.5')?.hidden).toBe(true);
    expect(byId.get('anthropic/claude-opus-4.6')?.hidden).toBe(true);
    expect(byId.get('anthropic/claude-opus-4.8')?.hidden).toBeUndefined();
  });

  it('never adds a date-snapshot fact, even for a curated family', () => {
    const current = [chat('qwen/qwen3.6-plus')];
    // Same family (qwen-plus) but a dated snapshot → version [2025,7,28],
    // rejected by the snapshot guard so it is not added.
    const facts = [fact('qwen/qwen-plus-2025-07-28')];
    const { models } = syncProviderModels({ current, facts });
    expect(models.map((m) => m.id)).toEqual(['qwen/qwen3.6-plus']);
  });

  it('does not resurrect an operator-removed model', () => {
    const base = [chat('openai/gpt-5.2')];
    const current: ModelDefinition[] = []; // operator deleted it
    const facts = [fact('openai/gpt-5.2', { isChat: true })];
    const { models } = syncProviderModels({ current, base, facts });
    expect(models).toHaveLength(0);
  });

  it('respects an operator-set hidden flag (does not unhide / re-touch)', () => {
    const base = [chat('anthropic/claude-opus-4.6')];
    // Operator explicitly UN-hid nothing here, but set hidden=false distinct
    // from a future bot decision — operator value must win.
    const current = [chat('anthropic/claude-opus-4.6', { hidden: false })];
    const facts = [
      fact('anthropic/claude-opus-4.7', { supportsVision: false }),
    ];
    const { models } = syncProviderModels({ current, base, facts });
    const old = models.find((m) => m.id === 'anthropic/claude-opus-4.6');
    // base had hidden undefined, current has hidden:false → operator-set → keep.
    expect(old?.hidden).toBe(false);
  });
});
