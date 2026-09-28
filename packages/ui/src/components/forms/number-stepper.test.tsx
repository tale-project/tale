import { fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { NumberStepper } from './number-stepper';

function Harness({
  initial = 5,
  min = 1,
  max = 31,
  onValueChange,
  onEnter,
}: {
  initial?: number;
  min?: number;
  max?: number;
  onValueChange?: (value: number) => void;
  onEnter?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberStepper
      aria-label="Day"
      value={value}
      min={min}
      max={max}
      onEnter={onEnter}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

describe('NumberStepper', () => {
  it('is a spinbutton carrying its value and bounds', async () => {
    const { container } = render(<Harness />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    expect(field).toHaveValue('5');
    expect(field).toHaveAttribute('aria-valuenow', '5');
    expect(field).toHaveAttribute('aria-valuemin', '1');
    expect(field).toHaveAttribute('aria-valuemax', '31');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    await checkAccessibility(container);
  });

  it('steps with the arrow keys, pages and jumps to the bounds', async () => {
    const { user } = render(<Harness />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    await user.click(field);
    await user.keyboard('{ArrowUp}');
    expect(field).toHaveValue('6');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(field).toHaveValue('4');
    await user.keyboard('{PageUp}');
    expect(field).toHaveValue('14');
    await user.keyboard('{PageUp}{PageUp}');
    expect(field).toHaveValue('31');
    await user.keyboard('{PageDown}');
    expect(field).toHaveValue('21');
    await user.keyboard('{Home}');
    expect(field).toHaveValue('1');
    await user.keyboard('{ArrowDown}');
    expect(field).toHaveValue('1');
    await user.keyboard('{End}');
    expect(field).toHaveValue('31');
  });

  it('commits a typed number in range as it is typed', async () => {
    const onValueChange = vi.fn();
    const { user } = render(<Harness onValueChange={onValueChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    await user.clear(field);
    await user.type(field, '12');
    expect(onValueChange).toHaveBeenLastCalledWith(12);
    expect(field).toHaveAttribute('aria-valuenow', '12');
  });

  it('ignores anything but digits', async () => {
    const { user } = render(<Harness />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    await user.clear(field);
    await user.type(field, '1e-');
    expect(field).toHaveValue('1');
  });

  it('clamps a number out of range on blur', async () => {
    const onValueChange = vi.fn();
    const { user } = render(<Harness onValueChange={onValueChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    await user.clear(field);
    await user.type(field, '45');
    expect(field).toHaveValue('45');
    await user.tab();
    expect(field).toHaveValue('31');
    expect(onValueChange).toHaveBeenLastCalledWith(31);
  });

  it('clamps on Enter, then calls onEnter', async () => {
    const onValueChange = vi.fn();
    const onEnter = vi.fn(() => {
      // onEnter runs after the clamped value was handed over.
      expect(onValueChange).toHaveBeenLastCalledWith(31);
    });
    const { user } = render(
      <Harness onValueChange={onValueChange} onEnter={onEnter} />,
    );
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    await user.clear(field);
    await user.type(field, '99{Enter}');
    expect(field).toHaveValue('31');
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('returns an emptied field to the last value', async () => {
    const onValueChange = vi.fn();
    const { user } = render(<Harness onValueChange={onValueChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    await user.clear(field);
    expect(field).toHaveValue('');
    await user.tab();
    expect(field).toHaveValue('5');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('keeps its buttons out of the tab order and focus in the field', async () => {
    const { user } = render(<Harness initial={2} min={1} max={3} />);
    const field = screen.getByRole('spinbutton', { name: 'Day' });
    const decrease = screen.getByRole('button', { name: 'Decrease' });
    const increase = screen.getByRole('button', { name: 'Increase' });
    expect(decrease).toHaveAttribute('tabindex', '-1');
    expect(increase).toHaveAttribute('aria-controls', field.id);
    await user.click(field);
    // A pointer press on a button does not take focus from the field.
    expect(fireEvent.pointerDown(increase)).toBe(false);
    await user.click(increase);
    expect(field).toHaveValue('3');
    expect(increase).toBeDisabled();
    await user.click(decrease);
    await user.click(decrease);
    expect(field).toHaveValue('1');
    expect(decrease).toBeDisabled();
  });

  it('names its buttons after the caller when asked', () => {
    render(
      <NumberStepper
        aria-label="Interval"
        value={1}
        min={1}
        max={9}
        onValueChange={() => {}}
        decrementLabel="Fewer"
        incrementLabel="More"
      />,
    );
    expect(screen.getByRole('button', { name: 'Fewer' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'More' })).toBeVisible();
  });

  it('disables the field and both buttons', () => {
    render(
      <NumberStepper
        aria-label="Interval"
        value={3}
        min={1}
        max={9}
        onValueChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});
