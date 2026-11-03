import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MenuLabel } from './menu-label';

describe('MenuLabel', () => {
  it('shows the title alone', () => {
    render(<MenuLabel title="Rename" />);
    expect(screen.getByText('Rename')).toBeVisible();
  });

  it('puts a line of explanation under the title, in the same label', () => {
    const { container } = render(
      <MenuLabel
        title="Restart"
        note="Only a running session can be restarted"
      />,
    );

    expect(
      screen.getByText('Only a running session can be restarted'),
    ).toBeVisible();
    // One label for a screen reader: the note is part of the item's name.
    expect(container).toHaveTextContent(
      'RestartOnly a running session can be restarted',
    );
  });
});
