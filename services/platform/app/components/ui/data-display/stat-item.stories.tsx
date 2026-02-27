import type { Meta, StoryObj } from '@storybook/react';

import { Badge } from '../feedback/badge';
import { Text } from '../typography/text';
import { StatGrid } from './stat-grid';
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
Uses semantic \`<dt>\`/\`<dd>\` elements — used internally by \`<StatGrid>\`.

## Usage

Prefer using \`StatGrid\` with its data-driven \`items\` prop:
\`\`\`tsx
import { StatGrid } from '@/app/components/ui/data-display/stat-grid';

<StatGrid
  items={[
    { label: 'Total messages', value: <Text>1,284</Text> },
  ]}
/>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <dl>
        <Story />
      </dl>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof StatItem>;

export const Default: Story = {
  args: {
    label: 'Total messages',
    children: <Text>1,284</Text>,
  },
};

export const WithBadge: Story = {
  args: {
    label: 'Status',
    children: (
      <Badge variant="green" dot>
        Active
      </Badge>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'A stat item whose value is a badge rather than plain text.',
      },
    },
  },
};

export const InGrid: Story = {
  decorators: [],
  render: () => (
    <StatGrid
      cols={3}
      items={[
        { label: 'Conversations', value: <Text>342</Text> },
        { label: 'Open tickets', value: <Text>17</Text> },
        { label: 'Resolved', value: <Text>325</Text> },
        { label: 'Avg. response time', value: <Text>4m 12s</Text> },
        { label: 'CSAT score', value: <Text>96%</Text> },
        { label: 'Plan', value: <Badge variant="blue">Pro</Badge> },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Multiple stat items arranged in a grid via the data-driven StatGrid component.',
      },
    },
  },
};
