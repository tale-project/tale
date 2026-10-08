import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Link2, Maximize2 } from 'lucide-react';
import { useState } from 'react';

export default function DialogHeaderActions() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open a task
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent
          className="max-w-lg"
          headerActions={
            <>
              <IconButton
                icon={Link2}
                size="sm"
                variant="ghost"
                aria-label="Copy link"
                onClick={() => setCopied(true)}
              />
              <IconButton
                icon={Maximize2}
                size="sm"
                variant="ghost"
                asChild
                slotChild={<a href="#open-as-page" />}
                aria-label="Open as page"
              />
            </>
          }
        >
          {/* The title row leaves room for the action cluster at its end. */}
          <div className="flex flex-col gap-2 pr-28">
            <ResponsiveDialogTitle className="text-base font-semibold">
              Redesign the pricing page
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-muted-foreground text-sm">
              {copied
                ? 'Link copied. In an application this copies the task address.'
                : 'Copy link and Open as page sit beside Close, in that order.'}
            </ResponsiveDialogDescription>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
