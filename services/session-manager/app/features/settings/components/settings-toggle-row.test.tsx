import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { SettingsToggleRow } from './settings-toggle-row';

describe('SettingsToggleRow', () => {
  it('names the switch by the label and describes it by the help', () => {
    renderApp(
      <SettingsToggleRow
        label="Allow AI assistants to connect"
        description="Takes effect at once."
        checked={false}
      />,
    );
    const toggle = screen.getByRole('switch', {
      name: 'Allow AI assistants to connect',
    });
    expect(toggle).toHaveAccessibleDescription('Takes effect at once.');
    expect(toggle).not.toBeChecked();
  });

  it('shows the state it is given', () => {
    renderApp(<SettingsToggleRow label="Allow" checked />);
    expect(screen.getByRole('switch', { name: 'Allow' })).toBeChecked();
  });

  it('says what the person asked for, with the mouse and with the keyboard', async () => {
    const onCheckedChange = vi.fn();
    const { user } = renderApp(
      <SettingsToggleRow
        label="Allow"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole('switch', { name: 'Allow' }));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    screen.getByRole('switch', { name: 'Allow' }).focus();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it('shows that it is busy while the change is on its way', () => {
    renderApp(<SettingsToggleRow label="Allow" checked ariaBusy />);
    expect(screen.getByRole('switch', { name: 'Allow' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('can be disabled', () => {
    renderApp(<SettingsToggleRow label="Allow" checked disabled />);
    expect(screen.getByRole('switch', { name: 'Allow' })).toBeDisabled();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(
      <SettingsToggleRow label="Allow" description="Help" checked={false} />,
    );
    await checkAccessibility(view);
  });
});
