import type { Meta, StoryObj } from '@storybook/react';

import { Tabs } from './tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Navigation/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A config-driven tabs component built on Radix UI primitives with full keyboard navigation.

## Usage
\`\`\`tsx
import { Tabs } from '@/app/components/ui/navigation/tabs';

<Tabs
  defaultValue="account"
  items={[
    { value: 'account', label: 'Account', content: <p>Account settings</p> },
    { value: 'password', label: 'Password', content: <p>Change password</p> },
  ]}
/>
\`\`\`

## Accessibility
- Arrow keys navigate between tabs
- Tab key moves focus to content
- ARIA roles and states handled automatically
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {
  render: () => (
    <Tabs
      defaultValue="account"
      className="w-[400px]"
      items={[
        {
          value: 'account',
          label: 'Account',
          content: (
            <p className="text-muted-foreground text-sm">
              Make changes to your account here. Click save when you&apos;re
              done.
            </p>
          ),
        },
        {
          value: 'password',
          label: 'Password',
          content: (
            <p className="text-muted-foreground text-sm">
              Change your password here. After saving, you&apos;ll be logged
              out.
            </p>
          ),
        },
      ]}
    />
  ),
};

export const ThreeTabs: Story = {
  render: () => (
    <Tabs
      defaultValue="overview"
      className="w-[500px]"
      items={[
        {
          value: 'overview',
          label: 'Overview',
          content: (
            <div className="p-4">
              <h3 className="mb-2 font-semibold">Overview</h3>
              <p className="text-muted-foreground text-sm">
                View a summary of your account activity and key metrics.
              </p>
            </div>
          ),
        },
        {
          value: 'analytics',
          label: 'Analytics',
          content: (
            <div className="p-4">
              <h3 className="mb-2 font-semibold">Analytics</h3>
              <p className="text-muted-foreground text-sm">
                Detailed analytics and performance data.
              </p>
            </div>
          ),
        },
        {
          value: 'reports',
          label: 'Reports',
          content: (
            <div className="p-4">
              <h3 className="mb-2 font-semibold">Reports</h3>
              <p className="text-muted-foreground text-sm">
                Download and view generated reports.
              </p>
            </div>
          ),
        },
      ]}
    />
  ),
};

export const WithDisabledTab: Story = {
  render: () => (
    <Tabs
      defaultValue="active"
      className="w-[400px]"
      items={[
        {
          value: 'active',
          label: 'Active',
          content: (
            <p className="text-muted-foreground text-sm">This tab is active.</p>
          ),
        },
        {
          value: 'disabled',
          label: 'Disabled',
          disabled: true,
          content: (
            <p className="text-muted-foreground text-sm">
              You cannot see this content.
            </p>
          ),
        },
        {
          value: 'settings',
          label: 'Settings',
          content: (
            <p className="text-muted-foreground text-sm">
              Settings content here.
            </p>
          ),
        },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tabs can be disabled to prevent user interaction.',
      },
    },
  },
};

export const FullWidth: Story = {
  render: () => (
    <Tabs
      defaultValue="inbox"
      className="w-full max-w-2xl"
      listClassName="w-full"
      items={[
        {
          value: 'inbox',
          label: 'Inbox',
          content: (
            <div className="mt-2 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">
                Your inbox messages.
              </p>
            </div>
          ),
        },
        {
          value: 'sent',
          label: 'Sent',
          content: (
            <div className="mt-2 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">
                Messages you&apos;ve sent.
              </p>
            </div>
          ),
        },
        {
          value: 'drafts',
          label: 'Drafts',
          content: (
            <div className="mt-2 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">
                Your draft messages.
              </p>
            </div>
          ),
        },
        {
          value: 'spam',
          label: 'Spam',
          content: (
            <div className="mt-2 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Spam messages.</p>
            </div>
          ),
        },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tabs can span the full width of their container.',
      },
    },
  },
};
