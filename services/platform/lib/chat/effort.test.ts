import { describe, expect, it } from 'vitest';

import {
  modelCatalogEntrySchema,
  type ModelCatalogEntry,
} from '../shared/schemas/providers';
import {
  EFFORT_LEVELS,
  fitSamplingToWindow,
  isReasoningEffort,
  resolveTurnSampling,
  type ReasoningEffort,
} from './effort';

/**
 * The mapping table IS the contract: five user steps onto two provider knobs,
 * with the clamps that keep every produced request acceptable to the wire —
 * most of all the `maxTokens > budgetTokens` invariant, which a provider
 * hard-rejects when violated.
 */

function model(overrides: Record<string, unknown> = {}): ModelCatalogEntry {
  return modelCatalogEntrySchema.parse({
    id: 'test-model',
    provider: 'test-provider',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 200_000,
    ...overrides,
  });
}

const EFFORT_MODEL = model({ reasoning: { knob: 'effort' } });
const THINKING_MODEL = model({
  reasoning: { knob: 'budget-tokens' },
  maxOutputTokens: 128_000,
});

describe('isReasoningEffort', () => {
  it('accepts exactly the five levels', () => {
    for (const level of EFFORT_LEVELS) {
      expect(isReasoningEffort(level)).toBe(true);
    }
    expect(isReasoningEffort('maximum')).toBe(false);
    expect(isReasoningEffort('')).toBe(false);
    expect(isReasoningEffort(undefined)).toBe(false);
    expect(isReasoningEffort(3)).toBe(false);
  });
});

describe('resolveTurnSampling — the default (no effort, or no reasoning)', () => {
  it('falls back to 4096 only when the model declares no output ceiling', () => {
    expect(resolveTurnSampling(model())).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
    });
    expect(resolveTurnSampling(EFFORT_MODEL)).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
    });
    // A declared ceiling is respected in full — up to the half-window share
    // (128k declared, 200k window → the share wins at 100k).
    expect(resolveTurnSampling(THINKING_MODEL)).toEqual({
      maxTokens: 100_000,
      temperature: 0.7,
    });
  });

  it('silently ignores an effort on a model with no reasoning capability', () => {
    for (const level of EFFORT_LEVELS) {
      expect(resolveTurnSampling(model(), level)).toEqual({
        maxTokens: 4096,
        temperature: 0.7,
      });
    }
  });

  it('the declared output ceiling IS the default, under the half-window share', () => {
    expect(resolveTurnSampling(model({ maxOutputTokens: 2000 }))).toEqual({
      maxTokens: 2000,
      temperature: 0.7,
    });
    // No constant caps a declaration any more: 32k declared rides in full.
    expect(resolveTurnSampling(model({ maxOutputTokens: 32_000 }))).toEqual({
      maxTokens: 32_000,
      temperature: 0.7,
    });
    // The share rule: output never claims more than half the model's window.
    expect(
      resolveTurnSampling(
        model({ maxOutputTokens: 32_000, contextWindow: 16_000 }),
      ),
    ).toEqual({
      maxTokens: 8000,
      temperature: 0.7,
    });
  });
});

describe("resolveTurnSampling — the 'effort' knob", () => {
  it.each([
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['extra', 'high'],
    ['max', 'high'],
  ] as const)('folds %s onto the provider level %s', (effort, wire) => {
    expect(resolveTurnSampling(EFFORT_MODEL, effort)).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      reasoning: { kind: 'effort', value: wire },
    });
  });
});

