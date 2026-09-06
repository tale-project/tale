import { expectTypeOf, it } from 'vitest';

import type { PolicyType } from '@/lib/shared/schemas/governance';

import type { ArgsOf } from './index';

// Compile-time pin: the policy type the app can ask the backend for IS the
// one list in `lib/shared/schemas/governance.ts`. The three hand-kept copies
// this replaced drifted (`approval_policy` was readable by the backend and
// unreadable through the contract); a second copy here would drift again.
it('types getPolicy by the one POLICY_TYPES list', () => {
  expectTypeOf<
    ArgsOf<'governance/queries:getPolicy'>['policyType']
  >().toEqualTypeOf<PolicyType>();
});
