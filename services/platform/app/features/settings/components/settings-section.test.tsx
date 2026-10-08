import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SettingsPageTitleProvider } from './settings-page-title';
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

  describe('under a page header that already names it', () => {
    it('keeps the heading for assistive tech but does not print it twice', () => {
      render(
        <SettingsPageTitleProvider value="Teams">
          <SettingsSection title="Teams" description="Organize members">
            <p>Table</p>
          </SettingsSection>
        </SettingsPageTitleProvider>,
      );
      const heading = screen.getByRole('heading', { level: 2, name: 'Teams' });
      // Hidden by CSS only as the page's first section (see the browser run).
      expect(heading.closest('section')).toHaveAttribute(
        'data-repeats-page-title',
      );
      expect(screen.getByText('Organize members')).toBeVisible();
    });

    it('prints a section titled differently from the page', () => {
      render(
        <SettingsPageTitleProvider value="Account">
          <SettingsSection title="Profile">
            <p>Fields</p>
          </SettingsSection>
        </SettingsPageTitleProvider>,
      );
      expect(
        screen
          .getByRole('heading', { level: 2, name: 'Profile' })
          .closest('section'),
      ).not.toHaveAttribute('data-repeats-page-title');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with title only', async () => {
      const { container } = render(
        <SettingsSection title="Profile">
          <button type="button">Save</button>
        </SettingsSection>,
      );
      await checkAccessibility(container);
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
      await checkAccessibility(container);
    });
  });
});
