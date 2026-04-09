import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ConditionalAccessError } from './conditional-access-error';

describe('ConditionalAccessError', () => {
  describe('accessibility', () => {
    it('passes axe audit with MFA error', async () => {
      const { container } = render(
        <ConditionalAccessError
          errorCode="AADSTS50076"
          errorMessage="sso.errors.mfaRequired"
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with blocked error', async () => {
      const { container } = render(
        <ConditionalAccessError
          errorCode="AADSTS53003"
          errorMessage="sso.errors.accessBlocked"
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with generic error and recovery key', async () => {
      const { container } = render(
        <ConditionalAccessError
          errorCode="AADSTS99999"
          errorMessage="sso.errors.generic"
          recoveryKey="sso.errors.genericRecovery"
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with secondary MFA error code', async () => {
      const { container } = render(
        <ConditionalAccessError
          errorCode="AADSTS50079"
          errorMessage="sso.errors.mfaRequired"
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
