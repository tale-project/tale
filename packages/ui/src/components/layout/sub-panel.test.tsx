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

  it('stands on the sidebar surface the rail shares, not the page', () => {
    render(
      <SubPanel as="nav" ariaLabel="Home" width="list">
        <span>rows</span>
      </SubPanel>,
    );
    const panel = screen.getByRole('navigation', { name: 'Home' });
    expect(panel).toHaveClass('bg-sidebar');
    expect(panel).not.toHaveClass('bg-background');
    // The slot is what the shell and the shared rows key on.
    expect(panel).toHaveAttribute('data-slot', 'sub-panel');
  });

  it('lets a caller give the panel its own surface', () => {
    render(
      <SubPanel as="nav" ariaLabel="Docs" className="bg-muted/20">
        <span>rows</span>
      </SubPanel>,
    );
    const panel = screen.getByRole('navigation', { name: 'Docs' });
    expect(panel).toHaveClass('bg-muted/20');
    expect(panel).not.toHaveClass('bg-sidebar');
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