describe("resolveTurnSampling — the catalog's reasoning.off declaration", () => {
  it('sends the declared off value when no effort is picked', () => {
    const offModel = model({ reasoning: { knob: 'effort', off: 'none' } });
    expect(resolveTurnSampling(offModel)).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      reasoning: { kind: 'effort', value: 'none' },
    });
  });

  it.each(['minimal', 'low'] as const)(
    'passes a lowest-supported floor of %s through unchanged',
    (off) => {
      const floored = model({ reasoning: { knob: 'effort', off } });
      expect(resolveTurnSampling(floored)).toEqual({
        maxTokens: 4096,
        temperature: 0.7,
        reasoning: { kind: 'effort', value: off },
      });
    },
  );

  it('keeps the parameter off the wire when the model declares no off', () => {
    expect(resolveTurnSampling(EFFORT_MODEL)).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
    });
  });

  it('an explicit pick always beats the off declaration', () => {
    const offModel = model({ reasoning: { knob: 'effort', off: 'none' } });
    expect(resolveTurnSampling(offModel, 'high')).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      reasoning: { kind: 'effort', value: 'high' },
    });
  });

  it('toolsRequireOff forces the off value over any pick', () => {
    // The endpoint refuses tools+effort together (gpt-5.5 on OpenAI) and a
    // chat turn always carries tools — a sticky pick must not 400 the turn.
    const locked = model({
      reasoning: { knob: 'effort', off: 'none', toolsRequireOff: true },
    });
    expect(resolveTurnSampling(locked, 'high')).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      reasoning: { kind: 'effort', value: 'none' },
    });
    expect(resolveTurnSampling(locked)).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
      reasoning: { kind: 'effort', value: 'none' },
    });
  });

  it('the schema refuses off on a budget-tokens model, so the mapping never sees one', () => {
    expect(() =>
      model({ reasoning: { knob: 'budget-tokens', off: 'none' } }),
    ).toThrow();
  });
});

describe("resolveTurnSampling — the 'budget-tokens' knob", () => {
  it.each([
    ['low', 2048],
    ['medium', 8192],
    ['high', 24_576],
    ['extra', 49_152],
    ['max', 98_304],
  ] as const)(
    'gives %s its full budget of %d on a roomy model',
    (effort, budget) => {
      // The answer keeps whatever the budget leaves of the model's full
      // declared ceiling (128k, share-capped to half the 200k window) —
      // headroom is no longer a 4096-token constant.
      expect(resolveTurnSampling(THINKING_MODEL, effort)).toEqual({
        maxTokens: 100_000,
        reasoning: { kind: 'thinking', budgetTokens: budget },
      });
    },
  );

  it('omits temperature entirely while thinking is enabled', () => {
    const sampling = resolveTurnSampling(THINKING_MODEL, 'max');
    expect('temperature' in sampling).toBe(false);
  });

  it("clamps the budget to the model's output ceiling minus headroom", () => {
    const tight = model({
      reasoning: { knob: 'budget-tokens' },
      maxOutputTokens: 8192,
    });
    // cap = min(8192, 100000) - 1024 = 7168; maxTokens caps at the ceiling.
    expect(resolveTurnSampling(tight, 'max')).toEqual({
      maxTokens: 8192,
      reasoning: { kind: 'thinking', budgetTokens: 7168 },
    });
  });

  it('clamps the budget to half the context window when that is tighter', () => {
    const narrow = model({
      reasoning: { knob: 'budget-tokens' },
      contextWindow: 16_000,
      maxOutputTokens: 64_000,
    });
    // Budget cap = min(64000, 8000) - 1024 = 6976; the declared 64k output
    // ceiling meets the same half-window share: maxTokens = 8000.
    expect(resolveTurnSampling(narrow, 'max')).toEqual({
      maxTokens: 8000,
      reasoning: { kind: 'thinking', budgetTokens: 6976 },
    });
  });

  it('assumes a 64k output ceiling when the model declares none', () => {
    const undeclared = model({
      reasoning: { knob: 'budget-tokens' },
      contextWindow: 1_000_000,
    });
    // cap = min(64000, 500000) - 1024 = 62976 < the max budget of 98304.
    expect(resolveTurnSampling(undeclared, 'max')).toEqual({
      maxTokens: 62_976 + 4096,
      reasoning: { kind: 'thinking', budgetTokens: 62_976 },
    });
    // A budget under the cap passes through untouched.
    expect(resolveTurnSampling(undeclared, 'medium')).toEqual({
      maxTokens: 8192 + 4096,
      reasoning: { kind: 'thinking', budgetTokens: 8192 },
    });
  });

  it('never lets the budget fall under the provider minimum of 1024', () => {
    const tiny = model({
      reasoning: { knob: 'budget-tokens' },
      contextWindow: 4000,
      maxOutputTokens: 1500,
    });
    // cap = min(1500, 2000) - 1024 = 476 → the 1024 floor wins.
    const sampling = resolveTurnSampling(tiny, 'low');
    expect(sampling.reasoning).toEqual({
      kind: 'thinking',
      budgetTokens: 1024,
    });
  });

  it('keeps maxTokens strictly above the budget across extreme models', () => {
    const extremes = [
      // Tiny output ceilings, including ones under the minimum budget.
      model({
        reasoning: { knob: 'budget-tokens' },
        contextWindow: 3000,
        maxOutputTokens: 512,
      }),
      model({
        reasoning: { knob: 'budget-tokens' },
        contextWindow: 4096,
        maxOutputTokens: 2048,
      }),
      model({
        reasoning: { knob: 'budget-tokens' },
        contextWindow: 8000,
        maxOutputTokens: 3000,
      }),
      // Odd context window (the half rounds down), no output ceiling.
      model({ reasoning: { knob: 'budget-tokens' }, contextWindow: 4097 }),
      // Huge window, huge ceiling.
      model({
        reasoning: { knob: 'budget-tokens' },
        contextWindow: 2_000_000,
        maxOutputTokens: 128_000,
      }),
    ];
    for (const extreme of extremes) {
      for (const level of EFFORT_LEVELS) {
        const sampling = resolveTurnSampling(extreme, level);
        if (sampling.reasoning?.kind !== 'thinking') {
          throw new Error('expected a thinking budget');
        }
        expect(sampling.maxTokens).toBeGreaterThan(
          sampling.reasoning.budgetTokens,
        );
        expect(sampling.reasoning.budgetTokens).toBeGreaterThanOrEqual(1024);
        expect(Number.isInteger(sampling.maxTokens)).toBe(true);
        expect(Number.isInteger(sampling.reasoning.budgetTokens)).toBe(true);
      }
    }
  });

  it('scales monotonically: a higher step never thinks less', () => {
    const budgets = EFFORT_LEVELS.map((level: ReasoningEffort) => {
      const sampling = resolveTurnSampling(THINKING_MODEL, level);
      return sampling.reasoning?.kind === 'thinking'
        ? sampling.reasoning.budgetTokens
        : 0;
    });
    for (let i = 1; i < budgets.length; i += 1) {
      expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1] ?? 0);
    }
  });
});

