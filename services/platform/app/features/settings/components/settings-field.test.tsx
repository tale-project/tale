import { describe, expect, it } from 'vitest';

import { Input } from '@/app/components/ui/forms/input';
import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { SettingsField } from './settings-field';

describe('SettingsField', () => {
  describe('rendering', () => {
    it('renders the label paired with htmlFor', () => {
      render(
        <SettingsField label="Name" htmlFor="name">
          <Input id="name" placeholder="Name" />
        </SettingsField>,
      );
      expect(
        screen.getByLabelText('Name', { exact: false }),
      ).toBeInTheDocument();
    });

    it('renders the description when provided', () => {
      render(
        <SettingsField
          label="Name"
          htmlFor="name"
          description="Your display name"
        >
          <Input id="name" />
        </SettingsField>,
      );
      expect(screen.getByText('Your display name')).toBeInTheDocument();
    });

    it('shows the error message with role=alert', () => {
      render(
        <SettingsField label="Name" htmlFor="name" error="Required field">
          <Input id="name" />
        </SettingsField>,
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Required field');
    });

    it('prefers error message over description when both are set', () => {
      render(
        <SettingsField
          label="Name"
          htmlFor="name"
          description="Your display name"
          error="Required field"
        >
          <Input id="name" />
        </SettingsField>,
      );
      expect(screen.getByText('Required field')).toBeInTheDocument();
      expect(screen.queryByText('Your display name')).toBeNull();
    });

    it('renders without a label when none is provided', () => {
      render(
        <SettingsField htmlFor="name">
          <Input id="name" placeholder="Name" />
        </SettingsField>,
      );
      expect(screen.queryByText('Name')).toBeNull();
      expect(screen.getByPlaceholderText('Name')).toBeInTheDocument();
    });

    it('applies the configured width class', () => {
      const { container } = render(
        <SettingsField label="Name" htmlFor="name" width="full">
          <Input id="name" />
        </SettingsField>,
      );
      expect(container.firstChild).toHaveClass('w-full');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SettingsField
          label="Name"
          htmlFor="name"
          description="Your display name"
        >
          <Input id="name" />
        </SettingsField>,
      );
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit with an error', async () => {
      const { container } = render(
        <SettingsField label="Name" htmlFor="name" error="Required field">
          <Input id="name" />
        </SettingsField>,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
