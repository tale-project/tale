import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { ToggleChipGroup } from './toggle-chip-group';

const weekdays = [
  { value: '1', label: 'Mo', 'aria-label': 'Monday' },
  { value: '2', label: 'Tu', 'aria-label': 'Tuesday' },
  { value: '3', label: 'We', 'aria-label': 'Wednesday' },
  { value: '4', label: 'Th', 'aria-label': 'Thursday' },
  { value: '5', label: 'Fr', 'aria-label': 'Friday' },
  { value: '6', label: 'Sa', 'aria-label': 'Saturday' },
  { value: '0', label: 'Su', 'aria-label': 'Sunday' },
];

const meta: Meta<typeof ToggleChipGroup> = {
  title: 'Forms/ToggleChipGroup',
  component: ToggleChipGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A row of small toggle buttons for picking several of a few short options —
the days of a weekly repeat.

\`\`\`tsx
import { ToggleChipGroup } from '@tale/ui/toggle-chip-group';

<ToggleChipGroup aria-label="Days" value={days} onValueChange={setDays} options={weekdays} minSelected={1} />
\`\`\`

## Accessibility
- \`role="group"\`, named by \`aria-label\` or \`aria-labelledby\`.
- One tab stop; the arrow keys move between chips, Space or Enter toggles.
- Each chip is a button with \`aria-pressed\`; give abbreviated chips an
  \`aria-label\` that contains the visible text ("Monday" for "Mo").
- \`minSelected\` ignores a toggle-off that would leave too few chips on.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToggleChipGroup>;

function WeekdaysRender({ minSelected }: { minSelected?: number }) {
  const [value, setValue] = useState(['2', '4']);
  return (
    <div className="flex flex-col gap-1.5">
      <span id="on" className="text-muted-foreground text-xs font-medium">
        On
      </span>
      <ToggleChipGroup
        aria-labelledby="on"
        value={value}
        onValueChange={setValue}
        options={weekdays}
        minSelected={minSelected}
      />
    </div>
  );
}

export const Weekdays: Story = {
  render: () => <WeekdaysRender />,
};

export const KeepsOneOn: Story = {
  render: () => <WeekdaysRender minSelected={1} />,
};

export const Disabled: Story = {
  args: {
    'aria-label': 'Days',
    value: ['1'],
    options: weekdays,
    disabled: true,
    onValueChange: () => {},
  },
};
