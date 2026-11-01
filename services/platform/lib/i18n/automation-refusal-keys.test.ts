/**
 * Regression guard for the words of a refused automation write
 * (`messages/<locale>/automations.yml`, `refusals`).
 *
 * The app words a refusal by its code (`refusals.<CODE>`, or
 * `refusals.<CODE>.<variant>` for a code with several sentences), a key it
 * builds at run time that the i18n usage scanner cannot follow
 * (`app/features/automations/lib/refusal-text.ts`). A code the store refuses
 * with but the app cannot word, words left behind by a retired code, a
 * sentence that reads an argument the app never passes, or one a locale
 * leaves in English fails here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REFUSAL_SENTENCES,
  type RefusalSentenceKey,
  refusalWords,
} from '@/app/features/automations/lib/refusal-text';
import { AUTOMATION_REFUSAL_CODES } from '@/lib/shared/schemas/automation-refusals';
import { icuArguments } from '@/tests/utils/icu-arguments';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

const LOCALES = { en: enMessages, de: deMessages, fr: frMessages };

type Tree = Record<string, unknown>;

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function branch(tree: unknown, ...path: string[]): Tree {
  let at = tree;
  for (const key of path) at = isTree(at) ? at[key] : undefined;
  return isTree(at) ? at : {};
}

function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') return [[path, value] as [string, string]];
    return isTree(value) ? leaves(value, path) : [];
  });
}

function isSentenceKey(key: string): key is RefusalSentenceKey {
  return Object.hasOwn(REFUSAL_SENTENCES, key);
}

/** The sources that refuse automation writes: the store and its doors, and
 * the engine's replay plan. */
function refusingSources(): string[] {
  const roots = ['backend/domains/automations', 'lib/engine'];
  return roots.flatMap((root) =>
    readdirSync(join(process.cwd(), root), { recursive: true })
      .map(String)
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts') &&
          !file.endsWith('.integration.ts'),
      )
      .map((file) => readFileSync(join(process.cwd(), root, file), 'utf8')),
  );
}

describe('automations — the words of a refused write', () => {
  it('words every code with a sentence of the catalog or the replay dialog', () => {
    for (const code of AUTOMATION_REFUSAL_CODES) {
      const words = refusalWords(code);
      if ('replay' in words) {
        expect(
          branch(enMessages, 'automationRuns', 'replay', 'refusal', code),
          code,
        ).toHaveProperty(words.part);
      } else {
        expect(isSentenceKey(words.key), `${code} reads ${words.key}`).toBe(
          true,
        );
      }
    }
  });

  it('keeps no sentence for a code the store no longer lists', () => {
    const codes: readonly string[] = AUTOMATION_REFUSAL_CODES;
    for (const key of Object.keys(REFUSAL_SENTENCES)) {
      expect(codes, key).toContain(key.split('.')[0]);
    }
  });

  it('lists only codes an automation door still refuses with', () => {
    const sources = refusingSources();
    for (const code of AUTOMATION_REFUSAL_CODES) {
      expect(
        sources.some((source) => source.includes(`'${code}'`)),
        `no automation door refuses with ${code}`,
      ).toBe(true);
    }
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    const sentences = leaves(branch(messages, 'automations', 'refusals'));
    const english = new Map(
      leaves(branch(enMessages, 'automations', 'refusals')),
    );

    it(`${locale}: has every sentence and no other`, () => {
      expect(sentences.map(([key]) => key).sort()).toEqual(
        Object.keys(REFUSAL_SENTENCES).sort(),
      );
    });

    it(`${locale}: each sentence reads only the facts the app passes it`, () => {
      for (const [key, value] of sentences) {
        expect(value.trim(), key).not.toBe('');
        const passed: readonly string[] = isSentenceKey(key)
          ? REFUSAL_SENTENCES[key]
          : [];
        for (const name of icuArguments(value)) {
          expect(passed, `${key} reads {${name}}`).toContain(name);
        }
      }
    });

    if (locale !== 'en') {
      it(`${locale}: words each sentence in its own language`, () => {
        for (const [key, value] of sentences) {
          expect(value, key).not.toBe(english.get(key));
        }
      });
    }
  }
});
