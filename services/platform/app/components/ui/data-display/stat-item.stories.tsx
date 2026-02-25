import type { Meta, StoryObj } from '@storybook/react';

import { Badge } from '../feedback/badge';
import { Text } from '../typography/text';
import { StatItem } from './stat-item';

const meta: Meta<typeof StatItem> = {
  title: 'DataDisplay/StatItem',
  component: StatItem,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A labeled statistic display with a caption label above and freeform children as the value.

## Usage
\`\`\`tsx
import { StatItem } from '@/app/components/ui/data-display/stat-item';

<StatItem label="Total messages">
  <Text>1,284</Text>
</StatItem>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof StatItem>;

export const Default: Story = {
  render: () => (
    <StatItem label="Total messages">
      <Text>1,284</Text>
    </StatItem>
  ),
};

export const WithBadge: Story = {
  render: () => (
    <StatItem label="Status">
      <Badge variant="green" dot>
        Active
      </Badge>
    </StatItem>
  ),
  parameters: {
    docs: {
      description: {
        story: 'A stat item whose value is a badge rather than plain text.',
      },
    },
  },
};

export const InGrid: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-6">
      <StatItem label="Conversations">
        <Text>342</Text>
      </StatItem>
      <StatItem label="Open tickets">
        <Text>17</Text>
      </StatItem>
      <StatItem label="Resolved">
        <Text>325</Text>
      </StatItem>
      <StatItem label="Avg. response time">
        <Text>4m 12s</Text>
      </StatItem>
      <StatItem label="CSAT score">
        <Text>96%</Text>
      </StatItem>
      <StatItem label="Plan">
        <Badge variant="blue">Pro</Badge>
      </StatItem>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Multiple stat items arranged in a grid, typical for dashboards.',
      },
    },
  },
};
