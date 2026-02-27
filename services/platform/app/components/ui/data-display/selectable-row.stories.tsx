import type { Meta, StoryObj } from '@storybook/react';

import { FileText } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../feedback/badge';
import { Text } from '../typography/text';
import { SelectableRow } from './selectable-row';

const meta: Meta<typeof SelectableRow> = {
  title: 'DataDisplay/SelectableRow',
  component: SelectableRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A button-based row component with a selected state ring highlight, suitable for lists where one item can be chosen.

## Usage
\`\`\`tsx
import { SelectableRow } from '@/app/components/ui/data-display/selectable-row';

<SelectableRow selected={isSelected} onClick={() => setSelected(id)}>
  Content
</SelectableRow>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    selected: { control: 'boolean' },
    disabled: { control: 'boolean' },
    onClick: { action: 'clicked' },
  },
};

export default meta;

type Story = StoryObj<typeof SelectableRow>;

export const Default: Story = {
  args: {
    selected: false,
    children: <Text>Unselected row</Text>,
  },
};

export const Selected: Story = {
  args: {
    selected: true,
    children: <Text>Selected row</Text>,
  },
  parameters: {
    docs: {
      description: {
        story: 'The selected state adds a primary-colored ring around the row.',
      },
    },
  },
};

const items = [
  {
    id: 'q1',
    label: 'Report Q1 2024',
    badge: { variant: 'green' as const, text: 'Active' },
  },
  {
    id: 'q2',
    label: 'Report Q2 2024',
    badge: { variant: 'blue' as const, text: 'Draft' },
  },
  {
    id: 'q3',
    label: 'Report Q3 2024',
    badge: { variant: 'outline' as const, text: 'Archived' },
  },
];

export const Interactive: Story = {
  render: function InteractiveStory() {
    const [selectedId, setSelectedId] = useState('q2');
    return (
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <SelectableRow
            key={item.id}
            selected={selectedId === item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <FileText
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <Text variant="label" as="span">
                {item.label}
              </Text>
            </div>
            <Badge variant={item.badge.variant}>{item.badge.text}</Badge>
          </SelectableRow>
        ))}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Click rows to toggle selection. Demonstrates interactive selection behavior with icons and badges.',
      },
    },
  },
};
