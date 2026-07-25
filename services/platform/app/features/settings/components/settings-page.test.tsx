import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SECTION_DIVIDER_CLASS, SettingsPage } from './settings-page';

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

    // #2567: every settings page shares the agent editor's Tools/Starters
    // `max-w-3xl` width by default, so none regress to a narrower or
    // inconsistent container.
    it('caps content at max-w-3xl by default', () => {
      const { container } = render(<SettingsPage />);
      expect(container.firstChild).toHaveClass('mx-auto', 'max-w-3xl');
    });

    it('drops the max-w-3xl cap when fullWidth', () => {
      const { container } = render(<SettingsPage fullWidth />);
      expect(container.firstChild).not.toHaveClass('mx-auto', 'max-w-3xl');
    });

    // The divider rule is exported so other configuration surfaces (the
    // project overview) reuse the exact same marker-driven selectors instead
    // of hand-rolling `border-t pt-8`. Assert the page still applies what it
    // exports, so the two can never drift apart.
    it('applies the exported section-divider rule', () => {
      const { container } = render(<SettingsPage />);
      expect(SECTION_DIVIDER_CLASS).toContain('data-settings-section');
      expect(container.firstChild).toHaveClass(SECTION_DIVIDER_CLASS);
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
