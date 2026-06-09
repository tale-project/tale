import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
} from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import { CACHE_BREAKPOINT_MARKER } from './markers';
import { createCacheControlMiddleware } from './middleware';

// Stable prefix comfortably over the ~4096-char cacheable floor.
const STABLE = `You are a helpful agent.\n${'x'.repeat(5000)}`;
const VOLATILE =
  '## Thread context\nrecent messages…\n\n## Language\nreply in English';
const SYSTEM_WITH_MARKER = `${STABLE}${CACHE_BREAKPOINT_MARKER}${VOLATILE}`;
// What a non-caching provider must see: marker → '\n\n', byte-identical.
const SYSTEM_STRIPPED = `${STABLE}\n\n${VOLATILE}`;

function makeParams(systemContent: string): LanguageModelV3CallOptions {
  const prompt: LanguageModelV3Prompt = [
    { role: 'system', content: systemContent },
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ];
  return { prompt };
}

function transformParamsOf(
  modelData: Parameters<typeof createCacheControlMiddleware>[0],
) {
  const fn = createCacheControlMiddleware(modelData).transformParams;
  if (!fn) throw new Error('middleware has no transformParams');
  return fn;
}

async function run(
  modelData: Parameters<typeof createCacheControlMiddleware>[0],
  systemContent: string,
) {
  const params = makeParams(systemContent);
  const out = await transformParamsOf(modelData)({
    type: 'generate',
    params,
    model: {} as LanguageModelV3,
  });
  return { params, out };
}

describe('createCacheControlMiddleware', () => {
  it('Anthropic: splits into a cacheable stable system message + volatile one', async () => {
    const { out } = await run(
      {
        providerName: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
        promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
      },
      SYSTEM_WITH_MARKER,
    );
    const systems = out.prompt.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(2);
    expect(systems[0]).toEqual({
      role: 'system',
      content: STABLE,
      providerOptions: {
        openaiCompatible: { cache_control: { type: 'ephemeral' } },
      },
    });
    expect(systems[1]).toEqual({ role: 'system', content: VOLATILE });
    // No marker leaks anywhere; user turn preserved.
    expect(JSON.stringify(out.prompt)).not.toContain('TALE_CACHE_BREAKPOINT');
    expect(out.prompt.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('Anthropic: below the cacheable floor → single clean system message, no cache_control', async () => {
    const smallStable = 'short identity';
    const sys = `${smallStable}${CACHE_BREAKPOINT_MARKER}${VOLATILE}`;
    const { out } = await run(
      {
        providerName: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
        promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
      },
      sys,
    );
    const systems = out.prompt.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0]).toEqual({
      role: 'system',
      content: `${smallStable}\n\n${VOLATILE}`,
    });
  });

  it('auto-server (OpenAI): strips marker + sets a deterministic prompt_cache_key', async () => {
    const { out } = await run(
      {
        providerName: 'openai',
        modelId: 'gpt-4o',
        promptCaching: { mode: 'auto-server' },
      },
      SYSTEM_WITH_MARKER,
    );
    const systems = out.prompt.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0]).toEqual({ role: 'system', content: SYSTEM_STRIPPED });
    const key = (out.providerOptions?.openai as Record<string, unknown>)
      ?.prompt_cache_key;
    expect(typeof key).toBe('string');
    expect(key).toMatch(/^tale-[0-9a-f]{8}$/);

    // Deterministic: same stable prefix → same key across calls.
    const { out: out2 } = await run(
      {
        providerName: 'openai',
        modelId: 'gpt-4o',
        promptCaching: { mode: 'auto-server' },
      },
      SYSTEM_WITH_MARKER,
    );
    const po2 = out2.providerOptions?.openai as
      | Record<string, unknown>
      | undefined;
    expect(po2?.prompt_cache_key).toBe(key);
  });

  it('none (unknown model): strips marker, no cache_control, no cache key', async () => {
    const { out } = await run(
      { providerName: 'custom', modelId: 'mistral-large' },
      SYSTEM_WITH_MARKER,
    );
    const systems = out.prompt.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0]).toEqual({ role: 'system', content: SYSTEM_STRIPPED });
    expect(out.providerOptions?.custom).toBeUndefined();
  });

  it('no system message → params returned unchanged', async () => {
    const params: LanguageModelV3CallOptions = {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    };
    const out = await transformParamsOf({
      providerName: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4',
    })({ type: 'generate', params, model: {} as LanguageModelV3 });
    expect(out).toBe(params);
  });

  it('does not mutate the input params', async () => {
    const { params, out } = await run(
      {
        providerName: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4',
        promptCaching: { mode: 'explicit-breakpoints', maxBreakpoints: 4 },
      },
      SYSTEM_WITH_MARKER,
    );
    expect(out.prompt).not.toBe(params.prompt);
    // Original system message still carries the raw marker.
    const originalSystem = params.prompt[0];
    expect(originalSystem.role === 'system' && originalSystem.content).toBe(
      SYSTEM_WITH_MARKER,
    );
  });
});
