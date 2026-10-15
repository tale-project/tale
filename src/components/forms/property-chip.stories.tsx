import type { Meta, StoryObj } from '@storybook/react';
import {
  CalendarDays,
  CircleDot,
  Repeat,
  SignalMedium,
  Tag,
  User,
} from 'lucide-react';

import { Popover } from '../overlays/popover';
import { PropertyChip } from './property-chip';

const meta: Meta<typeof PropertyChip> = {
  title: 'Forms/PropertyChip',
  component: PropertyChip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A property as a pill: the glyph and value of one field in a row of chips under a form, each the trigger of the picker that changes it. An unset property shows its name, muted, after a plus.

## Usage
\`\`\`tsx
import { PropertyChip } from '@tale/ui/property-chip';

<Popover trigger={<PropertyChip icon={<CalendarDays />}>Today</PropertyChip>}>
  {calendar}
</Popover>
<PropertyChip empty>Due date</PropertyChip>
\`\`\`

## Accessibility
- A real \`button\`, 32px tall, with a visible focus ring; it forwards its ref and props, so a picker's trigger supplies \`aria-expanded\` and \`aria-haspopup\`
- The glyph is decorative: the chip is named by its text, so give a value that does not say which property it is an \`aria-label\` that starts with the value ("Medium priority")
- \`data-state="open"\` from the picker keeps the chip filled while its popover is open
        `,
      },
    },
  },
  args: {
    children: 'Today',
    icon: <CalendarDays />,
  },
};

export default meta;
type Story = StoryObj<typeof PropertyChip>;

export const Default: Story = {};

export const Empty: Story = {
  args: { empty: true, children: 'Due date' },
};

export const Row: Story = {
  render: () => (
    <div className="flex max-w-xl flex-wrap gap-2">
      <PropertyChip icon={<CircleDot />}>To do</PropertyChip>
      <PropertyChip icon={<SignalMedium />} aria-label="Medium priority">
        Medium
      </PropertyChip>
      <PropertyChip icon={<User />}>Ada Lovelace</PropertyChip>
      <PropertyChip icon={<CalendarDays />} aria-label="Today, start date">
        Today
      </PropertyChip>
      <PropertyChip empty>Due date</PropertyChip>
      <PropertyChip empty icon={<Repeat />}>
        Repeat
      </PropertyChip>
      <PropertyChip empty icon={<Tag />}>
        Labels
      </PropertyChip>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The create-task chip row: set properties show their glyph and value, unset ones their name after a plus. The row wraps in a narrow column.',
      },
    },
  },
};

export const AsPickerTrigger: Story = {
  render: () => (
    <Popover
      aria-label="Due date"
      trigger={
        <PropertyChip icon={<CalendarDays />} aria-label="Oct 12, due date">
          Oct 12
        </PropertyChip>
      }
    >
      <p className="text-sm">A calendar would open here.</p>
    </Popover>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};
