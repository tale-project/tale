import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import type { HourCycle, TimeOfDay } from '../../lib/time-of-day';
import { InLocale } from '../../storybook/in-locale';
import { TimeField, type TimeFieldProps } from './time-field';

const meta: Meta<typeof TimeField> = {
  title: 'Forms/TimeField',
  component: TimeField,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A time of day as segmented spin buttons, in the reader's hour cycle:
"9:30 AM" in English, "09:30" in German and French.

\`\`\`tsx
import { TimeField } from '@tale/ui/time-field';

<TimeField aria-label="Start" value={{ hour: 9, minute: 30 }} onValueChange={setTime} />
\`\`\`

## Behaviour
- Always holds a valid time: no empty state, nothing to validate.
- Each part is a tab stop. Arrow keys step and wrap, Page Up/Down take steps
  of 6 hours or 15 minutes, Home/End jump to the ends, Left/Right move
  between parts.
- Typing fills a part and moves on once it is complete; Backspace clears it
  while you retype, and leaving it empty brings the time back.
- A whole time pasted anywhere ("17:30", "5:30 pm", "17h30") replaces it.
- The wheel changes nothing.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TimeField>;

function FieldRender({
  initial = { hour: 9, minute: 30 },
  ...rest
}: Partial<Omit<TimeFieldProps, 'value' | 'onValueChange'>> & {
  initial?: TimeOfDay;
  hourCycle?: HourCycle;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      aria-label="Start"
      {...rest}
      value={value}
      onValueChange={setValue}
    />
  );
}

export const TwentyFourHour: Story = {
  render: () => (
    <FieldRender hourCycle={24} initial={{ hour: 17, minute: 30 }} />
  ),
};

export const TwelveHour: Story = {
  render: () => (
    <FieldRender hourCycle={12} initial={{ hour: 17, minute: 30 }} />
  ),
};

export const German: Story = {
  render: () => (
    <InLocale locale="de">
      <FieldRender label="Bis" initial={{ hour: 18, minute: 0 }} />
    </InLocale>
  ),
};

export const WithLabelAndError: Story = {
  render: () => (
    <div className="w-72">
      <FieldRender
        label="Until"
        description="Local time, where the schedule runs."
        errorMessage="Pick a time after the start."
        initial={{ hour: 8, minute: 0 }}
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => <FieldRender disabled />,
};

export const ReadOnly: Story = {
  render: () => <FieldRender readOnly />,
};

export const Small: Story = {
  render: () => <FieldRender size="sm" />,
};
