import { describe, expect, test } from 'vitest';

import { validationResultsReference } from '../../engine/api/docs';
import { CODE_META, CODES } from '../../engine/core/errors';
import { validationReference } from './validation';

const text = validationReference();

describe('the validation reference', () => {
  test('opens with how to read a validation result, in the authoring reference’s own words', () => {
    expect(text).toContain(validationResultsReference());
  });

  test('lists every issue code exactly once, with the level it is raised at and its rule', () => {
    for (const [code, rule] of Object.entries(CODES)) {
      const lines = text
        .split('\n')
        .filter((line) => line.startsWith(`- ${code} (`));
      expect(lines, code).toHaveLength(1);
      expect(lines[0]).toContain(rule);
    }
    expect(
      text.split('\n').filter((line) => /^- [A-Z][A-Z0-9_]+ \(/.test(line)),
    ).toHaveLength(Object.keys(CODES).length);
  });

  test('names the five warnings about what the organization lacks', () => {
    for (const code of [
      'SKILL_UNKNOWN',
      'CONNECTOR_NOT_CONNECTED',
      'SECRET_UNKNOWN',
      'HARNESS_UNKNOWN',
      'EVENT_UNKNOWN',
    ] as const) {
      expect(CODE_META[code].level).toBe('warning');
      expect(text).toContain(`- ${code} (warning): `);
    }
  });
});
