import { describe, expect, it } from 'vitest';

import { validatePack } from './validate_pack';

const baseLocales = ['en', 'de', 'fr'] as const;

const workflows = [
  {
    name: 'issue-desk',
    steps: [
      { stepSlug: 'review', ui: { render: 'review', labelKey: 'desk.review' } },
      {
        stepSlug: 'verify',
        ui: {
          render: 'validation',
          params: {
            fields: [{ key: 'r', labelKey: 'desk.result', type: 'text' }],
          },
        },
      },
    ],
  },
];

describe('validatePack', () => {
  it('passes when render-kinds are known and labels exist in all base locales', () => {
    const catalog = { 'desk.review': 'Review', 'desk.result': 'Result' };
    const res = validatePack({
      workflows,
      catalogs: { en: catalog, de: catalog, fr: catalog },
      baseLocales,
    });
    expect(res.valid).toBe(true);
  });

  it('rejects a pack missing a label key in one locale (the de gap)', () => {
    const full = { 'desk.review': 'Review', 'desk.result': 'Result' };
    const res = validatePack({
      workflows,
      catalogs: {
        en: full,
        de: { 'desk.review': 'Prüfen' }, // missing desk.result
        fr: full,
      },
      baseLocales,
    });
    expect(res.valid).toBe(false);
    expect(
      res.errors.some((e) => e.includes('desk.result') && e.includes('de')),
    ).toBe(true);
  });

  it('rejects an unknown render-kind', () => {
    const res = validatePack({
      workflows: [{ name: 'x', steps: [{ ui: { render: 'spiral' } }] }],
      catalogs: { en: {}, de: {}, fr: {} },
      baseLocales,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('spiral'))).toBe(true);
  });

  it('is valid for a pack with no annotated steps', () => {
    const res = validatePack({
      workflows: [{ name: 'plain', steps: [{ stepSlug: 's' }] }],
      catalogs: { en: {}, de: {}, fr: {} },
      baseLocales,
    });
    expect(res.valid).toBe(true);
  });
});
