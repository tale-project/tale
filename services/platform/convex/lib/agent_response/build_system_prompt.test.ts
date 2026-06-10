import { describe, expect, it } from 'vitest';

import {
  buildSystemPrompt,
  instructionsAreCacheable,
  responseLanguageDirective,
} from './build_system_prompt';
import type { UserPersonalization } from './build_user_personalization';
import {
  CACHE_BREAKPOINT_MARKER,
  stripCacheBreakpoint,
} from './prompt_caching/markers';

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

  it('states that a translation/explicit-language request is one-off (#1622)', () => {
    const d = responseLanguageDirective('de-DE');
    expect(d).toContain('one-off');
    expect(d).toContain('does not carry over');
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

describe('buildSystemPrompt cache-breakpoint contract', () => {
  it('inserts exactly one breakpoint marker between the stable prefix and volatile tail', () => {
    const prompt = buildSystemPrompt(
      'Agent identity.',
      EMPTY_PERSONALIZATION,
      'Thread context.',
      undefined,
      'en',
    );
    const count = prompt.split(CACHE_BREAKPOINT_MARKER).length - 1;
    expect(count).toBe(1);
    // The stable prefix (before the marker) holds the agent identity; the
    // volatile tail (after) holds thread context + the language directive.
    const [stable, volatile] = prompt.split(CACHE_BREAKPOINT_MARKER);
    expect(stable).toContain('Agent identity.');
    expect(volatile).toContain('Thread context.');
    expect(volatile).toContain('## Language');
  });

  it('round-trips byte-for-byte to a plain \\n\\n-joined prompt when stripped', () => {
    const cached = buildSystemPrompt(
      'Agent identity.',
      EMPTY_PERSONALIZATION,
      'Thread context.',
      undefined,
      'en',
      true,
    );
    const uncached = buildSystemPrompt(
      'Agent identity.',
      EMPTY_PERSONALIZATION,
      'Thread context.',
      undefined,
      'en',
      false,
    );
    // Stripping the marker from the cacheable build must reproduce exactly the
    // non-cacheable build (what a non-caching provider would have received).
    expect(stripCacheBreakpoint(cached)).toBe(uncached);
  });

  it('omits the breakpoint marker when the prefix is not cacheable', () => {
    const prompt = buildSystemPrompt(
      'Agent identity.',
      EMPTY_PERSONALIZATION,
      'Thread context.',
      undefined,
      'en',
      false,
    );
    expect(prompt).not.toContain(CACHE_BREAKPOINT_MARKER);
  });
});

describe('instructionsAreCacheable', () => {
  it('treats plain instructions as cacheable', () => {
    expect(instructionsAreCacheable('You are a helpful agent.')).toBe(true);
    expect(instructionsAreCacheable(undefined)).toBe(true);
  });

  it('flags time-varying template vars as non-cacheable', () => {
    expect(instructionsAreCacheable('Now is {{current_time}}.')).toBe(false);
    expect(instructionsAreCacheable('Today is {{ current_date }}.')).toBe(
      false,
    );
  });

  it('keeps stable template vars cacheable', () => {
    expect(instructionsAreCacheable('Org: {{organization.name}}')).toBe(true);
    // `{{user_profile}}` resolves to a byte-stable identity block (the per-turn
    // current time was moved to the system prompt's volatile tail), so an agent
    // ending in `{{user_profile}}` — like the default chat agent — IS cacheable.
    expect(instructionsAreCacheable('Profile: {{user_profile}}')).toBe(true);
  });
});
