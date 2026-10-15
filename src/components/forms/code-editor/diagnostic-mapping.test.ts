import { EditorState, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  diagnosticState,
  placeDiagnostics,
  setDiagnostics,
  shownDiagnostics,
} from './extensions/diagnostics';
import type { CodeEditorDiagnostic } from './types';

function problem(
  id: string,
  range: readonly [number, number] | undefined,
  extra: Partial<CodeEditorDiagnostic> = {},
): CodeEditorDiagnostic {
  return {
    id,
    severity: 'error',
    message: `problem ${id}`,
    ...(range === undefined ? {} : { range }),
    ...extra,
  };
}

function spans(items: ReturnType<typeof placeDiagnostics>) {
  return items.map((item) =>
    item.whole
      ? [item.diagnostic.id, 'whole']
      : [item.diagnostic.id, item.from, item.to],
  );
}

describe('placeDiagnostics', () => {
  const doc = Text.of(['const a = nodes.nope;', 'return a;']);

  it('keeps ranges into the text shown, widening an empty one', () => {
    expect(
      spans(
        placeDiagnostics(
          'host',
          [
            problem('a', [10, 20]),
            problem('b', [6, 6]),
            problem('c', undefined),
          ],
          doc,
        ),
      ),
    ).toEqual([
      ['a', 10, 20],
      ['b', 6, 7],
      ['c', 'whole'],
    ]);
  });

  // The host checked an older text; the reader typed since.
  it('maps ranges from the checked text and hides those the edit touched', () => {
    const checked = 'const a = nodes.nope;\nreturn a;';
    const now = Text.of(['const abc = nodes.nope;', 'return a;']);
    expect(
      spans(
        placeDiagnostics(
          'host',
          [
            problem('before', [0, 5]),
            problem('inside', [6, 7]),
            problem('after', [10, 20]),
          ],
          now,
          checked,
        ),
      ),
    ).toEqual([
      ['before', 0, 5],
      ['after', 12, 22],
    ]);
  });

  it('drops a fix whose text was edited, keeps one that was not', () => {
    const checked = 'a b';
    const now = Text.of(['a bc']);
    const [placed] = placeDiagnostics(
      'host',
      [
        problem('x', [0, 1], {
          fixes: [
            { label: 'keep', changes: [{ range: [0, 1], insert: 'A' }] },
            { label: 'lose', changes: [{ range: [2, 3], insert: 'B' }] },
          ],
        }),
      ],
      now,
      checked,
    );
    expect(placed.fixes.map((fix) => fix.label)).toEqual(['keep']);
  });
});

describe('the diagnostics state', () => {
  function state(doc: string) {
    return EditorState.create({ doc, extensions: [diagnosticState] });
  }

  it('shows a lint problem unless the host reports the same code there', () => {
    let current = state('nodes.nope + nodes.other');
    current = current.update({
      effects: [
        setDiagnostics.of({
          source: 'host',
          items: placeDiagnostics(
            'host',
            [problem('h', [0, 10], { code: 'REF' })],
            current.doc,
          ),
        }),
        setDiagnostics.of({
          source: 'lint',
          items: placeDiagnostics(
            'lint',
            [
              problem('same', [6, 10], { code: 'REF' }),
              problem('other', [13, 24], { code: 'REF' }),
            ],
            current.doc,
          ),
        }),
      ],
    }).state;
    expect(shownDiagnostics(current).map((d) => d.diagnostic.id)).toEqual([
      'h',
      'other',
    ]);
  });

  it('hides a syntax mark that another problem covers', () => {
    let current = state('{"a": }');
    current = current.update({
      effects: [
        setDiagnostics.of({
          source: 'host',
          items: placeDiagnostics('host', [problem('h', [5, 7])], current.doc),
        }),
        setDiagnostics.of({
          source: 'syntax',
          items: placeDiagnostics(
            'syntax',
            [problem('s1', [6, 7]), problem('s2', [0, 1])],
            current.doc,
          ),
        }),
      ],
    }).state;
    expect(shownDiagnostics(current).map((d) => d.diagnostic.id)).toEqual([
      's2',
      'h',
    ]);
  });

  it('maps problems through an edit and hides the one the edit touches', () => {
    let current = state('aaa bbb ccc');
    current = current.update({
      effects: setDiagnostics.of({
        source: 'host',
        items: placeDiagnostics(
          'host',
          [problem('a', [0, 3]), problem('b', [4, 7]), problem('c', [8, 11])],
          current.doc,
        ),
      }),
    }).state;
    current = current.update({ changes: { from: 5, insert: 'XX' } }).state;
    expect(spans([...shownDiagnostics(current)])).toEqual([
      ['a', 0, 3],
      ['c', 10, 13],
    ]);
    expect(current.field(diagnosticState).host).toHaveLength(2);
  });
});
