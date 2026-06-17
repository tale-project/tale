import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SettingsSection } from './settings-section';

describe('SettingsSection', () => {
  describe('rendering', () => {
    it('renders title as h2', () => {
      render(<SettingsSection title="Profile">content</SettingsSection>);
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Profile',
      );
    });

    it('renders description below the title', () => {
      render(
        <SettingsSection title="Profile" description="Your display name">
          content
        </SettingsSection>,
      );
      expect(screen.getByText('Your display name')).toBeInTheDocument();
    });

    it('renders children', () => {
      render(
        <SettingsSection title="Profile">
          <div data-testid="body">body</div>
        </SettingsSection>,
      );
      expect(screen.getByTestId('body')).toBeInTheDocument();
    });

    it('renders the action slot when provided', () => {
      render(
        <SettingsSection
          title="Profile"
          action={<button type="button">Edit</button>}
        >
          content
        </SettingsSection>,
      );
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    it('wires aria-labelledby to the heading id', () => {
      render(
        <SettingsSection title="Profile" description="Display name">
          content
        </SettingsSection>,
      );
      const section = screen.getByRole('region', { name: 'Profile' });
      const heading = screen.getByRole('heading', { level: 2 });
      expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    });

    it('wires aria-describedby when description is set', () => {
      render(
        <SettingsSection title="Profile" description="Your display name">
          content
        </SettingsSection>,
      );
      const section = screen.getByRole('region', { name: 'Profile' });
      const describedBy = section.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const description = document.getElementById(describedBy ?? '');
      expect(description).toHaveTextContent('Your display name');
    });

    it('does not set aria-describedby without a description', () => {
      render(<SettingsSection title="Profile">content</SettingsSection>);
      const section = screen.getByRole('region', { name: 'Profile' });
      expect(section.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with title only', async () => {
      const { container } = render(
        <SettingsSection title="Profile">
          <button type="button">Save</button>
        </SettingsSection>,
      );
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit with description and action', async () => {
      const { container } = render(
        <SettingsSection
          title="Profile"
          description="Your display name"
          action={<button type="button">Edit</button>}
        >
          <button type="button">Save</button>
        </SettingsSection>,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
