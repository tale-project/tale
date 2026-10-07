import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../primitives/button';
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
        component:
          'A modal that renders as a centered Dialog on `md+` viewports and a bottom Drawer (via vaul) on mobile. Drop-in replacement for any form-like dialog where the desktop modal is awkward on a touch device.',
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
