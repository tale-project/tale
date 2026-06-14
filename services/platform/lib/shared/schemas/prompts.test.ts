import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_PROMPT_CONTENT_BYTES } from '../../../convex/prompts/constants';
import { validatePromptSlug } from '../../../convex/prompts/file_utils';
import { SUPPORTED_AGENT_LOCALES } from '../constants/agents';
import { promptJsonSchema, resolvePromptDisplay } from './prompts';

// Locales the default catalog must ship a full translation for (every
// supported locale except the canonical top-level English copy).
const NON_DEFAULT_LOCALES = SUPPORTED_AGENT_LOCALES.filter((l) => l !== 'en');

/**
 * Every prompt JSON in `examples/default/prompts/` ships as part of the
 * product — new orgs seed their prompt library by copying + provisioning these
 * files (`prompts/provision_defaults.ts`), which goes around the normal write
 * boundary. If an example drifts into an invalid shape, oversize content, or
 * loses `autoInstall`, new orgs silently inherit the breakage. Pin it in CI.
 */

const EXAMPLES_DIR = path.resolve(
  __dirname,
  '../../../../../examples/default/prompts',
);

describe('examples/default/prompts/*.json invariants', () => {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'));

  it('discovered at least one default prompt', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('all filenames are valid prompt slugs', () => {
    for (const file of files) {
      expect(validatePromptSlug(file.replace(/\.json$/, ''))).toBe(true);
    }
  });

  for (const file of files) {
    describe(file, () => {
      const raw = readFileSync(path.join(EXAMPLES_DIR, file), 'utf-8');
      const parsed = promptJsonSchema.safeParse(JSON.parse(raw));

      it('parses against promptJsonSchema', () => {
        expect(parsed.success).toBe(true);
      });

      it('is flagged autoInstall and within the content byte cap', () => {
        if (!parsed.success) throw new Error('schema parse failed');
        expect(parsed.data.metadata?.autoInstall).toBe(true);
        const bytes = new TextEncoder().encode(
          parsed.data.content.trim(),
        ).byteLength;
        expect(bytes).toBeLessThanOrEqual(MAX_PROMPT_CONTENT_BYTES);
        expect(bytes).toBeGreaterThan(0);
      });

      it('ships a full translation for every supported locale', () => {
        if (!parsed.success) throw new Error('schema parse failed');
        for (const loc of NON_DEFAULT_LOCALES) {
          const o = parsed.data.i18n?.[loc];
          expect(o, `${file} missing i18n.${loc}`).toBeDefined();
          // Resolver must yield fully-localized display copy (no English
          // fallback leaking into a non-English org).
          const display = resolvePromptDisplay(parsed.data, loc);
          expect(display.title).toBe(o?.title);
          expect(display.content).toBe(o?.content);
          expect(display.title.length).toBeGreaterThan(0);
          expect(display.content.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe('resolvePromptDisplay', () => {
  const config = {
    title: 'Hello',
    content: 'Body',
    description: 'Desc',
    category: 'Writing',
    i18n: { de: { title: 'Hallo', content: 'Inhalt' } },
  };

  it('returns the localized override when present', () => {
    const d = resolvePromptDisplay(config, 'de');
    expect(d.title).toBe('Hallo');
    expect(d.content).toBe('Inhalt');
    // Unset override fields fall back to the canonical top-level copy.
    expect(d.description).toBe('Desc');
    expect(d.category).toBe('Writing');
  });

  it('falls back to top-level English for an unlocalized locale', () => {
    const d = resolvePromptDisplay(config, 'fr');
    expect(d.title).toBe('Hello');
    expect(d.content).toBe('Body');
  });
});

describe('validatePromptSlug', () => {
  it('accepts lowercase slugs with hyphens/underscores', () => {
    expect(validatePromptSlug('summarize-text')).toBe(true);
    expect(validatePromptSlug('weigh_pros_and_cons')).toBe(true);
    expect(validatePromptSlug('a1')).toBe(true);
  });

  it('rejects uppercase, leading symbols, traversal, and slashes', () => {
    expect(validatePromptSlug('Summarize')).toBe(false);
    expect(validatePromptSlug('-leading')).toBe(false);
    expect(validatePromptSlug('a/b')).toBe(false);
    expect(validatePromptSlug('..')).toBe(false);
    expect(validatePromptSlug('')).toBe(false);
  });
});
