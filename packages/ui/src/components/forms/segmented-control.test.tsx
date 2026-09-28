import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SegmentedControl } from './segmented-control';

const options = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
];

describe('SegmentedControl', () => {
  it('is a radiogroup named by its visible label', () => {
    render(
      <SegmentedControl
        label="View"
        value="list"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeVisible();
  });

  it('takes an aria-label when there is no visible label', async () => {
    const { container } = render(
      <SegmentedControl
        aria-label="Unit"
        value="list"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Unit' })).toBeVisible();
    await checkAccessibility(container);
  });

  it('takes aria-labelledby when there is no visible label', () => {
    render(
      <>
        <span id="heading">Layout</span>
        <SegmentedControl
          aria-labelledby="heading"
          value="list"
          onValueChange={() => {}}
          options={options}
        />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeVisible();
  });

  it('lets a visible label win over aria-label', () => {
    render(
      <SegmentedControl
        label="View"
        aria-label="Ignored"
        value="list"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeVisible();
    expect(
      screen.queryByRole('radiogroup', { name: 'Ignored' }),
    ).not.toBeInTheDocument();
  });

  it('never clears the selection when the active option is pressed again', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <SegmentedControl
        aria-label="View"
        value="list"
        onValueChange={onValueChange}
        options={options}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(onValueChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Board' }));
    expect(onValueChange).toHaveBeenCalledWith('board');
  });
});
