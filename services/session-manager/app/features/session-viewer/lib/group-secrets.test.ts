import { describe, expect, it } from 'vitest';

import { meta, secretSummary } from '@/tests/utils/fixtures';

import { groupSecrets, splitLines } from './group-secrets';

const kinds = meta().secretKinds;

describe('groupSecrets', () => {
  it('groups by kind, in the order of the kinds of the app', () => {
    const groups = groupSecrets(
      [
        secretSummary({ id: 1, kind: 'note', title: 'N' }),
        secretSummary({ id: 2, kind: 'credentials', title: 'C' }),
        secretSummary({ id: 3, kind: 'personal', title: 'P' }),
      ],
      kinds,
    );
    expect(groups.map((group) => group.kind)).toEqual([
      'personal',
      'credentials',
      'note',
    ]);
  });

  it('keeps the order the server sent within a group', () => {
    const groups = groupSecrets(
      [
        secretSummary({ id: 9, kind: 'credentials' }),
        secretSummary({ id: 4, kind: 'credentials' }),
        secretSummary({ id: 7, kind: 'credentials' }),
      ],
      kinds,
    );
    expect(groups[0]?.secrets.map((secret) => secret.id)).toEqual([9, 4, 7]);
  });

  it('leaves out a kind without a secret', () => {
    expect(
      groupSecrets([secretSummary({ kind: 'card' })], kinds).map(
        (group) => group.kind,
      ),
    ).toEqual(['card']);
    expect(groupSecrets([], kinds)).toEqual([]);
  });

  it('puts a kind that the app does not know last, under its key', () => {
    const known = kinds.filter((kind) => kind.key !== 'personal');
    const groups = groupSecrets(
      [
        secretSummary({ id: 1, kind: 'personal' }),
        secretSummary({ id: 2, kind: 'credentials' }),
      ],
      known,
    );
    expect(groups.map((group) => group.kind)).toEqual([
      'credentials',
      'personal',
    ]);
  });

  it('groups by kind when the kinds of the app are not known yet', () => {
    expect(
      groupSecrets([secretSummary({ kind: 'credentials' })], []).map(
        (group) => group.kind,
      ),
    ).toEqual(['credentials']);
  });

  it('has no words of its own for a group: the kind is the app’s to word, in the language of the person', () => {
    const [group] = groupSecrets([secretSummary({ kind: 'card' })], kinds);
    expect(group).toEqual({ kind: 'card', secrets: [expect.anything()] });
  });
});

describe('splitLines', () => {
  it('takes the first line of a value and counts the ones that follow', () => {
    expect(splitLines('Main Street 1\n12345 Town\nGermany')).toEqual({
      first: 'Main Street 1',
      more: 2,
    });
    expect(splitLines('single')).toEqual({ first: 'single', more: 0 });
    expect(splitLines('')).toEqual({ first: '', more: 0 });
  });

  it('does not count a line break at the end as a line', () => {
    expect(splitLines('single\n')).toEqual({ first: 'single', more: 0 });
    expect(splitLines('one\ntwo\n\n')).toEqual({ first: 'one', more: 1 });
  });

  it('counts a blank line in the middle, which the value types', () => {
    expect(splitLines('one\n\nthree')).toEqual({ first: 'one', more: 2 });
  });

  it('reads a line break of Windows as one', () => {
    expect(splitLines('one\r\ntwo')).toEqual({ first: 'one', more: 1 });
  });
});
