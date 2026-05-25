import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  describe('rendering', () => {
    it('renders title as h1', () => {
      render(<SettingsPage title="Account" />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Account',
      );
    });

    it('renders description when provided', () => {
      render(
        <SettingsPage title="Account" description="Manage your account" />,
      );
      expect(screen.getByText('Manage your account')).toBeInTheDocument();
    });

    it('does not render description block when omitted', () => {
      render(<SettingsPage title="Account" />);
      expect(screen.queryByText('Manage your account')).toBeNull();
    });

    it('renders headerAction in the page header', () => {
      render(
        <SettingsPage
          title="Account"
          headerAction={<button type="button">Export</button>}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Export' }),
      ).toBeInTheDocument();
    });

    it('renders children below the header', () => {
      render(
        <SettingsPage title="Account">
          <div data-testid="section">Section content</div>
        </SettingsPage>,
      );
      expect(screen.getByTestId('section')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <SettingsPage title="Account" className="custom-class" />,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with title only', async () => {
      const { container } = render(<SettingsPage title="Account" />);
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit with description and header action', async () => {
      const { container } = render(
        <SettingsPage
          title="Account"
          description="Manage your account preferences"
          headerAction={<button type="button">Export</button>}
        >
          <section aria-label="Profile">
            <h2>Profile</h2>
          </section>
        </SettingsPage>,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
