import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Copy, ExternalLink, Pencil } from 'lucide-react';
import { useState } from 'react';

import { LabeledValue, LabeledValueGroup } from '../data-display/labeled-value';
import { ViewDialog } from './view-dialog';

const meta: Meta<typeof ViewDialog> = {
  title: 'Dialog/ViewDialog',
  component: ViewDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A dialog for displaying read-only content and information.

## Usage
\`\`\`tsx
import { ViewDialog } from '@tale/ui/dialog/view-dialog';

<ViewDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  title="User Details"
>
  <LabeledValue label="Name">John Doe</LabeledValue>
  <LabeledValue label="Email">john@example.com</LabeledValue>
</ViewDialog>
\`\`\`

## Features
- Read-only content display
- Optional header actions
- Custom footer support
- Multiple size variants
- Error boundary protection
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg', 'xl', 'full'],
      description: 'Dialog size variant',
    },
    hideClose: {
      control: 'boolean',
      description: 'Hide the close button',
    },
  },
};

export default meta;
type Story = StoryObj<typeof ViewDialog>;

export const Default: Story = {
  render: function DefaultStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>View details</Button>
        <ViewDialog
          open={open}
          onOpenChange={setOpen}
          title="User details"
          description="Information about the selected user."
        >
          <LabeledValueGroup>
            <LabeledValue label="Name">John Doe</LabeledValue>
            <LabeledValue label="Email">john@example.com</LabeledValue>
            <LabeledValue label="Role">Administrator</LabeledValue>
            <LabeledValue label="Status">
              <Badge variant="green">Active</Badge>
            </LabeledValue>
            <LabeledValue label="Member since">January 15, 2024</LabeledValue>
          </LabeledValueGroup>
        </ViewDialog>
      </>
    );
  },
};

export const WithHeaderActions: Story = {
  render: function HeaderActionsStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>View item</Button>
        <ViewDialog
          open={open}
          onOpenChange={setOpen}
          title="Document details"
          headerActions={
            <div className="flex gap-1">
              <IconButton icon={Copy} aria-label="Copy link" />
              <IconButton icon={ExternalLink} aria-label="Open in new tab" />
              <IconButton icon={Pencil} aria-label="Edit" />
            </div>
          }
        >
          <LabeledValueGroup>
            <LabeledValue label="File name">project-proposal.pdf</LabeledValue>
            <LabeledValue label="Size">2.4 MB</LabeledValue>
            <LabeledValue label="Created">January 10, 2024</LabeledValue>
            <LabeledValue label="Updated">January 20, 2024</LabeledValue>
          </LabeledValueGroup>
        </ViewDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Header actions for quick operations without leaving the dialog.',
      },
    },
  },
};

export const WithFooter: Story = {
  render: function FooterStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>View order</Button>
        <ViewDialog
          open={open}
          onOpenChange={setOpen}
          title="Order #12345"
          customFooter={
            <div className="flex w-full justify-between">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary">Download invoice</Button>
                <Button>Track shipment</Button>
              </div>
            </div>
          }
        >
          <LabeledValueGroup>
            <LabeledValue label="Order date">January 15, 2024</LabeledValue>
            <LabeledValue label="Status">
              <Badge variant="blue">Shipped</Badge>
            </LabeledValue>
            <LabeledValue label="Total">$149.99</LabeledValue>
            <LabeledValue label="Shipping address">
              123 Main St, New York, NY 10001
            </LabeledValue>
          </LabeledValueGroup>
        </ViewDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom footer with action buttons.',
      },
    },
  },
};

export const LargeSize: Story = {
  render: function LargeSizeStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>View full report</Button>
        <ViewDialog
          open={open}
          onOpenChange={setOpen}
          title="Monthly report"
          size="lg"
        >
          <div className="space-y-4">
            <LabeledValueGroup>
              <LabeledValue label="Report period">January 2024</LabeledValue>
              <LabeledValue label="Generated">January 31, 2024</LabeledValue>
            </LabeledValueGroup>
            <div className="rounded-lg border p-4">
              <h4 className="mb-2 font-medium">Summary</h4>
              <p className="text-muted-foreground text-sm">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
                enim ad minim veniam, quis nostrud exercitation ullamco laboris
                nisi ut aliquip ex ea commodo consequat.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <h4 className="mb-2 font-medium">Key metrics</h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">1,234</div>
                  <div className="text-muted-foreground text-sm">
                    Total users
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold">$45.6K</div>
                  <div className="text-muted-foreground text-sm">Revenue</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">98.5%</div>
                  <div className="text-muted-foreground text-sm">Uptime</div>
                </div>
              </div>
            </div>
          </div>
        </ViewDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Large size variant for detailed content.',
      },
    },
  },
};

export const HideCloseButton: Story = {
  render: function HideCloseStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>View terms</Button>
        <ViewDialog
          open={open}
          onOpenChange={setOpen}
          title="Terms of service"
          hideClose
          customFooter={
            <Button onClick={() => setOpen(false)} className="w-full">
              I understand
            </Button>
          }
        >
          <div className="text-muted-foreground space-y-4 text-sm">
            <p>
              By using this service, you agree to our terms and conditions.
              Please read the following carefully.
            </p>
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
        </ViewDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Hide the close button to require action through footer.',
      },
    },
  },
};
