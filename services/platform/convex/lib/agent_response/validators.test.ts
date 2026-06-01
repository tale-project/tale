import { describe, expect, it } from 'vitest';

import { userContextValidator } from './validators';

// Regression guard for a shipped bug: the client sends userContext as
// `{ timezone, language, uiLanguage }`, and Convex arg-validation is STRICT —
// an extra field that the validator doesn't declare throws ArgumentValidationError
// at runtime. Six chat/thread entry points used to carry duplicated inline
// userContext validators; three had drifted to omit `uiLanguage`, so a turn that
// reached `runAgentGeneration` was rejected with "extra field `uiLanguage`".
//
// All six now share `userContextValidator`. Locking its shape here catches the
// drift the moment `uiLanguage` is dropped or made required again.
describe('userContextValidator', () => {
  it('declares timezone, language, and an optional uiLanguage', () => {
    const { fields } = userContextValidator;

    expect(Object.keys(fields).sort()).toEqual([
      'language',
      'timezone',
      'uiLanguage',
    ]);
    expect(fields.timezone.isOptional).toBe('required');
    expect(fields.language.isOptional).toBe('required');
    expect(fields.uiLanguage.isOptional).toBe('optional');
  });
});
