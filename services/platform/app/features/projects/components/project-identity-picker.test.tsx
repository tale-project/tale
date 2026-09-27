import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import {
  ProjectIdentityPicker,
  type ProjectIdentityValue,
} from './project-identity-picker';

// Both grids are radio groups over the server's allowlists: one tab stop
// each, the arrows move focus AND selection like native radios, and the
// trigger's avatar previews the pair live.

function Harness({ initial }: { initial: ProjectIdentityValue }) {
  const [value, setValue] = useState(initial);
  return (
    <ProjectIdentityPicker name="Launch" value={value} onChange={setValue} />
  );
}

describe('ProjectIdentityPicker', () => {
  it('opens a named popover with a color and an icon radio group, axe-clean', async () => {
    const { user, baseElement } = render(
      <Harness initial={{ icon: null, color: null }} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Change icon and color/ }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Icon and color' }),
    ).toBeInTheDocument();
    const colors = screen.getByRole('radiogroup', { name: 'Color' });
    const icons = screen.getByRole('radiogroup', { name: 'Icon' });
    // The default pair reads as Gray + Folder — what `ProjectAvatar` draws
    // for `null`.
    expect(within(colors).getByRole('radio', { name: 'Gray' })).toBeChecked();
    expect(within(icons).getByRole('radio', { name: 'Folder' })).toBeChecked();
    expect(within(colors).getAllByRole('radio')).toHaveLength(19);
    expect(within(icons).getAllByRole('radio')).toHaveLength(30);
    await checkAccessibility(baseElement);
  });

  it('moves selection with the arrow keys from one tab stop per group', async () => {
    const { user } = render(
      <Harness initial={{ icon: 'Rocket', color: 'blue' }} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Change icon and color/ }),
    );
    const colors = await screen.findByRole('radiogroup', { name: 'Color' });
    const blue = within(colors).getByRole('radio', { name: 'Blue' });
    expect(blue).toHaveAttribute('tabindex', '0');
    expect(within(colors).getByRole('radio', { name: 'Red' })).toHaveAttribute(
      'tabindex',
      '-1',
    );

    blue.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(colors).getByRole('radio', { name: 'Indigo' })).toBeChecked();
    expect(within(colors).getByRole('radio', { name: 'Indigo' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(within(colors).getByRole('radio', { name: 'Gray' })).toBeChecked();

    const icons = screen.getByRole('radiogroup', { name: 'Icon' });
    within(icons).getByRole('radio', { name: 'Rocket' }).focus();
    await user.keyboard('{ArrowDown}');
    // One row down in the 8-wide grid: Rocket (index 12) → Microscope (20).
    expect(
      within(icons).getByRole('radio', { name: 'Microscope' }),
    ).toBeChecked();
  });
});
