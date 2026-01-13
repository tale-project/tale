import type { Meta, StoryObj } from '@storybook/react';
import { StatusIndicator } from './status-indicator';

const meta: Meta<typeof StatusIndicator> = {
  title: 'Feedback/StatusIndicator',
  component: StatusIndicator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A status indicator component with colored dot and optional label.

## Usage
\`\`\`tsx
import { StatusIndicator } from '@/components/ui/feedback/status-indicator';

<StatusIndicator variant="success">Online</StatusIndicator>
<StatusIndicator variant="error" pulse>Disconnected</StatusIndicator>
\`\`\`

## Accessibility
- Dot is decorative (aria-hidden)
- Status text provides meaning
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['success', 'warning', 'error', 'info', 'neutral'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    pulse: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatusIndicator>;

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Online',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Degraded',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    children: 'Offline',
  },
};

export const InfoStatus: Story = {
  args: {
    variant: 'info',
    children: 'Processing',
  },
};

export const Neutral: Story = {
  args: {
    variant: 'neutral',
    children: 'Unknown',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-3">
      <StatusIndicator variant="success">Success / Online</StatusIndicator>
      <StatusIndicator variant="warning">Warning / Degraded</StatusIndicator>
      <StatusIndicator variant="error">Error / Offline</StatusIndicator>
      <StatusIndicator variant="info">Info / Processing</StatusIndicator>
      <StatusIndicator variant="neutral">Neutral / Unknown</StatusIndicator>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="space-y-3">
      <StatusIndicator variant="success" size="sm">
        Small
      </StatusIndicator>
      <StatusIndicator variant="success" size="md">
        Medium (default)
      </StatusIndicator>
      <StatusIndicator variant="success" size="lg">
        Large
      </StatusIndicator>
    </div>
  ),
};

export const WithPulse: Story = {
  render: () => (
    <div className="space-y-3">
      <StatusIndicator variant="success" pulse>
        Connecting...
      </StatusIndicator>
      <StatusIndicator variant="warning" pulse>
        Syncing...
      </StatusIndicator>
      <StatusIndicator variant="info" pulse>
        Processing...
      </StatusIndicator>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'The pulse animation indicates an ongoing process.',
      },
    },
  },
};

export const DotOnly: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <StatusIndicator variant="success" size="sm" />
      <StatusIndicator variant="warning" size="md" />
      <StatusIndicator variant="error" size="lg" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Status indicators can be used without text labels.',
      },
    },
  },
};

export const InContext: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <span className="font-medium">API Server</span>
        <StatusIndicator variant="success" size="sm">
          Operational
        </StatusIndicator>
      </div>
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <span className="font-medium">Database</span>
        <StatusIndicator variant="warning" size="sm">
          High Latency
        </StatusIndicator>
      </div>
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <span className="font-medium">CDN</span>
        <StatusIndicator variant="error" size="sm">
          Outage
        </StatusIndicator>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Status indicators used in a service status dashboard.',
      },
    },
  },
};
