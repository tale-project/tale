/**
 * Regression guard for the localized automation issue catalog
 * (`messages/<locale>/automationIssues.yml`).
 *
 * The engine names every validation issue by a code from `CODES` and hands
 * the facts of its sentence as params (`CODE_META`); the editor renders
 * `codes.<CODE>.{title,explanation,cause,fix}` through
 * `app/features/automations/lib/issue-text.ts`, which builds the keys from
 * the issue's code at run time. The i18n usage scanner cannot follow that,
 * so this file walks the code list itself: a new code without its four
 * sentences, a sentence left behind by a retired code, or a sentence that
 * interpolates a param its code never carries (or one holding raw English,
 * such as a parser's message) fails here instead of rendering a raw key or a
 * literal `{param}` to an author.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ISSUE_DERIVED_PARAMS } from '@/app/features/automations/lib/issue-text';
import { CODE_META, CODES, type IssueCode } from '@/lib/engine/core/errors';
import { icuArguments } from '@/tests/utils/icu-arguments';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

const LOCALES = { en: enMessages, de: deMessages, fr: frMessages };

type Tree = Record<string, unknown>;

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issuesOf(messages: Record<string, unknown>): Tree {
  const tree = messages.automationIssues;
  return isTree(tree) ? tree : {};
}

function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') return [[path, value] as [string, string]];
    return isTree(value) ? leaves(value, path) : [];
  });
}

/** The params a code's sentences may read. */
function allowedParams(code: IssueCode): Set<string> {
  const meta = CODE_META[code];
  const technical = new Set(meta.technical ?? []);
  return new Set([
    ...meta.params
      .map((param) => param.replace(/\?$/, ''))
      .filter((param) => !technical.has(param)),
    ...ISSUE_DERIVED_PARAMS[code],
  ]);
}

/** The phrases beside the codes, and the arguments each may read. */
const PHRASES: Readonly<Record<string, readonly string[]>> = {
  'levels.error': [],
  'levels.warning': [],
  'unknownCode.title': [],
  'unknownCode.explanation': [],
  quote: ['text'],
  more: ['count'],
  place: ['hasNode', 'field', 'fieldLabel', 'nodeLabel'],
  'reasons.when': [],
  'reasons.else': ['partnerLabel'],
  'reasons.upstream': ['viaLabel'],
  'reasons.error': [],
  'reasons.sometimes': [],
  'sources.node': ['nodeLabel'],
  'sources.input': [],
  'sources.item': [],
  'sources.ownInput': [],
  'sources.passOutput': [],
  'sources.data': [],
  'kinds.string': [],
  'kinds.number': [],
  'kinds.boolean': [],
  'kinds.null': [],
  'kinds.undefined': [],
  'kinds.array': [],
  'kinds.object': [],
  'kinds.other': [],
  'places.document': [],
  'places.output': [],
  'places.inputs': [],
  'places.tests': [],
  'places.name': [],
  'places.version': [],
  'places.nodes': [],
};

const PARTS = ['title', 'explanation', 'cause', 'fix'] as const;

const ENGINE_CODES = Object.keys(CODES).filter((code): code is IssueCode =>
  Object.hasOwn(CODE_META, code),
);

describe('icuArguments', () => {
  it('reads every branch and skips quoted braces', () => {
    expect([
      ...icuArguments(
        "{a, select, x {'{{' {b} '}}'} other {{n, plural, =0 {} other {{c}}}}} {d}",
      ),
    ]).toEqual(['a', 'b', 'n', 'c', 'd']);
  });
});

describe('automationIssues — one entry per engine code', () => {
  it('derives params for exactly the engine codes', () => {
    expect(Object.keys(ISSUE_DERIVED_PARAMS).sort()).toEqual(
      Object.keys(CODES).sort(),
    );
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    const issues = issuesOf(messages);
    const codes = isTree(issues.codes) ? issues.codes : {};

    it(`${locale}: describes every code, and no code that is gone`, () => {
      expect(Object.keys(codes).sort()).toEqual(Object.keys(CODES).sort());
    });

    for (const code of ENGINE_CODES) {
      it(`${locale}: ${code} reads only its own params`, () => {
        const entry = codes[code];
        expect(isTree(entry), `automationIssues.codes.${code}`).toBe(true);
        if (!isTree(entry)) return;
        expect(Object.keys(entry).sort()).toEqual([...PARTS].sort());
        const allowed = allowedParams(code);
        const technical = CODE_META[code].technical ?? [];
        for (const part of PARTS) {
          const value = entry[part];
          expect(typeof value, `${code}.${part}`).toBe('string');
          if (typeof value !== 'string') continue;
          expect(value.trim(), `${code}.${part}`).not.toBe('');
          const used = [...icuArguments(value)];
          if (part === 'title' || part === 'explanation') {
            // They head the row and read the same for every issue.
            expect(used, `${code}.${part}`).toEqual([]);
            continue;
          }
          for (const name of used) {
            expect(technical, `${code}.${part} reads {${name}}`).not.toContain(
              name,
            );
            expect(allowed.has(name), `${code}.${part} reads {${name}}`).toBe(
              true,
            );
          }
        }
      });
    }

    it(`${locale}: the phrases read only their own arguments`, () => {
      const phrases = leaves(issues).filter(
        ([key]) => !key.startsWith('codes.'),
      );
      expect(phrases.map(([key]) => key).sort()).toEqual(
        Object.keys(PHRASES).sort(),
      );
      for (const [key, value] of phrases) {
        expect(value.trim(), key).not.toBe('');
        for (const name of icuArguments(value)) {
          expect(PHRASES[key], `${key} reads {${name}}`).toContain(name);
        }
      }
    });
  }
});

describe('automationIssues — Swiss German', () => {
  // de-CH is a sparse overlay over de: whatever it does not override reads
  // the German text, which must then carry neither ß nor „…“.
  const overrides = parse(
    readFileSync(
      join(import.meta.dirname, '../../messages/de-CH/automationIssues.yml'),
      'utf8',
    ),
  ) as Tree;
  const override = new Map(leaves(overrides));

  it('overrides only keys German has', () => {
    const german = new Set(leaves(issuesOf(deMessages)).map(([key]) => key));
    for (const key of override.keys()) expect(german.has(key), key).toBe(true);
  });

  it('reads no ß and no German quotes once resolved', () => {
    for (const [key, value] of leaves(issuesOf(deMessages))) {
      const resolved = override.get(key) ?? value;
      expect(resolved, key).not.toMatch(/[ß„“]/);
    }
  });
});
