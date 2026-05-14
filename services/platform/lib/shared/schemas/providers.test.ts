import { describe, expect, it } from 'vitest';

import { providerJsonSchema } from './providers';

describe('providerJsonSchema', () => {
  const baseProvider = {
    displayName: 'Test Provider',
    baseUrl: 'https://api.example.com/v1',
    models: [
      {
        id: 'test/model-1',
        displayName: 'Test Model 1',
        tags: ['chat'],
      },
    ],
  };

  describe('supportsStructuredOutputs', () => {
    it('accepts provider-level supportsStructuredOutputs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        supportsStructuredOutputs: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts per-model supportsStructuredOutputs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        supportsStructuredOutputs: true,
        models: [
          {
            id: 'test/model-1',
            displayName: 'Test Model 1',
            tags: ['chat'],
            supportsStructuredOutputs: false,
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.models[0].supportsStructuredOutputs).toBe(false);
      }
    });

    it('defaults per-model supportsStructuredOutputs to undefined when not set', () => {
      const result = providerJsonSchema.safeParse(baseProvider);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.models[0].supportsStructuredOutputs).toBeUndefined();
      }
    });
  });

  describe('model ID uniqueness', () => {
    it('rejects duplicate model IDs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        models: [
          { id: 'test/model-1', displayName: 'Model A', tags: ['chat'] },
          { id: 'test/model-1', displayName: 'Model B', tags: ['chat'] },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('text-to-speech tag', () => {
    it('accepts a TTS model with voicesByLocale and defaults', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        defaults: { 'text-to-speech': 'tts/v1' },
        models: [
          {
            id: 'tts/v1',
            displayName: 'TTS v1',
            tags: ['text-to-speech'],
            audioFormat: 'mp3',
            defaultVoice: 'alloy',
            voicesByLocale: { en: 'alloy', de: 'nova', 'de-CH': 'nova' },
            cost: { centsPerMillionCharacters: 1500 },
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const model = result.data.models[0];
        expect(model.tags).toContain('text-to-speech');
        expect(model.voicesByLocale?.de).toBe('nova');
        expect(model.audioFormat).toBe('mp3');
        expect(result.data.defaults?.['text-to-speech']).toBe('tts/v1');
      }
    });

    it('rejects defaults.text-to-speech referencing a non-TTS model', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        defaults: { 'text-to-speech': 'test/model-1' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects voicesByLocale with an invalid locale key', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        models: [
          {
            id: 'tts/v1',
            displayName: 'TTS v1',
            tags: ['text-to-speech'],
            voicesByLocale: { english: 'alloy' },
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('defaults validation', () => {
    it('rejects defaults referencing unknown model IDs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        defaults: { chat: 'nonexistent/model' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects defaults referencing model without matching tag', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        models: [
          { id: 'test/embed', displayName: 'Embed', tags: ['embedding'] },
        ],
        defaults: { chat: 'test/embed' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('providerOptions', () => {
    it('accepts a provider-level providerOptions block', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        providerOptions: {
          provider: { allow_fallbacks: false, data_collection: 'deny' },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a model-level providerOptions block', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        models: [
          {
            id: 'test/model-1',
            displayName: 'Test Model 1',
            tags: ['chat'],
            providerOptions: { provider: { quantizations: ['fp8'] } },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts both placements simultaneously', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        providerOptions: { provider: { allow_fallbacks: false } },
        models: [
          {
            id: 'test/model-1',
            displayName: 'Test Model 1',
            tags: ['chat'],
            providerOptions: { provider: { quantizations: ['fp8'] } },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('treats absent field as undefined', () => {
      const result = providerJsonSchema.safeParse(baseProvider);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.providerOptions).toBeUndefined();
        expect(result.data.models[0].providerOptions).toBeUndefined();
      }
    });

    it('rejects non-object providerOptions value', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        providerOptions: 'oops' as never,
      });
      expect(result.success).toBe(false);
    });

    describe('deny-list rejection', () => {
      const bodyOverwriteSamples = [
        'model',
        'messages',
        'tools',
        'tool_choice',
        'stream',
        'temperature',
        'max_tokens',
        'top_p',
        'frequency_penalty',
        'presence_penalty',
        'response_format',
        'stop',
        'seed',
        'n',
        'logit_bias',
        'logprobs',
        'top_logprobs',
        'stream_options',
        'store',
        'metadata',
      ];

      const sdkReservedSamples = [
        'user',
        'reasoningEffort',
        'textVerbosity',
        'strictJsonSchema',
      ];

      for (const key of bodyOverwriteSamples) {
        it(`rejects body-overwrite key '${key}' at provider level`, () => {
          const result = providerJsonSchema.safeParse({
            ...baseProvider,
            providerOptions: { [key]: 'evil' },
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues[0].message).toContain(
              "would overwrite the request body's",
            );
          }
        });
      }

      for (const key of sdkReservedSamples) {
        it(`rejects SDK-reserved key '${key}' at provider level`, () => {
          const result = providerJsonSchema.safeParse({
            ...baseProvider,
            providerOptions: { [key]: 'value' },
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues[0].message).toContain(
              'set it at the agent level',
            );
          }
        });
      }

      it("rejects deny-listed key one level deep (double-wrap like 'openrouter.model')", () => {
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          providerOptions: { openrouter: { model: 'evil' } },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const paths = result.error.issues.map((i) => i.path.join('.'));
          expect(paths).toContain('providerOptions.openrouter.model');
        }
      });

      it('rejects at model-level too', () => {
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          models: [
            {
              id: 'test/model-1',
              displayName: 'Test Model 1',
              tags: ['chat'],
              providerOptions: { max_tokens: 999_999 },
            },
          ],
        });
        expect(result.success).toBe(false);
      });

      it('emits two distinct errors when both categories of bad keys are present', () => {
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          providerOptions: { model: 'evil', reasoningEffort: 'high' },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages.some((m) => m.includes('overwrite'))).toBe(true);
          expect(
            messages.some((m) => m.includes('set it at the agent level')),
          ).toBe(true);
        }
      });

      it('does not recurse below depth 2 (provider.foo.model is allowed as a body sub-field)', () => {
        // The SDK only spreads top-level keys of providerOptions[name] into the
        // body. Nested `provider.model` would just be a sub-field of the
        // outgoing `provider:` object — not a body field that gets clobbered.
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          providerOptions: {
            provider: { quantizations: ['fp8'], extra: { model: 'inner' } },
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('value shape', () => {
      it('accepts top-level primitive values (OpenAI service_tier style)', () => {
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          providerOptions: {
            service_tier: 'priority',
            parallel_tool_calls: false,
            prompt_cache_key: 'agent-foo-v1',
          },
        });
        expect(result.success).toBe(true);
      });

      it('accepts top-level null values', () => {
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          providerOptions: { provider: null },
        });
        expect(result.success).toBe(true);
      });

      it('rejects top-level array values (would spread numeric keys)', () => {
        const result = providerJsonSchema.safeParse({
          ...baseProvider,
          providerOptions: { provider: ['fp8', 'fp16'] as never },
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('i18n', () => {
    it('accepts a well-formed i18n block', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: {
          en: { displayName: 'EN', description: 'English' },
          de: { displayName: 'DE', description: 'Deutsch' },
          'de-CH': { displayName: 'CH-DE' },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts per-model overrides nested under i18n[locale].models', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: {
          de: {
            models: {
              'test/model-1': { description: 'Modellbeschreibung' },
            },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts an empty models object inside an i18n entry', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: { de: { description: 'D', models: {} } },
      });
      expect(result.success).toBe(true);
    });

    it('rejects uppercase locale codes', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: { EN: { description: 'nope' } },
      });
      expect(result.success).toBe(false);
    });

    it('rejects spelled-out language names', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: { english: { description: 'nope' } },
      });
      expect(result.success).toBe(false);
    });

    it('rejects underscore-style locale codes', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: { de_CH: { description: 'nope' } },
      });
      expect(result.success).toBe(false);
    });

    it('rejects translatable displayName longer than 200 chars', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        i18n: { de: { displayName: 'x'.repeat(201) } },
      });
      expect(result.success).toBe(false);
    });
  });
});
