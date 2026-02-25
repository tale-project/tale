import type { Meta, StoryObj } from '@storybook/react';

import { FileText } from 'lucide-react';

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
};

export default meta;

type Story = StoryObj<typeof SelectableRow>;

export const Default: Story = {
  render: () => (
    <SelectableRow>
      <Text>Unselected row</Text>
    </SelectableRow>
  ),
};

export const Selected: Story = {
  render: () => (
    <SelectableRow selected>
      <Text>Selected row</Text>
    </SelectableRow>
  ),
  parameters: {
    docs: {
      description: {
        story: 'The selected state adds a primary-colored ring around the row.',
      },
    },
  },
};

export const WithContent: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <SelectableRow>
        <FileText
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <Text variant="label" as="span">
            Report Q1 2024
          </Text>
        </div>
        <Badge variant="green">Active</Badge>
      </SelectableRow>
      <SelectableRow selected>
        <FileText
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <Text variant="label" as="span">
            Report Q2 2024
          </Text>
        </div>
        <Badge variant="blue">Draft</Badge>
      </SelectableRow>
      <SelectableRow>
        <FileText
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <Text variant="label" as="span">
            Report Q3 2024
          </Text>
        </div>
        <Badge variant="outline">Archived</Badge>
      </SelectableRow>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Rows with an icon, label, and badge — showing one selected item.',
      },
    },
  },
};
