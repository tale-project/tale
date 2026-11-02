import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { SettingsRow } from './settings-row';

describe('SettingsRow', () => {
  it('names its control as a group by the label and describes it by the help', () => {
    renderApp(
      <SettingsRow label="Theme" description="Light, dark or system.">
        <button type="button">Pick</button>
      </SettingsRow>,
    );

    const row = screen.getByRole('group', { name: 'Theme' });
    expect(row).toHaveAccessibleDescription('Light, dark or system.');
    expect(
      within(row).getByRole('button', { name: 'Pick' }),
    ).toBeInTheDocument();
  });

  it('shows the label before the help, and the help before the control', () => {
    renderApp(
      <SettingsRow label="Theme" description="Light, dark or system.">
        <button type="button">Pick</button>
      </SettingsRow>,
    );
    const row = screen.getByRole('group', { name: 'Theme' });
    const order = [
      within(row).getByText('Theme'),
      within(row).getByText('Light, dark or system.'),
      within(row).getByRole('button', { name: 'Pick' }),
    ];
    for (const [index, element] of order.slice(1).entries()) {
      expect(
        order[index]?.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('needs no help text', () => {
    renderApp(
      <SettingsRow label="Language">
        <button type="button">Pick</button>
      </SettingsRow>,
    );
    expect(screen.getByRole('group', { name: 'Language' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(
      <SettingsRow label="Theme" description="Help">
        <button type="button">Pick</button>
      </SettingsRow>,
    );
    await checkAccessibility(view);
  });
});
