import type { Meta, StoryObj } from '@storybook/react';
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
} from './toast';

const meta: Meta<typeof Toast> = {
  title: 'Feedback/Toast',
  component: Toast,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Toast notifications for displaying brief messages.

## Usage
\`\`\`tsx
import { useToast } from '@/hooks/use-toast';

const { toast } = useToast();

toast({
  title: 'Success',
  description: 'Your changes have been saved.',
  variant: 'success',
});
\`\`\`

## Accessibility
- Toasts use role="status" with aria-live
- Close button has aria-label
- Swipe to dismiss on touch devices
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
        <ToastViewport />
      </ToastProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Default: Story = {
  render: () => (
    <Toast open>
      <div className="grid gap-1">
        <ToastTitle>Notification</ToastTitle>
        <ToastDescription>This is a default toast message.</ToastDescription>
      </div>
      <ToastClose />
    </Toast>
  ),
};

export const Success: Story = {
  render: () => (
    <Toast variant="success" open>
      <div className="grid gap-1">
        <ToastTitle>Success!</ToastTitle>
        <ToastDescription>Your changes have been saved.</ToastDescription>
      </div>
      <ToastClose />
    </Toast>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Toast variant="destructive" open>
      <div className="grid gap-1">
        <ToastTitle>Error</ToastTitle>
        <ToastDescription>Something went wrong. Please try again.</ToastDescription>
      </div>
      <ToastClose />
    </Toast>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Toast open>
      <div className="grid gap-1">
        <ToastTitle>Undo action</ToastTitle>
        <ToastDescription>The item has been deleted.</ToastDescription>
      </div>
      <ToastAction altText="Undo">Undo</ToastAction>
      <ToastClose />
    </Toast>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Toasts can include action buttons for quick interactions.',
      },
    },
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Toast open className="relative">
        <div className="grid gap-1">
          <ToastTitle>Default Toast</ToastTitle>
          <ToastDescription>This is a default notification.</ToastDescription>
        </div>
        <ToastClose />
      </Toast>
      <Toast variant="success" open className="relative">
        <div className="grid gap-1">
          <ToastTitle>Success Toast</ToastTitle>
          <ToastDescription>Operation completed successfully.</ToastDescription>
        </div>
        <ToastClose />
      </Toast>
      <Toast variant="destructive" open className="relative">
        <div className="grid gap-1">
          <ToastTitle>Error Toast</ToastTitle>
          <ToastDescription>An error occurred.</ToastDescription>
        </div>
        <ToastClose />
      </Toast>
    </div>
  ),
};

export const SimpleMessage: Story = {
  render: () => (
    <Toast open>
      <ToastDescription>Copied to clipboard!</ToastDescription>
      <ToastClose />
    </Toast>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Simple toast with just a description, no title.',
      },
    },
  },
};

export const LongContent: Story = {
  render: () => (
    <Toast open>
      <div className="grid gap-1">
        <ToastTitle>Update Available</ToastTitle>
        <ToastDescription>
          A new version of the application is available. Please refresh the page to get the latest features and improvements.
        </ToastDescription>
      </div>
      <ToastAction altText="Refresh">Refresh</ToastAction>
      <ToastClose />
    </Toast>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Toasts can handle longer content gracefully.',
      },
    },
  },
};
