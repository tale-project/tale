import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AuthFormLayout } from './auth-form-layout';

describe('AuthFormLayout', () => {
  describe('a picture above the title', () => {
    it('comes before the title, which then breaks inside the column however long it is', () => {
      render(
        <AuthFormLayout
          title={`Connect ${'x'.repeat(80)} to Tale`}
          mark={<div data-testid="mark" />}
        >
          <div>Form content</div>
        </AuthFormLayout>,
      );
      const mark = screen.getByTestId('mark');
      const title = screen.getByRole('heading', { level: 1 });
      expect(
        mark.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(title).toHaveClass('wrap-anywhere');
    });

    it('leaves a title without one as it was', () => {
      render(
        <AuthFormLayout title="Sign In">
          <div>Form content</div>
        </AuthFormLayout>,
      );
      expect(screen.getByRole('heading', { level: 1 })).not.toHaveClass(
        'wrap-anywhere',
      );
    });
  });

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
