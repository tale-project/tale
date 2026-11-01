/**
 * Regression guard for the words a refused cron expression reads in
 * (`trigger.cronProblems` and `trigger.cronFields` in
 * `messages/<locale>/automations.yml`).
 *
 * The parser (`lib/automations/cron.ts`) names what it refuses by a kind and
 * the facts of its sentence; `app/features/automations/lib/cron-problem-text.ts`
 * words each kind from its catalog string, and a kind without one reads as
 * the bare refusal. This file holds every kind to its words: a kind the
 * parser gains fails typecheck in `KINDS` until it has an entry, a locale
 * missing the kind's sentence fails here, and so does a sentence that drops
 * one of the facts or reads one its kind never carries.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { CronFieldName, CronProblemKind } from '@/lib/automations/cron';
import { icuArguments } from '@/tests/utils/icu-arguments';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

const LOCALES = { en: enMessages, de: deMessages, fr: frMessages };

type Tree = Record<string, unknown>;

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function branch(tree: unknown, path: readonly string[]): Tree {
  let node = tree;
  for (const key of path) node = isTree(node) ? node[key] : undefined;
  return isTree(node) ? node : {};
}

function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') return [[path, value] as [string, string]];
    return isTree(value) ? leaves(value, path) : [];
  });
}

/** Each kind's sentence under `trigger.cronProblems`, and the arguments it
 * reads: the text as written, the field it stands in, the values allowed. */
const KINDS: Readonly<
  Record<CronProblemKind, { key: string; reads: readonly string[] }>
> = {
  field_count: { key: 'fieldCount', reads: ['count'] },
  empty_entry: { key: 'emptyEntry', reads: ['field', 'token'] },
  invalid_step: { key: 'invalidStep', reads: ['field', 'token'] },
  not_a_range: { key: 'notARange', reads: ['field', 'token'] },
  out_of_range: { key: 'outOfRange', reads: ['field', 'token', 'min', 'max'] },
  matches_nothing: { key: 'matchesNothing', reads: ['field', 'token'] },
  impossible_date: { key: 'impossibleDate', reads: ['days', 'months'] },
};

/** The fields a problem can stand in, named under `trigger.cronFields`. */
const FIELDS: Readonly<Record<CronFieldName, true>> = {
  minute: true,
  hour: true,
  dayOfMonth: true,
  month: true,
  dayOfWeek: true,
};

describe('trigger.cronProblems — one sentence per parser kind', () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    const problems = branch(messages, [
      'automations',
      'trigger',
      'cronProblems',
    ]);

    it(`${locale}: words every kind, and no kind that is gone`, () => {
      expect(Object.keys(problems).sort()).toEqual(
        Object.values(KINDS)
          .map(({ key }) => key)
          .sort(),
      );
    });

    for (const [kind, { key, reads }] of Object.entries(KINDS)) {
      it(`${locale}: ${kind} reads exactly its own facts`, () => {
        const sentence = problems[key];
        expect(typeof sentence, `trigger.cronProblems.${key}`).toBe('string');
        if (typeof sentence !== 'string') return;
        expect(sentence.trim(), key).not.toBe('');
        expect(new Set(icuArguments(sentence)), key).toEqual(new Set(reads));
      });
    }

    it(`${locale}: names every field a problem can stand in`, () => {
      const fields = branch(messages, ['automations', 'trigger', 'cronFields']);
      expect(Object.keys(fields).sort()).toEqual(Object.keys(FIELDS).sort());
      for (const [field, name] of Object.entries(fields)) {
        expect(typeof name, field).toBe('string');
        if (typeof name !== 'string') continue;
        expect(name.trim(), field).not.toBe('');
        expect([...icuArguments(name)], field).toEqual([]);
      }
    });
  }
});

describe('trigger.cronProblems — Swiss German', () => {
  // de-CH is a sparse overlay over de: whatever it does not override reads
  // the German text, which must then carry neither ß nor „…“.
  const overrides = parse(
    readFileSync(
      join(import.meta.dirname, '../../messages/de-CH/automations.yml'),
      'utf8',
    ),
  ) as unknown;
  const german = [
    ...leaves(
      branch(deMessages, ['automations', 'trigger', 'cronProblems']),
      'cronProblems',
    ),
    ...leaves(
      branch(deMessages, ['automations', 'trigger', 'cronFields']),
      'cronFields',
    ),
  ];
  const swiss = new Map(
    leaves(branch(overrides, ['trigger'])).filter(([key]) =>
      /^cron(Problems|Fields)\./.test(key),
    ),
  );

  it('overrides only keys German has', () => {
    const keys = new Set(german.map(([key]) => key));
    for (const key of swiss.keys()) expect(keys.has(key), key).toBe(true);
  });

  it('reads no ß and no German quotes once resolved', () => {
    for (const [key, value] of german) {
      expect(swiss.get(key) ?? value, key).not.toMatch(/[ß„“]/);
    }
  });
});
