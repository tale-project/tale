import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SubPanel, SubPanelHeader } from './sub-panel';

describe('SubPanel', () => {
  it('draws the section-panel frame at the chosen width', () => {
    render(
      <SubPanel as="nav" ariaLabel="Home" width="list">
        <span>rows</span>
      </SubPanel>,
    );
    const panel = screen.getByRole('navigation', { name: 'Home' });
    expect(panel).toHaveClass('w-70', 'border-r', 'hidden', 'md:flex');
  });

  it('defaults to the narrow width', () => {
    render(
      <SubPanel as="nav" ariaLabel="Settings">
        <span>rows</span>
      </SubPanel>,
    );
    expect(screen.getByRole('navigation', { name: 'Settings' })).toHaveClass(
      'w-56',
    );
  });
});

describe('SubPanelHeader', () => {
  it('names the section in an h-13 row with its actions', () => {
    const { container } = render(
      <SubPanelHeader
        title="Home"
        actions={<button type="button">New chat</button>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Home' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New chat' }),
    ).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('h-13', 'border-b');
  });

  it('passes an axe audit', async () => {
    const { container } = render(<SubPanelHeader title="Settings" />);
    await checkAccessibility(container);
  });
});
