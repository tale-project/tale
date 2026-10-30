import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Inbox,
  Layers,
  ListChecks,
  MessageCircle,
  Workflow,
} from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { TooltipProvider } from '../overlays/tooltip';
import { SegmentedControl } from './segmented-control';

const meta: Meta<typeof SegmentedControl> = {
  title: 'Forms/SegmentedControl',
  component: SegmentedControl,
  tags: ['autodocs'],
  // An icon-led control names its icons in tooltips.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
One choice among a few, as a row of segments: a radio group with one Tab stop,
the arrow keys, Home and End moving the choice.

## Usage
\`\`\`tsx
import { SegmentedControl } from '@tale/ui/segmented-control';

<SegmentedControl
  aria-label="Layout"
  value={layout}
  onValueChange={setLayout}
  options={[
    { value: 'list', label: 'List' },
    { value: 'board', label: 'Board' },
  ]}
/>
\`\`\`

## Icon-led
With an \`icon\` per option and \`labels="selected"\`, only the chosen option
shows its label beside its icon; the others are their icon alone, named by
their label and shown it in a tooltip on hover. A highlight glides to the
chosen option while its label opens. When even the chosen label has no room,
it folds to its icon too — never cut short. \`attention\` puts a quiet dot on
an option and reads its sentence after the label.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

function Controlled(
  props: Omit<ComponentProps<typeof SegmentedControl>, 'onValueChange'>,
) {
  const [value, setValue] = useState(props.value);
  return <SegmentedControl {...props} value={value} onValueChange={setValue} />;
}

export const Default: Story = {
  render: () => (
    <Controlled
      aria-label="Layout"
      value="list"
      options={[
        { value: 'list', label: 'List' },
        { value: 'board', label: 'Board' },
        { value: 'calendar', label: 'Calendar' },
      ]}
    />
  ),
};

const VIEWS = [
  { value: 'all', label: 'All', icon: Layers },
  {
    value: 'chats',
    label: 'Chats',
    icon: MessageCircle,
    attention: '2 items need you',
  },
  { value: 'tasks', label: 'Tasks', icon: ListChecks },
  { value: 'inbox', label: 'Inbox', icon: Inbox },
];

export const IconLed: Story = {
  render: () => (
    <div className="w-56">
      <Controlled
        aria-label="Show"
        labels="selected"
        value="all"
        options={VIEWS}
      />
    </div>
  ),
};

/** A fifth option with a long label in a narrow column: the chosen label
 * folds to its icon rather than being cut. */
export const IconLedNarrow: Story = {
  render: () => (
    <div className="w-44">
      <Controlled
        aria-label="Anzeigen"
        labels="selected"
        value="automations"
        options={[
          ...VIEWS,
          { value: 'automations', label: 'Automatisierungen', icon: Workflow },
        ]}
      />
    </div>
  ),
};
