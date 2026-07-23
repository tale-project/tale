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
 * Every prompt JSON in `builtin-configs/prompts/` ships as part of the
 * product — new orgs seed their prompt library by copying + provisioning these
 * files (`prompts/provision_defaults.ts`), which goes around the normal write
 * boundary. If an example drifts into an invalid shape, oversize content, or
 * loses `autoInstall`, new orgs silently inherit the breakage. Pin it in CI.
 */

const EXAMPLES_DIR = path.resolve(
  __dirname,
  '../../../../../builtin-configs/prompts',
);

// The shipped default-prompt catalog retired with the rest of the builtin
// config tree; the prompt library itself is replaced by user skills in a
// later stage of the rewrite, so no new catalog returns. The schema and
// display-resolution units below keep guarding the live prompts domain
// (DB-backed templates) until that replacement lands.

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
