import { SETTINGS_KINDS } from '@tale/shared/schemas/settings-kinds';
import { describe, expect, it } from 'vitest';

import { SETTINGS_HANDLERS } from './handlers.ts';

describe('the settings kinds this deployment serves', () => {
  it('serves every kind the descriptors name, each by the handler of that kind', () => {
    expect(Object.keys(SETTINGS_HANDLERS).toSorted()).toEqual(
      SETTINGS_KINDS.map((descriptor) => descriptor.kind).toSorted(),
    );
    for (const [kind, handler] of Object.entries(SETTINGS_HANDLERS)) {
      expect(handler.kind).toBe(kind);
    }
  });
});
