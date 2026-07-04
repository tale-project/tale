import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { BUILT_IN_PATTERN_NAMES } from '@/lib/pii/patterns/names';

import { piiTypeLabel } from './pii-type-labels';

// Regression for #2351: `macAddress`, `jwt`, and `nationalId` were missing from
// the `piiTypes` catalog, so all three fell back to `_unknown` ("Sensitive").
// The Detection-patterns checkbox list then rendered three boxes all labelled
// "Sensitive" — visually and for assistive tech indistinguishable. Every
// built-in pattern must resolve to its own descriptive label, in every locale.
describe('piiTypeLabel', () => {
  for (const locale of ['en', 'de', 'fr'] as const) {
    it(`gives every built-in pattern a distinct, non-fallback label (${locale})`, () => {
      const t = i18n.getFixedT(locale, 'piiTypes');
      const fallback = t('_unknown');

      const labels = BUILT_IN_PATTERN_NAMES.map((name) => ({
        name,
        label: piiTypeLabel(name, t),
      }));

      // No built-in collapses to the generic "unknown" fallback.
      for (const { name, label } of labels) {
        expect(label, `${name} should have its own label`).not.toBe(fallback);
      }

      // Every built-in label is unique — no two checkboxes share a name.
      const unique = new Set(labels.map((l) => l.label));
      expect(unique.size).toBe(labels.length);
    });
  }
});
