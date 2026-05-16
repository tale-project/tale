import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';
import { type ResolvedModelData, resolveTtsModel } from '../resolve_model';

function makeCtx(modelData: ResolvedModelData): ActionCtx {
  return {
    runAction: vi.fn().mockResolvedValue(modelData),
  } as unknown as ActionCtx;
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
});
