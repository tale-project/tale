import type { Meta, StoryObj } from '@storybook/react';
import { AlertTriangle, FileQuestion, WifiOff, Lock, CheckCircle } from 'lucide-react';
import { StatusPage } from './status-page';
import { Button } from '../primitives/button';

const meta: Meta<typeof StatusPage> = {
  title: 'Feedback/StatusPage',
  component: StatusPage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
A full-page status component for error pages, empty states, and confirmations.

## Usage
\`\`\`tsx
import { StatusPage } from '@/components/ui/feedback/status-page';

<StatusPage
  icon={<AlertTriangle className="size-12 text-destructive" />}
  title="Something went wrong"
  description="We encountered an unexpected error."
  actions={<Button>Try again</Button>}
/>
\`\`\`

## Features
- Supports default and compact sizes
- Optional header, icon, actions, and footer slots
- Centered layout with responsive padding
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatusPage>;

export const Error: Story = {
  args: {
    icon: <AlertTriangle className="size-12 text-destructive" />,
    title: 'Something went wrong',
    description: 'We encountered an unexpected error while processing your request. Please try again.',
    actions: (
      <>
        <Button variant="outline">Go back</Button>
        <Button>Try again</Button>
      </>
    ),
  },
};

export const NotFound: Story = {
  args: {
    icon: <FileQuestion className="size-12 text-muted-foreground" />,
    title: 'Page not found',
    description: 'The page you are looking for does not exist or has been moved.',
    actions: <Button>Go to homepage</Button>,
  },
};

export const Offline: Story = {
  args: {
    icon: <WifiOff className="size-12 text-muted-foreground" />,
    title: 'You are offline',
    description: 'Please check your internet connection and try again.',
    actions: <Button>Retry connection</Button>,
  },
};

export const AccessDenied: Story = {
  args: {
    icon: <Lock className="size-12 text-amber-500" />,
    title: 'Access denied',
    description: 'You do not have permission to view this page. Please contact your administrator.',
    actions: (
      <>
        <Button variant="outline">Go back</Button>
        <Button>Request access</Button>
      </>
    ),
  },
};

export const Success: Story = {
  args: {
    icon: <CheckCircle className="size-12 text-green-500" />,
    title: 'Action completed',
    description: 'Your changes have been saved successfully.',
    actions: <Button>Continue</Button>,
  },
};

export const EmptyState: Story = {
  args: {
    size: 'compact',
    icon: <FileQuestion className="size-10 text-muted-foreground" />,
    title: 'No items yet',
    description: 'Get started by creating your first item.',
    actions: <Button size="sm">Create item</Button>,
  },
  parameters: {
    docs: {
      description: {
        story: 'Use compact size for empty states within pages.',
      },
    },
  },
};

export const WithFooter: Story = {
  args: {
    icon: <AlertTriangle className="size-12 text-destructive" />,
    title: 'Server error',
    description: 'Our servers are experiencing issues. Our team has been notified.',
    actions: <Button>Refresh page</Button>,
    footer: (
      <p className="text-sm text-muted-foreground">
        Need help? Contact{' '}
        <a href="mailto:support@example.com" className="text-primary hover:underline">
          support@example.com
        </a>
      </p>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Add footer content for support information or additional links.',
      },
    },
  },
};

export const CompactSize: Story = {
  args: {
    size: 'compact',
    icon: <FileQuestion className="size-8 text-muted-foreground" />,
    title: 'No results found',
    description: 'Try adjusting your search or filters.',
    actions: <Button size="sm" variant="outline">Clear filters</Button>,
  },
  parameters: {
    docs: {
      description: {
        story: 'Compact size for inline empty states.',
      },
    },
  },
};

export const WithChildren: Story = {
  args: {
    icon: <AlertTriangle className="size-12 text-destructive" />,
    title: 'Delete account?',
    description: 'This action cannot be undone.',
    actions: (
      <>
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete account</Button>
      </>
    ),
    children: (
      <div className="p-4 bg-muted rounded-lg text-sm text-left">
        <p className="font-medium mb-2">This will permanently delete:</p>
        <ul className="list-disc list-inside text-muted-foreground space-y-1">
          <li>All your projects and data</li>
          <li>Team memberships</li>
          <li>API keys and integrations</li>
        </ul>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Additional content can be passed as children.',
      },
    },
  },
};
