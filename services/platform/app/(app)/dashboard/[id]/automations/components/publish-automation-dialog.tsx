'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';

interface PublishAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  workflowName?: string;
}

export default function PublishAutomationDialog({
  open,
  onOpenChange,
  onPublish,
  workflowName: _workflowName,
}: PublishAutomationDialogProps) {
  const handlePublish = () => {
    onPublish();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[25rem] p-6 gap-4">
        <DialogHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="font-semibold text-foreground">
              Publish automation
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4 text-foreground" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground leading-5">
            Once published, this automation will run automatically whenever its
            triggers occur, and it cannot be changed.
          </p>
        </DialogHeader>

        <DialogFooter className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button type="button" onClick={handlePublish} className="flex-1">
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
