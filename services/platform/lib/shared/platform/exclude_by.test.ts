import { describe, expect, it } from 'vitest';

import { buildExclusionSet, excludeExisting } from './exclude_by';

describe('buildExclusionSet', () => {
  it('collects non-empty keys, skipping falsy + non-record rows', () => {
    const set = buildExclusionSet(
      [
        { externalId: 'tale-project/tale#1' },
        { externalId: 'tale-project/tale#2' },
        { externalId: undefined },
        { externalId: null },
        { externalId: '' },
        { other: 'x' },
        'not-a-record',
        42,
      ],
      'externalId',
    );
    expect([...set].sort()).toEqual([
      'tale-project/tale#1',
      'tale-project/tale#2',
    ]);
    // The literal "undefined"/"null"/"" never leak in.
    expect(set.has('undefined')).toBe(false);
    expect(set.has('null')).toBe(false);
    expect(set.has('')).toBe(false);
  });

  it('stringifies numeric keys', () => {
    const set = buildExclusionSet([{ id: 7 }], 'id');
    expect(set.has('7')).toBe(true);
  });

  it('treats entries as bare keys when no refField is given', () => {
    // A key-only query (e.g. listExternalKeysByProject) returns a string[]; with
    // an empty refField each entry IS the key.
    const set = buildExclusionSet(
      ['tale-project/tale#1', 'tale-project/tale#2', '', 9],
      '',
    );
    expect([...set].sort()).toEqual([
      '9',
      'tale-project/tale#1',
      'tale-project/tale#2',
    ]);
  });
});

describe('excludeExisting', () => {
  const issues = [
    { number: 1, title: 'a' },
    { number: 2, title: 'b' },
    { number: 3, title: 'c' },
  ];
  const tmpl = 'tale-project/tale#{number}';

  it('drops rows whose templated key matches a reference key', () => {
    const refRows = [
      { externalId: 'tale-project/tale#2' },
      { externalId: 'tale-project/tale#99' },
    ];
    expect(excludeExisting(issues, refRows, 'externalId', tmpl)).toEqual([
      { number: 1, title: 'a' },
      { number: 3, title: 'c' },
    ]);
  });

  it('returns a copy of all rows when there are no reference keys', () => {
    const result = excludeExisting(issues, [], 'externalId', tmpl);
    expect(result).toEqual(issues);
    expect(result).not.toBe(issues);
  });

  it('builds the key from per-install config (owner/repo) merged with the row', () => {
    // A repo-agnostic key: owner/repo come from the app's config, number from the
    // row — so it matches the externalId the create path wrote from the same config.
    const scoped = '{owner}/{repo}#{number}';
    const config = { owner: 'acme', repo: 'widgets' };
    const refRows = [{ externalId: 'acme/widgets#2' }];
    expect(
      excludeExisting(issues, refRows, 'externalId', scoped, config),
    ).toEqual([
      { number: 1, title: 'a' },
      { number: 3, title: 'c' },
    ]);
  });

  it('ignores reference rows with falsy keys (no accidental exclusion)', () => {
    const refRows = [{ externalId: undefined }, { externalId: '' }];
    expect(excludeExisting(issues, refRows, 'externalId', tmpl)).toEqual(
      issues,
    );
  });

  it('a row missing the template field keeps the placeholder verbatim and is not excluded', () => {
    // interpolateTemplate leaves `{number}` literal when the field is absent, so
    // the key becomes "tale-project/tale#{number}" — which won't match a real id.
    const rows = [{ title: 'no-number' }];
    const refRows = [{ externalId: 'tale-project/tale#1' }];
    expect(excludeExisting(rows, refRows, 'externalId', tmpl)).toEqual(rows);
  });
});
