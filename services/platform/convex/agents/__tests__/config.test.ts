import { describe, it, expect } from 'vitest';

import { toSerializableConfig } from '../config';
import type { AgentJsonConfig } from '../file_utils';

const baseConfig: AgentJsonConfig = {
  supportedModels: ['openai:gpt-4o'],
};

describe('toSerializableConfig systemInstructions resolution', () => {
  it('prefers i18n[locale].systemInstructions over all fallbacks', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
      i18n: {
        en: { systemInstructions: 'English i18n' },
        de: { systemInstructions: 'German i18n' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'de');
    expect(result.instructions).toBe('German i18n');
  });

  it('falls back to i18n.en.systemInstructions when requested locale is missing', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
      i18n: {
        en: { systemInstructions: 'English i18n' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'fr');
    expect(result.instructions).toBe('English i18n');
  });

  it('falls back to top-level systemInstructions when no i18n entries exist', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
    };
    const result = toSerializableConfig('test', config, undefined, 'de');
    expect(result.instructions).toBe('legacy top-level');
  });

  it('falls back to top-level when i18n has no matching locale and no en entry', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
      i18n: {
        de: { systemInstructions: 'German only' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'fr');
    expect(result.instructions).toBe('legacy top-level');
  });

  it('prefers i18n.en over top-level when locale is en', () => {
    // Under i18n-first, any i18n entry wins over top-level.
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'WRONG (legacy)',
      i18n: {
        en: { systemInstructions: 'English i18n' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'en');
    expect(result.instructions).toBe('English i18n');
  });

  it('defaults to empty string when nothing is set', () => {
    const config: AgentJsonConfig = { ...baseConfig };
    const result = toSerializableConfig('test', config, undefined, 'en');
    expect(result.instructions).toBe('');
  });

  it('omitted locale arg uses top-level + i18n.en fallback', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      i18n: { en: { systemInstructions: 'English i18n' } },
    };
    const result = toSerializableConfig('test', config);
    expect(result.instructions).toBe('English i18n');
  });
});
