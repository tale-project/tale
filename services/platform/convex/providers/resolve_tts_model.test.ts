import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { type ResolvedModelData, resolveTtsModel } from '../resolve_model';

function makeCtx(modelData: ResolvedModelData): ActionCtx {
  return {
    runAction: vi.fn().mockResolvedValue(modelData),
  } as unknown as ActionCtx;
}

function makeCtxWithSpy(modelData: ResolvedModelData): {
  ctx: ActionCtx;
  runAction: ReturnType<typeof vi.fn>;
} {
  const runAction = vi.fn().mockResolvedValue(modelData);
  return {
    ctx: { runAction } as unknown as ActionCtx,
    runAction,
  };
}

function makeRejectingCtx(err: unknown): {
  ctx: ActionCtx;
  runAction: ReturnType<typeof vi.fn>;
} {
  const runAction = vi.fn().mockRejectedValue(err);
  return {
    ctx: { runAction } as unknown as ActionCtx,
    runAction,
  };
}

function baseModelData(
  overrides: Partial<ResolvedModelData> = {},
): ResolvedModelData {
  return {
    providerName: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    modelId: 'gpt-4o-mini-tts',
    tags: ['text-to-speech'],
    supportsStructuredOutputs: false,
    defaultVoice: 'alloy',
    audioFormat: 'mp3',
    ...overrides,
  };
}

