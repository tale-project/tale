import { describe, expect, it } from 'vitest';

import { isAppConfigComplete, mergeAppConfigFields } from './app_config';

/** Generic manifest-shaped fields — no app-specific keys in platform tests. */
const REQUIRED_PLUS_OPTIONAL = [
  { key: 'target', type: 'string' as const },
  { key: 'hint', type: 'string' as const, optional: true },
  { key: 'notes', type: 'string' as const, optional: true },
];

describe('isAppConfigComplete', () => {
  it('is true when required fields are set and optional fields are empty', () => {
    expect(
      isAppConfigComplete(REQUIRED_PLUS_OPTIONAL, {
        target: 'acme/widgets',
        hint: '',
        notes: '',
      }),
    ).toBe(true);
  });

  it('is false when a required field is missing or empty', () => {
    expect(
      isAppConfigComplete(REQUIRED_PLUS_OPTIONAL, {
        target: '',
        hint: 'value',
      }),
    ).toBe(false);
    expect(isAppConfigComplete(REQUIRED_PLUS_OPTIONAL, {})).toBe(false);
  });

  it('treats boolean fields as always satisfied', () => {
    expect(
      isAppConfigComplete([{ key: 'enabled', type: 'boolean' }], {
        enabled: false,
      }),
    ).toBe(true);
  });
});

describe('mergeAppConfigFields', () => {
  it('overlays optional from the catalog onto installed fields', () => {
    const merged = mergeAppConfigFields(
      [
        { key: 'target', type: 'string' },
        { key: 'hint', type: 'string' },
      ],
      [
        { key: 'target', type: 'string' },
        { key: 'hint', type: 'string', optional: true },
      ],
    );
    expect(
      isAppConfigComplete(merged, {
        target: 'acme/widgets',
        hint: '',
      }),
    ).toBe(true);
    expect(
      (merged.find((f) => f.key === 'hint') as { optional?: boolean }).optional,
    ).toBe(true);
  });
});
