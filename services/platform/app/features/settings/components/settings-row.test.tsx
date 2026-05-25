import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { SettingsRow } from './settings-row';

describe('SettingsRow', () => {
  describe('rendering', () => {
    it('renders the label text', () => {
      render(
        <SettingsRow label="Two-factor auth">
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      expect(screen.getByText('Two-factor auth')).toBeInTheDocument();
    });

    it('renders the description when provided', () => {
      render(
        <SettingsRow
          label="Two-factor auth"
          description="Adds a second login step"
        >
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      expect(screen.getByText('Adds a second login step')).toBeInTheDocument();
    });

    it('renders the right-side control', () => {
      render(
        <SettingsRow label="Two-factor auth">
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      expect(
        screen.getByRole('button', { name: 'Enable' }),
      ).toBeInTheDocument();
    });

    it('wires aria-labelledby to the label id', () => {
      const { container } = render(
        <SettingsRow
          label="Two-factor auth"
          description="Adds a second login step"
        >
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      const row = container.firstChild as HTMLElement;
      const labelledBy = row.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const label = document.getElementById(labelledBy ?? '');
      expect(label).toHaveTextContent('Two-factor auth');
    });

    it('wires aria-describedby when description is set', () => {
      const { container } = render(
        <SettingsRow
          label="Two-factor auth"
          description="Adds a second login step"
        >
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      const row = container.firstChild as HTMLElement;
      const describedBy = row.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const description = document.getElementById(describedBy ?? '');
      expect(description).toHaveTextContent('Adds a second login step');
    });

    it('does not set aria-describedby without a description', () => {
      const { container } = render(
        <SettingsRow label="Two-factor auth">
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      const row = container.firstChild as HTMLElement;
      expect(row.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SettingsRow
          label="Two-factor auth"
          description="Adds a second login step"
        >
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
