import { FIELD_ROW_FRAME } from '@tale/ui/field-shell';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

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

    // The wrapper is a plain div, whose name and description assistive tech
    // ignores — so the row hands its ids to a control that asks for them.
    it('hands its label and description ids to a control rendered as a function', () => {
      render(
        <SettingsRow
          label="Two-factor auth"
          description="Adds a second login step"
        >
          {({ labelId, descriptionId }) => (
            <button
              type="button"
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
            />
          )}
        </SettingsRow>,
      );
      const control = screen.getByRole('button', { name: 'Two-factor auth' });
      expect(control).toHaveAccessibleDescription('Adds a second login step');
    });

    it('hands no description id when the row has no description', () => {
      render(
        <SettingsRow label="Two-factor auth">
          {({ labelId, descriptionId }) => (
            <button
              type="button"
              aria-labelledby={labelId}
              data-description-id={descriptionId ?? 'none'}
            />
          )}
        </SettingsRow>,
      );
      expect(
        screen.getByRole('button', { name: 'Two-factor auth' }),
      ).toHaveAttribute('data-description-id', 'none');
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

    it('turns into a row on the settings surface’s width, not the viewport’s', () => {
      const { container } = render(
        <SettingsRow label="Two-factor auth">
          <button type="button">Enable</button>
        </SettingsRow>,
      );
      const row = container.firstChild as HTMLElement;
      // The same turn every field row takes (`FieldShell`): measured on the
      // `data-field-layout="row"` container, so a settings column squeezed
      // beside the rail and the settings panel stacks instead.
      expect(row.className).toContain(FIELD_ROW_FRAME);
      expect(row.className).not.toContain('sm:flex-row');
    });

    it('omits horizontal row classes when layout is stack', () => {
      const { container } = render(
        <SettingsRow layout="stack" label="Description">
          <button type="button">Edit</button>
        </SettingsRow>,
      );
      const row = container.firstChild as HTMLElement;
      expect(row.className).toContain('flex-col');
      expect(row.className).not.toContain('flex-row');
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
