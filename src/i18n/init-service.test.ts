import { describe, expect, it } from 'vitest';

import { mergeBundles } from './init-service';

describe('mergeBundles', () => {
  it('keeps sibling keys when a later bundle redeclares one nested key', () => {
    const fromPackage = {
      common: {
        actions: { save: 'Save', cancel: 'Cancel' },
        aria: { close: 'Close' },
      },
    };
    const fromService = {
      common: {
        actions: { save: 'Save changes' },
      },
    };

    expect(mergeBundles(fromPackage, fromService)).toEqual({
      common: {
        actions: { save: 'Save changes', cancel: 'Cancel' },
        aria: { close: 'Close' },
      },
    });
  });

  it('adds namespaces only one side defines and lets the last bundle win', () => {
    expect(
      mergeBundles(
        { search: { title: 'Search' } },
        undefined,
        { nav: { home: 'Home' } },
        { search: { title: 'Find' } },
      ),
    ).toEqual({ search: { title: 'Find' }, nav: { home: 'Home' } });
  });

  it('replaces a leaf with a subtree (and back) instead of merging across kinds', () => {
    expect(
      mergeBundles({ a: { key: 'leaf' } }, { a: { key: { nested: 'tree' } } }),
    ).toEqual({ a: { key: { nested: 'tree' } } });
  });
});
