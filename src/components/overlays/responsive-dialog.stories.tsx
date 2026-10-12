import type { Meta, StoryObj } from '@storybook/react-vite';
import { Link2, Maximize2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../primitives/button';
import { IconButton } from '../primitives/icon-button';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from './responsive-dialog';

const meta: Meta<typeof ResponsiveDialog> = {
  title: 'Overlays/ResponsiveDialog',
  component: ResponsiveDialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: `
A modal that renders as a centered Dialog on \`md+\` viewports and a bottom Drawer (via vaul) on mobile. Drop-in replacement for any form-like dialog where the desktop modal is awkward on a touch device.

## Usage
\`\`\`tsx
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';

<ResponsiveDialogContent headerActions={<IconButton icon={Maximize2} size="sm" aria-label="Open as page" />}>
  <ResponsiveDialogTitle>Review the launch checklist</ResponsiveDialogTitle>
</ResponsiveDialogContent>
\`\`\`

## Accessibility
- Close is a 32px icon button named by the shared translated "Close" (\`closeLabel\` overrides it), on the dialog and on the drawer
- \`headerActions\` sit in the same top-right cluster, just before Close; each needs its own \`aria-label\`
- The cluster follows the content in the tab order, so Close is the last stop inside the focus trap
- Focus returns to the opener on close, also when the dialog was opened from state
        `,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof ResponsiveDialog>;

export const Default: Story = {
  render: () => (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button>Open</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent closeLabel="Close">
        <ResponsiveDialogTitle>Confirm action</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          This is a responsive dialog. Resize the viewport below 768px to see it
          animate from the bottom as a drawer.
        </ResponsiveDialogDescription>
        <div className="flex justify-end gap-2 pt-4">
          <ResponsiveDialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </ResponsiveDialogClose>
          <ResponsiveDialogClose asChild>
            <Button>Confirm</Button>
          </ResponsiveDialogClose>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  ),
};

function ControlledExample() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3">
      <Button onClick={() => setOpen(true)}>Open via state</Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Controlled</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            The parent owns the `open` state.
          </ResponsiveDialogDescription>
          <ResponsiveDialogClose asChild>
            <Button className="mt-4">Close</Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

export const Controlled: Story = {
  render: () => <ControlledExample />,
};

export const WithHeaderActions: Story = {
  render: () => (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button>Open the task</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent
        className="max-w-3xl"
        headerActions={
          <>
            <IconButton icon={Link2} size="sm" aria-label="Copy link" />
            <IconButton
              asChild
              slotChild={<a href="#task-page" aria-label="Open as page" />}
              icon={Maximize2}
              size="sm"
              aria-label="Open as page"
            />
          </>
        }
      >
        <ResponsiveDialogTitle className="pr-28">
          Review the launch checklist
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          The header actions sit with Close in one cluster — on a phone too,
          where the drawer gives them a band of their own above the content.
        </ResponsiveDialogDescription>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  ),
};
