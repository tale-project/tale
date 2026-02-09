import type { Meta, StoryObj } from '@storybook/react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Navigation/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A tabs component built on Radix UI primitives with full keyboard navigation.

## Usage
\`\`\`tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/components/ui/navigation/tabs';

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
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
    <Tabs defaultValue="account" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <p className="text-muted-foreground text-sm">
          Make changes to your account here. Click save when you&apos;re done.
        </p>
      </TabsContent>
      <TabsContent value="password">
        <p className="text-muted-foreground text-sm">
          Change your password here. After saving, you&apos;ll be logged out.
        </p>
      </TabsContent>
    </Tabs>
  ),
};

export const ThreeTabs: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[500px]">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="p-4">
        <h3 className="mb-2 font-semibold">Overview</h3>
        <p className="text-muted-foreground text-sm">
          View a summary of your account activity and key metrics.
        </p>
      </TabsContent>
      <TabsContent value="analytics" className="p-4">
        <h3 className="mb-2 font-semibold">Analytics</h3>
        <p className="text-muted-foreground text-sm">
          Detailed analytics and performance data.
        </p>
      </TabsContent>
      <TabsContent value="reports" className="p-4">
        <h3 className="mb-2 font-semibold">Reports</h3>
        <p className="text-muted-foreground text-sm">
          Download and view generated reports.
        </p>
      </TabsContent>
    </Tabs>
  ),
};

export const WithDisabledTab: Story = {
  render: () => (
    <Tabs defaultValue="active" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="disabled" disabled>
          Disabled
        </TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <p className="text-muted-foreground text-sm">This tab is active.</p>
      </TabsContent>
      <TabsContent value="disabled">
        <p className="text-muted-foreground text-sm">
          You cannot see this content.
        </p>
      </TabsContent>
      <TabsContent value="settings">
        <p className="text-muted-foreground text-sm">Settings content here.</p>
      </TabsContent>
    </Tabs>
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
    <Tabs defaultValue="inbox" className="w-full max-w-2xl">
      <TabsList className="w-full">
        <TabsTrigger value="inbox" className="flex-1">
          Inbox
        </TabsTrigger>
        <TabsTrigger value="sent" className="flex-1">
          Sent
        </TabsTrigger>
        <TabsTrigger value="drafts" className="flex-1">
          Drafts
        </TabsTrigger>
        <TabsTrigger value="spam" className="flex-1">
          Spam
        </TabsTrigger>
      </TabsList>
      <TabsContent value="inbox" className="mt-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">Your inbox messages.</p>
      </TabsContent>
      <TabsContent value="sent" className="mt-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">
          Messages you&apos;ve sent.
        </p>
      </TabsContent>
      <TabsContent value="drafts" className="mt-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">Your draft messages.</p>
      </TabsContent>
      <TabsContent value="spam" className="mt-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">Spam messages.</p>
      </TabsContent>
    </Tabs>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tabs can span the full width of their container.',
      },
    },
  },
};
