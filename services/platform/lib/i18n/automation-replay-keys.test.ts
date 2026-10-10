/**
 * Regression guard for the replay dialog's words
 * (`messages/<locale>/automationRuns.yml`, `replay`).
 *
 * The dialog explains a refusal of the replay plan by its code
 * (`replay.refusal.<CODE>.{title,body}`), a key it builds at run time that
 * the i18n usage scanner cannot follow: a refusal the engine adds without
 * its words, or words left behind by a retired one, fails here, as does a
 * phrase that reads an argument the dialog never passes.
 */

import { describe, expect, it } from 'vitest';

import type { ReplayRefusalCode } from '@/lib/engine/core/record/replay';
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

/** Every refusal the replay plan can answer: the dialog explains each. */
const REFUSALS = [
  'REPLAY_NODE_UNKNOWN',
  'REPLAY_GRAPH_CHANGED',
  'REPLAY_RUN_NOT_FINISHED',
  'REPLAY_MODE_MISMATCH',
  'REPLAY_PROGRESS_UNREADABLE',
  'REPLAY_INPUT_UNAVAILABLE',
] as const satisfies readonly ReplayRefusalCode[];

// A refusal the engine adds fails to compile here until it is listed.
const everyRefusal: Exclude<
  ReplayRefusalCode,
  (typeof REFUSALS)[number]
> extends never
  ? true
  : false = true;

/** The replay dialog's phrases, and the arguments each may read. */
const REPLAY_PHRASES: Readonly<Record<string, readonly string[]>> = {
  'from.title': ['step'],
  'from.titleRetry': ['step'],
  'from.body': ['version', 'run', 'step'],
  'from.reused': ['count'],
  'from.rerun': ['count'],
  'from.nothingReused': [],
  'from.confirm': ['step'],
  'from.confirmRetry': ['step'],
  'version.label': [],
  'version.same': ['version'],
  'version.latest': ['version'],
  'version.deployed': ['version'],
  'mode.label': [],
  'mode.mock': [],
  'mode.live': [],
  'mode.liveNeedsRole': [],
  'mode.liveNeedsDeployed': [],
  'mode.mockStaysMock': [],
  'writes.live': ['count', 'list'],
  'writes.mock': [],
  loadFailed: [],
  loading: [],
  tryAgain: [],
  refused: ['detail'],
  cancel: [],
};

describe('automationRuns — the replay dialog', () => {
  it('lists every refusal the engine can answer', () => {
    expect(everyRefusal).toBe(true);
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    const replay = branch(messages, 'automationRuns', 'replay');

    it(`${locale}: explains every refusal the plan can answer`, () => {
      const refusal = branch(replay, 'refusal');
      expect(Object.keys(refusal).sort()).toEqual([...REFUSALS].sort());
      for (const code of REFUSALS) {
        const entry = branch(refusal, code);
        expect(Object.keys(entry).sort(), code).toEqual(['body', 'title']);
        expect([...icuArguments(String(entry.title))], code).toEqual([]);
        for (const name of icuArguments(String(entry.body))) {
          expect(['step', 'nodes'], `${code}.body reads {${name}}`).toContain(
            name,
          );
        }
      }
    });

    it(`${locale}: the phrases read only their own arguments`, () => {
      const phrases = leaves(replay).filter(
        ([key]) => !key.startsWith('refusal.'),
      );
      expect(phrases.map(([key]) => key).sort()).toEqual(
        Object.keys(REPLAY_PHRASES).sort(),
      );
      for (const [key, value] of phrases) {
        expect(value.trim(), key).not.toBe('');
        for (const name of icuArguments(value)) {
          expect(REPLAY_PHRASES[key], `${key} reads {${name}}`).toContain(name);
        }
      }
    });
  }
});
