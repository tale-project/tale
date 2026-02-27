import type { Meta, StoryObj } from '@storybook/react';

import { Badge } from '../feedback/badge';
import { Text } from '../typography/text';
import { StatGrid } from './stat-grid';

const meta: Meta<typeof StatGrid> = {
  title: 'DataDisplay/StatGrid',
  component: StatGrid,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A data-driven grid for displaying labeled statistics. Renders as a semantic \`<dl>\` element.

## Usage
\`\`\`tsx
import { StatGrid } from '@/app/components/ui/data-display/stat-grid';

<StatGrid
  items={[
    { label: 'Revenue', value: <Text>$12,400</Text> },
    { label: 'Orders', value: <Text>342</Text> },
  ]}
/>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof StatGrid>;

export const Default: Story = {
  args: {
    items: [
      { label: 'Conversations', value: <Text>342</Text> },
      { label: 'Open tickets', value: <Text>17</Text> },
      { label: 'Resolved', value: <Text>325</Text> },
      { label: 'Avg. response time', value: <Text>4m 12s</Text> },
    ],
  },
};

export const ThreeColumns: Story = {
  args: {
    cols: 3,
    items: [
      { label: 'Revenue', value: <Text>$12,400</Text> },
      { label: 'Orders', value: <Text>342</Text> },
      { label: 'Customers', value: <Text>1,284</Text> },
      { label: 'Avg. order value', value: <Text>$36.26</Text> },
      { label: 'Return rate', value: <Text>2.4%</Text> },
      { label: 'CSAT score', value: <Text>96%</Text> },
    ],
  },
};

export const WithBadges: Story = {
  args: {
    items: [
      {
        label: 'Status',
        value: (
          <Badge variant="green" dot>
            Active
          </Badge>
        ),
      },
      { label: 'Plan', value: <Badge variant="blue">Pro</Badge> },
      { label: 'Region', value: <Text>US West</Text> },
      { label: 'Uptime', value: <Text>99.9%</Text> },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Items can contain any ReactNode as their value, including badges.',
      },
    },
  },
};

export const WithColSpan: Story = {
  args: {
    items: [
      { label: 'Domain', value: <Text>example.com</Text> },
      {
        label: 'Status',
        value: (
          <Badge variant="green" dot>
            Active
          </Badge>
        ),
      },
      {
        label: 'Description',
        value: (
          <Text>
            A full-width stat item that spans both columns in the grid.
          </Text>
        ),
        colSpan: 2,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Use `colSpan: 2` on an item to span the full width of a 2-column grid.',
      },
    },
  },
};
