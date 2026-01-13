import type { Meta, StoryObj } from '@storybook/react';
import { RoleBadge, StatusBadge } from './role-badge';

const meta: Meta<typeof RoleBadge> = {
  title: 'Feedback/RoleBadge',
  component: RoleBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Badge components for displaying user roles and status.

## Usage
\`\`\`tsx
import { RoleBadge, StatusBadge } from '@/components/ui/feedback/role-badge';

<RoleBadge role="admin" />
<StatusBadge status="active" showDot />
\`\`\`

## Accessibility
- Status dots are decorative (aria-hidden)
- Uses semantic color coding
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof RoleBadge>;

export const Admin: Story = {
  args: {
    role: 'admin',
  },
};

export const Member: Story = {
  args: {
    role: 'member',
  },
};

export const Owner: Story = {
  args: {
    role: 'owner',
  },
};

export const AllRoles: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <RoleBadge role="admin" />
      <RoleBadge role="owner" />
      <RoleBadge role="member" />
      <RoleBadge role="viewer" />
      <RoleBadge role="guest" />
      <RoleBadge role={null} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available role badge variants.',
      },
    },
  },
};

export const WithCustomLabel: Story = {
  args: {
    role: 'admin',
    getLabel: (role: string) => `Role: ${role.charAt(0).toUpperCase() + role.slice(1)}`,
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom label formatting using the getLabel prop.',
      },
    },
  },
};

export const StatusBadgeActive: Story = {
  render: () => <StatusBadge status="active" showDot />,
  name: 'StatusBadge - Active',
};

export const StatusBadgeInactive: Story = {
  render: () => <StatusBadge status="inactive" showDot />,
  name: 'StatusBadge - Inactive',
};

export const StatusBadgePending: Story = {
  render: () => <StatusBadge status="pending" showDot />,
  name: 'StatusBadge - Pending',
};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="active" showDot />
      <StatusBadge status="inactive" showDot />
      <StatusBadge status="pending" showDot />
      <StatusBadge status="failed" showDot />
      <StatusBadge status="processing" showDot />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available status badge variants with dots.',
      },
    },
  },
};

export const StatusWithoutDot: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="active" />
      <StatusBadge status="inactive" />
      <StatusBadge status="pending" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Status badges can be rendered without the dot indicator.',
      },
    },
  },
};

export const InContext: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <div>
          <p className="font-medium">John Doe</p>
          <p className="text-sm text-muted-foreground">john@example.com</p>
        </div>
        <RoleBadge role="admin" />
      </div>
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <div>
          <p className="font-medium">Jane Smith</p>
          <p className="text-sm text-muted-foreground">jane@example.com</p>
        </div>
        <RoleBadge role="member" />
      </div>
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <div>
          <p className="font-medium">Bob Wilson</p>
          <p className="text-sm text-muted-foreground">bob@example.com</p>
        </div>
        <StatusBadge status="pending" showDot />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Role and status badges used in a user list context.',
      },
    },
  },
};
