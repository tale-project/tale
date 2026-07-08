import { describe, expect, it } from 'vitest';

import { extractPlaceholders } from '../../templating/substitute';
import { ALL_PROMPT_ENTRIES, renderPrompt } from './index';

describe('registry integrity', () => {
  it('every template placeholder is declared, and every declared var is used', () => {
    for (const entry of ALL_PROMPT_ENTRIES) {
      const declared = new Set([
        ...(entry.required ?? []),
        ...(entry.optional ?? []),
      ]);
      const templates = entry.localized
        ? Object.values(entry.localized)
        : [entry.template ?? ''];
      const used = new Set(templates.flatMap((t) => extractPlaceholders(t)));

      for (const name of used) {
        expect(
          declared.has(name),
          `entry "${entry.key}" uses {{${name}}} but does not declare it`,
        ).toBe(true);
      }
      for (const name of declared) {
        expect(
          used.has(name),
          `entry "${entry.key}" declares "${name}" but no template uses it`,
        ).toBe(true);
      }
    }
  });

  it('exactly one of template / localized is set', () => {
    for (const entry of ALL_PROMPT_ENTRIES) {
      const hasTemplate = entry.template !== undefined;
      const hasLocalized = entry.localized !== undefined;
      expect(hasTemplate !== hasLocalized, `entry "${entry.key}"`).toBe(true);
    }
  });
});

describe('placeholder validation', () => {
  it('throws on a missing required var', () => {
    expect(() => renderPrompt('translation.field', {})).toThrow(
      /missing required variable "targetLocale"/,
    );
  });

  it('warns and leaves marker when onMissing="warn"', () => {
    const out = renderPrompt('translation.field', {}, { onMissing: 'warn' });
    expect(out).toContain('{{targetLocale}}');
  });

  it('throws on an unexpected var', () => {
    expect(() =>
      renderPrompt('vision.analyzer', { bogus: 'x' } as never),
    ).toThrow(/unexpected variable "bogus"/);
  });

  it('substitutes a required var', () => {
    expect(
      renderPrompt('translation.field', { targetLocale: 'de-DE' }),
    ).toContain('locale "de-DE"');
  });

  it('omitted optional var renders empty (no leftover marker)', () => {
    const out = renderPrompt('improve_message.base', {});
    expect(out).not.toContain('{{instructionLine}}');
  });

  it('supplied optional var is interpolated', () => {
    const out = renderPrompt('improve_message.base', {
      instructionLine: 'Additional instruction: be terse',
    });
    expect(out).toContain('Additional instruction: be terse');
  });
});

describe('locale fallback', () => {
  it('resolves a region-qualified locale to its base (de-CH → de)', () => {
    expect(
      renderPrompt(
        'jobs.workerPreamble',
        { name: 'worker' },
        { locale: 'de-CH' },
      ),
    ).toContain('NICHT-INTERAKTIV');
  });

  it('falls back to en for an unsupported locale', () => {
    expect(
      renderPrompt('jobs.workerPreamble', { name: 'worker' }, { locale: 'es' }),
    ).toContain('NON-INTERACTIVELY');
  });

  it('falls back to en when no locale given', () => {
    expect(renderPrompt('jobs.workerPreamble', { name: 'worker' })).toContain(
      'NON-INTERACTIVELY',
    );
  });
});

// Snapshot guard for the CACHE-CRITICAL stable-prefix prompts. The committed
// snapshot file is the frozen oracle — any byte drift invalidates prompt caches
// platform-wide, so changes here must be deliberate.
describe('cache-critical prompt snapshots', () => {
  it('system.untrusted_content', () => {
    expect(renderPrompt('system.untrusted_content')).toMatchSnapshot();
  });

  it('system.structured_response', () => {
    expect(renderPrompt('system.structured_response')).toMatchSnapshot();
  });

  it('system.response_language (both rule3 branches)', () => {
    // Branch 1: no fallback locale → English fallback.
    expect(
      renderPrompt('system.response_language', { rule3: 'reply in English' }),
    ).toMatchSnapshot();
    // Branch 2: a resolved locale → locale-language fallback (the string
    // `responseLanguageDirective` builds when a fallbackLocale is known).
    expect(
      renderPrompt('system.response_language', {
        rule3:
          "reply in the language of the user's locale `fr` (and if that is also indeterminate, English)",
      }),
    ).toMatchSnapshot();
  });
});
