import { describe, expect, it } from 'vitest';

import { latinSlug } from './latin-slug.ts';

/**
 * One fold from a name a person types to a slug — an automation's name, an
 * organization's tenant key. The regression under test: the organization
 * wizard folded on its own and dropped every accented letter, so `Müller AG`
 * would have been stored for good as `m-ller-ag`.
 */
describe('latinSlug', () => {
  it.each([
    ['Müller AG', 'muller-ag'],
    ['Société Générale', 'societe-generale'],
    ['Zürcher Bau GmbH', 'zurcher-bau-gmbh'],
    ['Smith & Co.', 'smith-co'],
    ['Acme Inc.', 'acme-inc'],
    ['Größe', 'grosse'],
    ['ÉCOLE', 'ecole'],
    ['ﬁnance', 'finance'],
    ['  Résumé du jour!  ', 'resume-du-jour'],
  ])('folds %j to %j', (name, slug) => {
    expect(latinSlug(name, 64)).toBe(slug);
  });

  it.each(['@@@', '发票提醒', '   '])(
    'folds %j, which has no Latin letter or digit, to nothing',
    (name) => {
      expect(latinSlug(name, 64)).toBe('');
    },
  );

  it('cuts at the cap without leaving a hyphen at the end', () => {
    expect(latinSlug('x'.repeat(70), 64)).toBe('x'.repeat(64));
    expect(latinSlug(`${'a'.repeat(63)} b`, 64)).toBe('a'.repeat(63));
  });
});