describe('fitSamplingToWindow — the governance re-fit', () => {
  it('returns a sampling that already fits, unchanged and by reference', () => {
    const sampling = resolveTurnSampling(THINKING_MODEL, 'medium');
    expect(fitSamplingToWindow(sampling, 200_000)).toBe(sampling);
  });

  it('re-applies the half-window share when governance shrank the window', () => {
    // Declared 128k rode in full at 100k; a 32k governed window halves it.
    const sampling = resolveTurnSampling(THINKING_MODEL);
    expect(fitSamplingToWindow(sampling, 32_000)).toEqual({
      maxTokens: 16_000,
      temperature: 0.7,
    });
  });

  it('shrinks a thinking budget alongside, keeping the wire invariant', () => {
    const sampling = resolveTurnSampling(THINKING_MODEL, 'max');
    // 98304 thinking + 100k ceiling into an 8k governed window: the share
    // is 4000, the budget re-clamps under it, maxTokens stays above the
    // budget by the provider minimum.
    const fitted = fitSamplingToWindow(sampling, 8_000);
    expect(fitted).toEqual({
      maxTokens: 4000,
      reasoning: { kind: 'thinking', budgetTokens: 4000 - 1024 },
    });
  });

  it('never drops under the provider-minimum floor on a degenerate window', () => {
    const fitted = fitSamplingToWindow(
      resolveTurnSampling(THINKING_MODEL, 'max'),
      1_000,
    );
    if (fitted.reasoning?.kind !== 'thinking') {
      throw new Error('expected a thinking budget');
    }
    expect(fitted.reasoning.budgetTokens).toBeGreaterThanOrEqual(1024);
    expect(fitted.maxTokens).toBeGreaterThan(fitted.reasoning.budgetTokens);
  });
});