describe('resolveTtsModel', () => {
  describe('voice resolution', () => {
    it('picks voice from voicesByLocale on a full locale hit', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy', de: 'nova', 'de-CH': 'shimmer' },
          }),
        ),
        { orgSlug: 'default', locale: 'de-CH' },
      );
      expect(result.voice).toBe('shimmer');
    });

    it('falls back to base language when full locale is missing', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { de: 'nova' },
          }),
        ),
        { orgSlug: 'default', locale: 'de-CH' },
      );
      expect(result.voice).toBe('nova');
    });

    it('falls back to defaultVoice when locale and base both miss', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy' },
            defaultVoice: 'fable',
          }),
        ),
        { orgSlug: 'default', locale: 'ja' },
      );
      expect(result.voice).toBe('fable');
    });

    it('throws UNKNOWN_VOICE when neither map nor defaultVoice produce a value', async () => {
      await expect(
        resolveTtsModel(
          makeCtx(
            baseModelData({
              voicesByLocale: { en: 'alloy' },
              defaultVoice: undefined,
            }),
          ),
          { orgSlug: 'default', locale: 'ja' },
        ),
      ).rejects.toThrow(/UNKNOWN_VOICE/);
    });
  });

  describe('instructions resolution', () => {
    it('picks instructions from instructionsByLocale on a full locale hit', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { 'de-CH': 'nova' },
            instructionsByLocale: {
              en: 'Speak warmly in English.',
              'de-CH': 'Sprich freundlich auf Schweizerdeutsch.',
            },
          }),
        ),
        { orgSlug: 'default', locale: 'de-CH' },
      );
      expect(result.instructions).toBe(
        'Sprich freundlich auf Schweizerdeutsch.',
      );
    });

    it('falls back to base language for instructions', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { 'de-CH': 'nova' },
            instructionsByLocale: { de: 'Sprich freundlich.' },
          }),
        ),
        { orgSlug: 'default', locale: 'de-CH' },
      );
      expect(result.instructions).toBe('Sprich freundlich.');
    });

    it('falls back to defaultInstructions when locale and base miss', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy' },
            instructionsByLocale: { en: 'Warm English voice.' },
            defaultInstructions: 'Warm fallback voice.',
          }),
        ),
        { orgSlug: 'default', locale: 'fr' },
      );
      expect(result.instructions).toBe('Warm fallback voice.');
    });

    it('returns undefined when neither instruction field is configured', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy' },
          }),
        ),
        { orgSlug: 'default', locale: 'en' },
      );
      expect(result.instructions).toBeUndefined();
    });

    it('returns undefined when only an unrelated locale entry exists', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy' },
            instructionsByLocale: { de: 'Sprich freundlich.' },
          }),
        ),
        { orgSlug: 'default', locale: 'en' },
      );
      expect(result.instructions).toBeUndefined();
    });
  });

  describe('audioFormat resolution', () => {
    it('passes through configured audioFormat', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy' },
            audioFormat: 'opus',
          }),
        ),
        { orgSlug: 'default', locale: 'en' },
      );
      expect(result.audioFormat).toBe('opus');
    });

    it('defaults audioFormat to mp3 when unset', async () => {
      const result = await resolveTtsModel(
        makeCtx(
          baseModelData({
            voicesByLocale: { en: 'alloy' },
            audioFormat: undefined,
          }),
        ),
        { orgSlug: 'default', locale: 'en' },
      );
      expect(result.audioFormat).toBe('mp3');
    });
  });

  // Round-5 finding #29: the prior tests stubbed `runAction` with
  // `mockResolvedValue` and never asserted that the resolver actually
  // calls the file_actions internal action with the right contract —
  // a regression that hard-coded `tag: 'chat'` or dropped `orgSlug`
  // would have passed the entire suite silently. These tests pin the
  // call contract AND exercise the failure-path branches that
  // `errorCodeFromCaught` relies on for terminal-vs-retryable
  // classification.
  describe('resolver call contract', () => {
    it('invokes file_actions.resolveModelByTag with tag=text-to-speech', async () => {
      const { ctx, runAction } = makeCtxWithSpy(
        baseModelData({ voicesByLocale: { en: 'alloy' } }),
      );
      await resolveTtsModel(ctx, { orgSlug: 'default', locale: 'en' });
      expect(runAction).toHaveBeenCalledTimes(1);
      expect(runAction).toHaveBeenCalledWith(
        internal.providers.file_actions.resolveModelByTag,
        {
          tag: 'text-to-speech',
          providerName: undefined,
          orgSlug: 'default',
        },
      );
    });

    it('propagates orgSlug to the internal action', async () => {
      const { ctx, runAction } = makeCtxWithSpy(
        baseModelData({ voicesByLocale: { en: 'alloy' } }),
      );
      await resolveTtsModel(ctx, {
        orgSlug: 'acme-prod',
        locale: 'en',
      });
      expect(runAction).toHaveBeenCalledWith(
        internal.providers.file_actions.resolveModelByTag,
        expect.objectContaining({ orgSlug: 'acme-prod' }),
      );
    });

    it('propagates providerName when the caller pins one (e.g. elevenlabs)', async () => {
      const { ctx, runAction } = makeCtxWithSpy(
        baseModelData({
          providerName: 'elevenlabs',
          voicesByLocale: { en: 'rachel' },
        }),
      );
      const result = await resolveTtsModel(ctx, {
        orgSlug: 'default',
        locale: 'en',
        providerName: 'elevenlabs',
      });
      expect(runAction).toHaveBeenCalledWith(
        internal.providers.file_actions.resolveModelByTag,
        expect.objectContaining({ providerName: 'elevenlabs' }),
      );
      expect(result.providerName).toBe('elevenlabs');
    });
  });

  describe('failure-path propagation', () => {
    it('re-throws UNKNOWN_MODEL ConvexError unchanged for the classifier', async () => {
      const err = new ConvexError({
        code: 'UNKNOWN_MODEL',
        message: 'no TTS model tagged "text-to-speech" in any provider',
      });
      const { ctx } = makeRejectingCtx(err);
      await expect(
        resolveTtsModel(ctx, { orgSlug: 'default', locale: 'en' }),
      ).rejects.toBe(err);
    });

    it('re-throws UNKNOWN_PROVIDER ConvexError unchanged', async () => {
      const err = new ConvexError({
        code: 'UNKNOWN_PROVIDER',
        message: 'provider "elevenlabs" not configured',
      });
      const { ctx } = makeRejectingCtx(err);
      await expect(
        resolveTtsModel(ctx, {
          orgSlug: 'default',
          locale: 'en',
          providerName: 'elevenlabs',
        }),
      ).rejects.toBe(err);
    });

    it('re-throws a plain rejection unchanged (network, timeout, etc.)', async () => {
      const err = new Error('runAction transport failed');
      const { ctx } = makeRejectingCtx(err);
      await expect(
        resolveTtsModel(ctx, { orgSlug: 'default', locale: 'en' }),
      ).rejects.toBe(err);
    });
  });
});
