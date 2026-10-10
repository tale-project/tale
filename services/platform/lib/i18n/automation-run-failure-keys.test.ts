/**
 * Regression guard for the localized run failure catalog
 * (`messages/<locale>/automationRuns.yml`: `runtime.codes` and
 * `runFailure`).
 *
 * The engine names every step failure by a reason from
 * `STEP_FAILURE_REASONS` and hands the facts of its sentence as params
 * (`STEP_FAILURE_META`); a run names its family by a `RUN_FAILURE_CODES`
 * member. The run view renders `runtime.codes.<REASON>.{title,explanation,
 * cause,fix}` and `runFailure.codes.<code>.{title,explanation,fix}` through
 * `app/features/automations/lib/run-failure.ts`, which builds the keys from
 * the failure at run time. The i18n usage scanner cannot follow that, so this file walks
 * the lists itself: a new reason or code without its sentences, a sentence
 * left behind by a retired one, or a sentence that interpolates a param its
 * reason never carries (or one holding an engine's or a service's own
 * English) fails here instead of rendering a raw key or a literal `{param}`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { RUN_FAILURE_DERIVED_PARAMS } from '@/app/features/automations/lib/run-failure';
import { RUN_FAILURE_CODES } from '@/backend/core/automations/failure';
import {
  STEP_FAILURE_META,
  STEP_FAILURE_REASONS,
  type StepFailureReason,
} from '@/lib/engine/core/record/failure';
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

/** The params a reason's sentences may read. */
function allowedParams(reason: StepFailureReason): Set<string> {
  const meta = STEP_FAILURE_META[reason];
  const technical = new Set(meta.technical ?? []);
  return new Set([
    ...[...meta.params, ...(meta.optional ?? [])].filter(
      (param) => !technical.has(param),
    ),
    ...RUN_FAILURE_DERIVED_PARAMS[reason],
  ]);
}

const REASON_PARTS = ['title', 'explanation', 'cause', 'fix'] as const;
const CODE_PARTS = ['title', 'explanation', 'fix'] as const;

describe('automationRuns — one entry per step failure reason', () => {
  it('derives params for exactly the engine reasons', () => {
    expect(Object.keys(RUN_FAILURE_DERIVED_PARAMS).sort()).toEqual(
      [...STEP_FAILURE_REASONS].sort(),
    );
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    const codes = branch(messages, 'automationRuns', 'runtime', 'codes');

    it(`${locale}: describes every reason, and no reason that is gone`, () => {
      expect(Object.keys(codes).sort()).toEqual(
        [...STEP_FAILURE_REASONS].sort(),
      );
    });

    for (const reason of STEP_FAILURE_REASONS) {
      it(`${locale}: ${reason} reads only its own params`, () => {
        const entry = codes[reason];
        expect(isTree(entry), `runtime.codes.${reason}`).toBe(true);
        if (!isTree(entry)) return;
        expect(Object.keys(entry).sort()).toEqual([...REASON_PARTS].sort());
        const allowed = allowedParams(reason);
        const technical = STEP_FAILURE_META[reason].technical ?? [];
        for (const part of REASON_PARTS) {
          const value = entry[part];
          expect(typeof value, `${reason}.${part}`).toBe('string');
          if (typeof value !== 'string') continue;
          expect(value.trim(), `${reason}.${part}`).not.toBe('');
          const used = [...icuArguments(value)];
          if (part === 'title' || part === 'explanation') {
            // They head the card and read the same for every failure.
            expect(used, `${reason}.${part}`).toEqual([]);
            continue;
          }
          for (const name of used) {
            expect(
              technical,
              `${reason}.${part} reads {${name}}`,
            ).not.toContain(name);
            expect(allowed.has(name), `${reason}.${part} reads {${name}}`).toBe(
              true,
            );
          }
        }
      });
    }
  }
});

describe('automationRuns — one entry per run failure code', () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    const runFailure = branch(messages, 'automationRuns', 'runFailure');

    it(`${locale}: describes every code, and no code that is gone`, () => {
      expect(Object.keys(runFailure).sort()).toEqual(['codes', 'unknown']);
      expect(Object.keys(branch(runFailure, 'codes')).sort()).toEqual(
        [...RUN_FAILURE_CODES].sort(),
      );
    });

    it(`${locale}: each code says its title, meaning and fix, with no params`, () => {
      const entries = [
        ...Object.entries(branch(runFailure, 'codes')),
        ['unknown', runFailure.unknown] as const,
      ];
      for (const [code, entry] of entries) {
        expect(isTree(entry), code).toBe(true);
        if (!isTree(entry)) continue;
        expect(Object.keys(entry).sort(), code).toEqual([...CODE_PARTS].sort());
        for (const part of CODE_PARTS) {
          const value = entry[part];
          expect(typeof value, `${code}.${part}`).toBe('string');
          if (typeof value !== 'string') continue;
          expect(value.trim(), `${code}.${part}`).not.toBe('');
          expect([...icuArguments(value)], `${code}.${part}`).toEqual([]);
        }
      }
    });
  }
});

describe('automationRuns — Swiss German', () => {
  // de-CH is a sparse overlay over de: whatever it does not override reads
  // the German text, which must then carry neither ß nor „…“.
  const overrides = parse(
    readFileSync(
      join(import.meta.dirname, '../../messages/de-CH/automationRuns.yml'),
      'utf8',
    ),
  ) as Tree;
  const override = new Map(leaves(overrides));
  const german = leaves(branch(deMessages, 'automationRuns'));

  it('overrides only keys German has', () => {
    const keys = new Set(german.map(([key]) => key));
    for (const key of override.keys()) expect(keys.has(key), key).toBe(true);
  });

  it('reads no ß and no German quotes once resolved', () => {
    for (const [key, value] of german) {
      expect(override.get(key) ?? value, key).not.toMatch(/[ß„“]/);
    }
  });
});
