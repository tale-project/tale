import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ToggleChipGroup, type ToggleChipOption } from './toggle-chip-group';

const days: ToggleChipOption[] = [
  { value: '1', label: 'Mo', 'aria-label': 'Monday' },
  { value: '2', label: 'Tu', 'aria-label': 'Tuesday' },
  { value: '3', label: 'We', 'aria-label': 'Wednesday' },
];

function Harness({
  initial,
  minSelected,
  onValueChange,
}: {
  initial: string[];
  minSelected?: number;
  onValueChange?: (value: string[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ToggleChipGroup
      aria-label="Days"
      value={value}
      minSelected={minSelected}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      options={days}
    />
  );
}

describe('ToggleChipGroup', () => {
  it('is a named group of pressable chips named by their long names', async () => {
    const { container } = render(<Harness initial={['2']} />);
    expect(screen.getByRole('group', { name: 'Days' })).toBeVisible();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    const tuesday = screen.getByRole('button', { name: 'Tuesday' });
    expect(tuesday).toHaveAttribute('aria-pressed', 'true');
    expect(tuesday).toHaveTextContent('Tu');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await checkAccessibility(container);
  });

  it('toggles several chips on and off', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <Harness initial={[]} onValueChange={onValueChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Monday' }));
    await user.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['1', '3']);
    await user.click(screen.getByRole('button', { name: 'Monday' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['3']);
  });

  it('keeps the last chip on when minSelected would be broken', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <Harness initial={['2']} minSelected={1} onValueChange={onValueChange} />,
    );
    const tuesday = screen.getByRole('button', { name: 'Tuesday' });
    await user.click(tuesday);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(tuesday).toHaveAttribute('aria-pressed', 'true');
  });

  // The minimum only holds chips on: from an empty start every chip can
  // still be turned on, and once the minimum is reached it holds again.
  it('turns chips on from below minSelected, then keeps the minimum', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <Harness initial={[]} minSelected={2} onValueChange={onValueChange} />,
    );
    const monday = screen.getByRole('button', { name: 'Monday' });
    await user.click(monday);
    expect(onValueChange).toHaveBeenLastCalledWith(['1']);
    expect(monday).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Tuesday' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['1', '2']);
    await user.click(monday);
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(monday).toHaveAttribute('aria-pressed', 'true');
  });

  it('is one tab stop with arrow keys between chips and Space to toggle', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <>
        <button type="button">Before</button>
        <Harness initial={['1']} onValueChange={onValueChange} />
        <button type="button">After</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    // Looping: past the last chip comes the first again.
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Wednesday' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onValueChange).toHaveBeenLastCalledWith(['1', '3']);
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('disables every chip', () => {
    render(
      <ToggleChipGroup
        aria-label="Days"
        value={['1']}
        onValueChange={() => {}}
        options={days}
        disabled
      />,
    );
    for (const chip of screen.getAllByRole('button')) {
      expect(chip).toBeDisabled();
    }
  });
});
