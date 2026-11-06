import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { NumberStepper } from './number-stepper';

const meta: Meta<typeof NumberStepper> = {
  title: 'Forms/NumberStepper',
  component: NumberStepper,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A small whole number with − and + on either side, for a count inside a
sentence ("Every [− 2 +] weeks").

\`\`\`tsx
import { NumberStepper } from '@tale/ui/number-stepper';

<NumberStepper aria-label="Interval" value={value} min={1} max={99} onValueChange={setValue} />
\`\`\`

## Behaviour
- A text field with \`role="spinbutton"\`: no native spinner, no "e", no
  change on a wheel scroll.
- Arrow keys step, Page Up/Down take steps of 10, Home/End jump to the bounds.
- Typing keeps digits; out-of-range numbers clamp on blur or Enter, and an
  emptied field returns to the last value.
- The − and + buttons are out of the tab order and disabled at the bounds.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof NumberStepper>;

function IntervalRender() {
  const [value, setValue] = useState(2);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span id="every">Every</span>
      <NumberStepper
        id="interval"
        aria-labelledby="every interval weeks"
        value={value}
        min={1}
        max={99}
        onValueChange={setValue}
      />
      <span id="weeks">{value === 1 ? 'week' : 'weeks'}</span>
    </div>
  );
}

export const InASentence: Story = {
  render: () => <IntervalRender />,
};

function BoundsRender() {
  const [value, setValue] = useState(31);
  return (
    <NumberStepper
      aria-label="Day of the month"
      value={value}
      min={1}
      max={31}
      onValueChange={setValue}
    />
  );
}

export const AtTheUpperBound: Story = {
  render: () => <BoundsRender />,
};

export const Disabled: Story = {
  args: {
    'aria-label': 'Interval',
    value: 3,
    min: 1,
    max: 99,
    disabled: true,
    onValueChange: () => {},
  },
};
