import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { HourCycle, TimeOfDay } from '../../lib/time-of-day';
import { TimeField, type TimeFieldProps } from './time-field';

function Harness({
  initial = { hour: 9, minute: 30 },
  hourCycle = 24,
  onValueChange,
  ...rest
}: Partial<Omit<TimeFieldProps, 'value' | 'onValueChange'>> & {
  initial?: TimeOfDay;
  hourCycle?: HourCycle;
  onValueChange?: (value: TimeOfDay) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TimeField
        aria-label="Start"
        hourCycle={hourCycle}
        {...rest}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange?.(next);
        }}
      />
      <output data-testid="value">
        {`${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`}
      </output>
    </>
  );
}

function parts() {
  const group = screen.getByRole('group', { name: 'Start' });
  return {
    group,
    hour: within(group).getByRole('spinbutton', { name: 'Hours' }),
    minute: within(group).getByRole('spinbutton', { name: 'Minutes' }),
    period: within(group).queryByRole('spinbutton', { name: 'AM/PM' }),
  };
}

const shown = () => screen.getByTestId('value').textContent;

describe('TimeField', () => {
  describe('a 24-hour clock', () => {
    it('is a named group of an hour and a minute spin button', async () => {
      const { container } = render(<Harness />);
      const { group, hour, minute, period } = parts();
      expect(group).toHaveAccessibleDescription('09:30');
      expect(hour).toHaveValue('09');
      expect(hour).toHaveAttribute('aria-valuenow', '9');
      expect(hour).toHaveAttribute('aria-valuemin', '0');
      expect(hour).toHaveAttribute('aria-valuemax', '23');
      expect(hour).toHaveAttribute('inputmode', 'numeric');
      expect(minute).toHaveValue('30');
      expect(minute).toHaveAttribute('aria-valuetext', '30 minutes');
      expect(period).toBeNull();
      await checkAccessibility(container);
    });

    it('wraps the hour and the minute with the arrows, without carrying', async () => {
      const { user } = render(<Harness initial={{ hour: 23, minute: 59 }} />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('{ArrowUp}');
      expect(shown()).toBe('00:59');
      await user.keyboard('{ArrowDown}');
      expect(shown()).toBe('23:59');
      await user.click(minute);
      await user.keyboard('{ArrowUp}');
      expect(shown()).toBe('23:00');
      await user.keyboard('{ArrowDown}');
      expect(shown()).toBe('23:59');
    });

    it('takes bigger steps with Page Up/Down and jumps to the ends with Home/End', async () => {
      const { user } = render(<Harness initial={{ hour: 9, minute: 30 }} />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('{PageUp}');
      expect(shown()).toBe('15:30');
      await user.keyboard('{PageUp}{PageUp}');
      expect(shown()).toBe('03:30');
      await user.keyboard('{End}');
      expect(shown()).toBe('23:30');
      await user.keyboard('{Home}');
      expect(shown()).toBe('00:30');
      await user.click(minute);
      await user.keyboard('{PageDown}');
      expect(shown()).toBe('00:15');
      await user.keyboard('{PageDown}{PageDown}');
      expect(shown()).toBe('00:45');
      await user.keyboard('{End}');
      expect(shown()).toBe('00:59');
    });

    it('steps the minutes by the step the host sets', async () => {
      const { user } = render(
        <Harness initial={{ hour: 9, minute: 55 }} minuteStep={15} />,
      );
      await user.click(parts().minute);
      await user.keyboard('{ArrowUp}');
      expect(shown()).toBe('09:10');
    });

    it('commits a digit that cannot start a longer hour and moves on', async () => {
      const onValueChange = vi.fn();
      const { user } = render(<Harness onValueChange={onValueChange} />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('7');
      expect(shown()).toBe('07:30');
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(minute).toHaveFocus();
    });

    it('waits for a second digit after 0, 1 or 2', async () => {
      const onValueChange = vi.fn();
      const { user } = render(<Harness onValueChange={onValueChange} />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('2');
      expect(hour).toHaveValue('02');
      expect(onValueChange).not.toHaveBeenCalled();
      expect(hour).toHaveFocus();
      await user.keyboard('3');
      expect(shown()).toBe('23:30');
      expect(minute).toHaveFocus();
      expect(onValueChange).toHaveBeenCalledTimes(1);
    });

    it('starts over when the second digit would leave the day', async () => {
      const { user } = render(<Harness />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('25');
      // 25 is no hour: 5 stands alone.
      expect(shown()).toBe('05:30');
      expect(minute).toHaveFocus();
    });

    it('types the minutes the same way, and stays on the last part', async () => {
      const { user } = render(<Harness />);
      const { minute } = parts();
      await user.click(minute);
      await user.keyboard('4');
      expect(minute).toHaveValue('04');
      await user.keyboard('5');
      expect(shown()).toBe('09:45');
      expect(minute).toHaveFocus();
      await user.keyboard('7');
      expect(shown()).toBe('09:07');
    });

    it('commits a part typed halfway when focus leaves it', async () => {
      const { user } = render(
        <>
          <Harness />
          <button type="button">After</button>
        </>,
      );
      const { hour } = parts();
      await user.click(hour);
      await user.keyboard('1');
      expect(shown()).toBe('09:30');
      await user.click(screen.getByRole('button', { name: 'After' }));
      expect(shown()).toBe('01:30');
    });

    it('clears a part with Backspace and brings the time back when left empty', async () => {
      const onValueChange = vi.fn();
      const { user } = render(<Harness onValueChange={onValueChange} />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('{Backspace}');
      expect(hour).toHaveValue('––');
      expect(hour).toHaveAttribute('aria-valuetext', 'Empty');
      await user.keyboard('{ArrowRight}');
      expect(minute).toHaveFocus();
      expect(hour).toHaveValue('09');
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('jumps from the hour to the minutes on a separator', async () => {
      const { user } = render(<Harness />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('1:');
      expect(shown()).toBe('01:30');
      expect(minute).toHaveFocus();
    });

    it('moves between parts with Left and Right, and stops at the ends', async () => {
      const { user } = render(<Harness />);
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('{ArrowLeft}');
      expect(hour).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(minute).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(minute).toHaveFocus();
    });

    it('is one tab stop per part', async () => {
      const { user } = render(
        <>
          <button type="button">Before</button>
          <Harness />
        </>,
      );
      screen.getByRole('button', { name: 'Before' }).focus();
      await user.tab();
      expect(parts().hour).toHaveFocus();
      await user.tab();
      expect(parts().minute).toHaveFocus();
    });

    it('commits, then hands Enter to the host', async () => {
      const onEnter = vi.fn();
      const { user } = render(<Harness onEnter={onEnter} />);
      await user.click(parts().hour);
      await user.keyboard('1{Enter}');
      expect(shown()).toBe('01:30');
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    it('does not emit a time that did not change', async () => {
      const onValueChange = vi.fn();
      const { user } = render(<Harness onValueChange={onValueChange} />);
      await user.click(parts().hour);
      await user.keyboard('09');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('a 12-hour clock', () => {
    it('shows the hour 1–12 and a day period it speaks as words', async () => {
      const { container } = render(
        <Harness hourCycle={12} initial={{ hour: 21, minute: 5 }} />,
      );
      const { group, hour, minute, period } = parts();
      expect(group).toHaveAccessibleDescription(/^9:05\sPM$/);
      expect(hour).toHaveValue('9');
      expect(hour).toHaveAttribute('aria-valuenow', '9');
      expect(hour).toHaveAttribute('aria-valuemin', '1');
      expect(hour).toHaveAttribute('aria-valuemax', '12');
      expect(hour.getAttribute('aria-valuetext')?.replace(/\s/g, ' ')).toBe(
        '9 PM',
      );
      expect(minute).toHaveValue('05');
      expect(period).toHaveValue('PM');
      expect(period).toHaveAttribute('aria-valuetext', 'PM');
      expect(period).toHaveAttribute('inputmode', 'none');
      await checkAccessibility(container);
    });

    it('cycles the hour within its half of the day', async () => {
      const { user } = render(
        <Harness hourCycle={12} initial={{ hour: 11, minute: 0 }} />,
      );
      await user.click(parts().hour);
      await user.keyboard('{ArrowUp}');
      expect(shown()).toBe('00:00');
      await user.keyboard('{ArrowUp}');
      expect(shown()).toBe('01:00');
      await user.keyboard('{Home}');
      expect(shown()).toBe('00:00');
      await user.keyboard('{End}');
      expect(shown()).toBe('11:00');
    });

    it('types 10–12 after a 1 and keeps the day period', async () => {
      const { user } = render(
        <Harness hourCycle={12} initial={{ hour: 15, minute: 0 }} />,
      );
      const { hour, minute } = parts();
      await user.click(hour);
      await user.keyboard('1');
      expect(hour).toHaveValue('1');
      await user.keyboard('2');
      expect(shown()).toBe('12:00');
      expect(minute).toHaveFocus();
      await user.click(hour);
      await user.keyboard('7');
      expect(shown()).toBe('19:00');
    });

    it('refuses 00 as an hour', async () => {
      const { user } = render(<Harness hourCycle={12} />);
      const { hour } = parts();
      await user.click(hour);
      await user.keyboard('00');
      expect(hour).toHaveValue('0');
      await user.keyboard('{Enter}');
      expect(shown()).toBe('09:30');
    });

    it('moves on from the minutes to the day period', async () => {
      const { user } = render(<Harness hourCycle={12} />);
      const { minute, period } = parts();
      await user.click(minute);
      await user.keyboard('45');
      expect(period).toHaveFocus();
    });

    it('toggles the day period with the arrows, A and P', async () => {
      const { user } = render(<Harness hourCycle={12} />);
      const { period } = parts();
      await user.click(period as HTMLElement);
      await user.keyboard('{ArrowUp}');
      expect(shown()).toBe('21:30');
      await user.keyboard('a');
      expect(shown()).toBe('09:30');
      await user.keyboard('p');
      expect(shown()).toBe('21:30');
      await user.keyboard('{Home}');
      expect(shown()).toBe('09:30');
      await user.keyboard('{End}');
      expect(shown()).toBe('21:30');
    });

    it('flips the day period on a tap once it has focus', async () => {
      const { user } = render(<Harness hourCycle={12} />);
      const period = parts().period as HTMLElement;
      await user.click(period);
      expect(shown()).toBe('09:30');
      await user.click(period);
      expect(shown()).toBe('21:30');
    });
  });

  describe('pasting', () => {
    it('replaces the whole time from any part', async () => {
      const onValueChange = vi.fn();
      const { user } = render(<Harness onValueChange={onValueChange} />);
      const { minute } = parts();
      await user.click(minute);
      await user.paste('5:45 pm');
      expect(shown()).toBe('17:45');
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(minute).toHaveFocus();
    });

    it('keeps the time and says why when the text is not a time', async () => {
      const onValueChange = vi.fn();
      const { user } = render(<Harness onValueChange={onValueChange} />);
      await user.click(parts().hour);
      await user.paste('lunch');
      expect(shown()).toBe('09:30');
      expect(onValueChange).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(within(parts().group).getByRole('status')).toHaveTextContent(
          "That isn't a time. Paste one like 09:30.",
        ),
      );
    });
  });

  describe('states', () => {
    it('labels the group and the description and error the host gives', async () => {
      const { container, user } = render(
        <TimeField
          label="Until"
          description="Local time."
          errorMessage="Pick a later time."
          hourCycle={24}
          value={{ hour: 18, minute: 0 }}
          onValueChange={() => {}}
        />,
      );
      const group = screen.getByRole('group', { name: 'Until' });
      expect(group).toHaveAccessibleDescription(
        'Local time. Pick a later time. 18:00',
      );
      const hour = within(group).getByRole('spinbutton', { name: 'Hours' });
      expect(hour).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent('Pick a later time.');
      // The label focuses the first part.
      await user.click(screen.getByText('Until'));
      expect(hour).toHaveFocus();
      await checkAccessibility(container);
    });

    it('keeps focus and a half-typed part when an error comes and goes', async () => {
      const { user, rerender } = render(<Harness />);
      const { group, minute } = parts();
      await user.click(minute);
      // 4 waits for a second digit while the host shows its error.
      await user.keyboard('4');
      rerender(<Harness errorMessage="Pick 10:00 or later." />);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Pick 10:00 or later.',
      );
      expect(screen.getByRole('group', { name: 'Start' })).toBe(group);
      expect(minute).toHaveFocus();
      expect(minute).toHaveValue('04');
      rerender(<Harness />);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(minute).toHaveFocus();
      await user.keyboard('5');
      expect(minute).toHaveValue('45');
      expect(shown()).toBe('09:45');
    });

    it('reads but never changes while read-only', async () => {
      const onValueChange = vi.fn();
      const { user } = render(
        <Harness readOnly onValueChange={onValueChange} />,
      );
      const { hour } = parts();
      await user.click(hour);
      expect(hour).toHaveFocus();
      await user.keyboard('{ArrowUp}7{Backspace}');
      await user.paste('12:00');
      expect(shown()).toBe('09:30');
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('leaves the tab order while disabled', async () => {
      const { user } = render(
        <>
          <Harness disabled />
          <button type="button">After</button>
        </>,
      );
      const { hour, minute } = parts();
      expect(hour).toBeDisabled();
      expect(minute).toBeDisabled();
      await user.tab();
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });

    it('focuses the nearest part on a press on its padding', async () => {
      const { user } = render(<Harness />);
      const { group, hour } = parts();
      await user.pointer({ keys: '[MouseLeft]', target: group });
      expect(hour).toHaveFocus();
    });
  });
});
