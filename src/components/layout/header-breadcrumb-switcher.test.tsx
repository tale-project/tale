import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { HeaderBreadcrumbSwitcher } from './header-breadcrumb-switcher';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

function renderSwitcher(
  overrides: Partial<Parameters<typeof HeaderBreadcrumbSwitcher>[0]> = {},
) {
  const onValueChange = vi.fn();
  const utils = render(
    <HeaderBreadcrumbSwitcher
      value="a"
      options={OPTIONS}
      displayName="Alpha"
      title="Switch thing"
      searchPlaceholder="Search things"
      emptyText="No things found"
      ariaLabel="Switch thing, current: Alpha"
      onValueChange={onValueChange}
      {...overrides}
    />,
  );
  return { onValueChange, ...utils };
}

describe('HeaderBreadcrumbSwitcher', () => {
  it('opens a titled, searchable menu of siblings from the trigger', async () => {
    const { user } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: 'Switch thing, current: Alpha' }),
    );

    expect(screen.getByText('Switch thing')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
  });

  it('reports the picked sibling', async () => {
    const { user, onValueChange } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /switch thing/i }));
    await user.click(screen.getByRole('option', { name: 'Beta' }));

    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('does not report re-picking the current entity', async () => {
    const { user, onValueChange } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /switch thing/i }));
    await user.click(screen.getByRole('option', { name: 'Alpha' }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('renders the plain name while there is nothing to switch to', () => {
    renderSwitcher({ options: [] });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('passes an axe audit with the menu open', async () => {
    const { user, container } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /switch thing/i }));

    await checkAccessibility(container);
  });
});
