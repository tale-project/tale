import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { AuthFormLayout } from './auth-form-layout';

describe('AuthFormLayout', () => {
  describe('accessibility', () => {
    it('passes axe audit with title and children', async () => {
      const { container } = render(
        <AuthFormLayout title="Sign In">
          <form>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" />
          </form>
        </AuthFormLayout>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with empty children', async () => {
      const { container } = render(
        <AuthFormLayout title="Create Account">
          <div>Form content goes here</div>
        </AuthFormLayout>,
      );
      await checkAccessibility(container);
    });
  });
});
