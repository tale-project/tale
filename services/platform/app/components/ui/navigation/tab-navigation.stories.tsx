import type { Meta, StoryObj } from '@storybook/react';

import { Plus } from 'lucide-react';

import { Button } from '../primitives/button';
import { TabNavigation } from './tab-navigation';

const meta: Meta<typeof TabNavigation> = {
  title: 'Navigation/TabNavigation',
  component: TabNavigation,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A horizontal tab navigation component with animated indicator.

## Usage
\`\`\`tsx
import { TabNavigation } from '@/app/components/ui/navigation/tab-navigation';

<TabNavigation
  items={[
    { label: 'Overview', href: '/dashboard' },
    { label: 'Settings', href: '/dashboard/settings' },
    { label: 'Team', href: '/dashboard/team' },
  ]}
  ariaLabel="Dashboard navigation"
/>
\`\`\`

## Features
- Animated sliding indicator
- Role-based visibility
- Exact or startsWith path matching
- Accessible navigation with aria-current
- Support for additional action content
        `,
      },
    },
  },
  argTypes: {
    matchMode: {
      control: 'select',
      options: ['exact', 'startsWith'],
      description: 'Path matching mode for active state',
    },
    standalone: {
      control: 'boolean',
      description: 'Apply sticky positioning',
    },
    prefetch: {
      control: 'boolean',
      description: 'Prefetch linked pages',
    },
  },
};

export default meta;
type Story = StoryObj<typeof TabNavigation>;

const defaultItems = [
  { label: 'Overview', href: '/dashboard/overview' },
  { label: 'Analytics', href: '/dashboard/analytics' },
  { label: 'Reports', href: '/dashboard/reports' },
  { label: 'Settings', href: '/dashboard/settings' },
];

export const Default: Story = {
  args: {
    items: defaultItems,
    ariaLabel: 'Dashboard navigation',
  },
};

export const ExactMatch: Story = {
  args: {
    items: [
      { label: 'Dashboard', href: '/dashboard', matchMode: 'exact' },
      { label: 'Users', href: '/dashboard/users' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
    ariaLabel: 'Navigation with exact match',
    matchMode: 'startsWith',
  },
  parameters: {
    docs: {
      description: {
        story: 'Individual items can override the default match mode.',
      },
    },
  },
};

export const WithRoles: Story = {
  args: {
    items: [
      { label: 'Overview', href: '/dashboard/overview' },
      { label: 'Analytics', href: '/dashboard/analytics' },
      { label: 'Admin', href: '/dashboard/admin', roles: ['admin'] },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
    userRole: 'admin',
    ariaLabel: 'Role-based navigation',
  },
  parameters: {
    docs: {
      description: {
        story: 'Tabs can be hidden based on user roles.',
      },
    },
  },
};

export const WithoutAdminRole: Story = {
  args: {
    items: [
      { label: 'Overview', href: '/dashboard/overview' },
      { label: 'Analytics', href: '/dashboard/analytics' },
      { label: 'Admin', href: '/dashboard/admin', roles: ['admin'] },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
    userRole: 'member',
    ariaLabel: 'Role-based navigation',
  },
  parameters: {
    docs: {
      description: {
        story: 'Admin tab is hidden for non-admin users.',
      },
    },
  },
};

export const WithActions: Story = {
  args: {
    items: defaultItems,
    ariaLabel: 'Navigation with actions',
    children: (
      <div className="ml-auto flex items-center">
        <Button size="sm" icon={Plus}>
          Create Report
        </Button>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Additional action content via children prop.',
      },
    },
  },
};

export const ManyTabs: Story = {
  render: () => (
    <div className="w-[500px]">
      <TabNavigation
        items={[
          { label: 'Overview', href: '/dashboard/overview' },
          { label: 'Analytics', href: '/dashboard/analytics' },
          { label: 'Reports', href: '/dashboard/reports' },
          { label: 'Users', href: '/dashboard/users' },
          { label: 'Teams', href: '/dashboard/teams' },
          { label: 'Billing', href: '/dashboard/billing' },
          { label: 'Integrations', href: '/dashboard/integrations' },
          { label: 'API Keys', href: '/dashboard/api-keys' },
          { label: 'Settings', href: '/dashboard/settings' },
        ]}
        ariaLabel="Navigation with many tabs"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Many tabs in a narrow container scroll horizontally without wrapping.',
      },
    },
  },
};

export const NonStandalone: Story = {
  args: {
    items: defaultItems,
    ariaLabel: 'Non-sticky navigation',
    standalone: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Without sticky positioning (for use inside StickyHeader wrapper).',
      },
    },
  },
};
