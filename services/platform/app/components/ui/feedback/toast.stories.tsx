import type { Meta, StoryObj } from '@storybook/react';

import { toast } from '@/app/hooks/use-toast';

import { Toaster } from './toaster';

const meta: Meta<typeof Toaster> = {
  title: 'Feedback/Toast',
  component: Toaster,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Toast notifications for displaying brief messages.

## Usage
\`\`\`tsx
import { toast } from '@/app/hooks/use-toast';

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
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Toaster>;

export const Default: Story = {
  render: () => (
    <button
      type="button"
      className="rounded-md border px-4 py-2 text-sm"
      onClick={() =>
        toast({
          title: 'Notification',
          description: 'This is a default toast message.',
        })
      }
    >
      Show default toast
    </button>
  ),
};

export const Success: Story = {
  render: () => (
    <button
      type="button"
      className="rounded-md border px-4 py-2 text-sm"
      onClick={() =>
        toast({
          title: 'Success!',
          description: 'Your changes have been saved.',
          variant: 'success',
        })
      }
    >
      Show success toast
    </button>
  ),
};

export const Destructive: Story = {
  render: () => (
    <button
      type="button"
      className="rounded-md border px-4 py-2 text-sm"
      onClick={() =>
        toast({
          title: 'Error',
          description: 'Something went wrong. Please try again.',
          variant: 'destructive',
        })
      }
    >
      Show error toast
    </button>
  ),
};

export const SimpleMessage: Story = {
  render: () => (
    <button
      type="button"
      className="rounded-md border px-4 py-2 text-sm"
      onClick={() =>
        toast({
          description: 'Copied to clipboard!',
        })
      }
    >
      Show simple toast
    </button>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Simple toast with just a description, no title.',
      },
    },
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm"
        onClick={() =>
          toast({ title: 'Default', description: 'Default notification.' })
        }
      >
        Default
      </button>
      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm"
        onClick={() =>
          toast({
            title: 'Success',
            description: 'Operation completed.',
            variant: 'success',
          })
        }
      >
        Success
      </button>
      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm"
        onClick={() =>
          toast({
            title: 'Error',
            description: 'An error occurred.',
            variant: 'destructive',
          })
        }
      >
        Destructive
      </button>
    </div>
  ),
};
