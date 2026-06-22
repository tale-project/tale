import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(
        <SettingsPage>
          <div data-testid="section">Section content</div>
        </SettingsPage>,
      );
      expect(screen.getByTestId('section')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(<SettingsPage className="custom-class" />);
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('claims remaining height when fitToContainer', () => {
      const { container } = render(<SettingsPage fitToContainer />);
      expect(container.firstChild).toHaveClass('min-h-0', 'flex-1');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with section children', async () => {
      const { container } = render(
        <SettingsPage>
          <section aria-label="Profile">
            <h2>Profile</h2>
          </section>
        </SettingsPage>,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
