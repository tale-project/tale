import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useState } from 'react';

export default function DialogConfirm() {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);

  return (
    <div className="flex flex-col items-center gap-3">
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      <p className="text-muted-foreground text-xs">
        {deleted ? 'Confirmed.' : 'Nothing happens until you confirm.'}
      </p>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant="destructive"
        title="Delete this project?"
        description="Its threads, files and automations are removed with it. This cannot be undone."
        confirmText="Delete project"
        onConfirm={() => {
          setDeleted(true);
          setOpen(false);
        }}
      />
    </div>
  );
}
