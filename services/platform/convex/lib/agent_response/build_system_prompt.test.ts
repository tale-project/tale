import { describe, expect, it } from 'vitest';

import {
  buildSystemPrompt,
  responseLanguageDirective,
} from './build_system_prompt';
import type { UserPersonalization } from './build_user_personalization';

const EMPTY_PERSONALIZATION: UserPersonalization = {
  text: '',
  fingerprint: '',
  injectedMemoryIds: [],
  tokens: 0,
};

describe('responseLanguageDirective', () => {
  it('always states the explicit-request and message-language rules', () => {
    for (const locale of [undefined, 'de-DE']) {
      const d = responseLanguageDirective(locale);
      expect(d).toContain('## Language');
      expect(d).toContain('Explicit request');
      expect(d).toContain('Message language');
      expect(d).toContain('Never use timezone');
    }
  });

  it('uses the resolved fallback locale in rule 3 when known', () => {
    const d = responseLanguageDirective('de-DE');
    expect(d).toContain('`de-DE`');
    expect(d).toContain('Fallback');
  });

  it('falls back to English when no locale is known', () => {
    const d = responseLanguageDirective(undefined);
    expect(d).toContain('reply in English');
    expect(d).not.toContain('`');
  });
});

describe('buildSystemPrompt response language', () => {
  it('appends the language directive last, after thread context', () => {
    const directive = responseLanguageDirective('fr-FR');
    const prompt = buildSystemPrompt(
      'You are a helpful agent.',
      EMPTY_PERSONALIZATION,
      'Thread context here.',
      undefined,
      'fr-FR',
    );
    expect(prompt).toContain('You are a helpful agent.');
    expect(prompt.trimEnd().endsWith(directive)).toBe(true);
    expect(prompt.indexOf('## Language')).toBeGreaterThan(
      prompt.indexOf('Thread context here.'),
    );
  });

  it('still includes the directive when no locale is provided', () => {
    const prompt = buildSystemPrompt(
      'You are a helpful agent.',
      EMPTY_PERSONALIZATION,
      undefined,
    );
    expect(prompt).toContain('## Language');
    expect(prompt).toContain('reply in English');
  });
});
