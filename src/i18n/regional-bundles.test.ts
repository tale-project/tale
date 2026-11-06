import { describe, expect, it } from 'vitest';

import { collectRegionalBundles } from './regional-bundles';

describe('collectRegionalBundles', () => {
  it('keys the YAML catalogs a service globs by their regional locale code', () => {
    const deCh = { common: { aria: { close: 'Schliessen' } } };
    expect(
      collectRegionalBundles({
        '../../messages/de-CH.yml': deCh,
        '../../messages/fr-CA.yaml': { nav: {} },
      }),
    ).toEqual({ 'de-CH': deCh, 'fr-CA': { nav: {} } });
  });

  it('drops files whose name is not an xx-YY locale code', () => {
    expect(
      collectRegionalBundles({
        '../../messages/en.yml': { nav: {} },
        '../../messages/keys-dynamic.yml': { entries: {} },
        '../../messages/de-ch.yml': { nav: {} },
      }),
    ).toEqual({});
  });
});
