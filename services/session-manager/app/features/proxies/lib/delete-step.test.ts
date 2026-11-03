import { describe, expect, it } from 'vitest';

import { proxy, sessionRef } from '@/tests/utils/fixtures';

import { deleteStepOf } from './delete-step';

describe('deleteStepOf', () => {
  it('only removes a proxy nobody has', () => {
    expect(deleteStepOf(proxy())).toEqual({ kind: 'plain' });
  });

  it.each(['stopped', 'error'] as const)(
    'asks first when a %s session has it, which gets another proxy later',
    (status) => {
      const session = sessionRef({ status });
      expect(deleteStepOf(proxy({ session }))).toEqual({
        kind: 'in-use',
        session,
      });
    },
  );

  it.each(['running', 'starting', 'stopping'] as const)(
    'refuses while a %s session has it',
    (status) => {
      const session = sessionRef({ status });
      expect(deleteStepOf(proxy({ session }))).toEqual({
        kind: 'busy',
        session,
      });
    },
  );
});
