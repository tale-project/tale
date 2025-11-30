'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Dispatch, SetStateAction } from 'react';
interface LeaveOrganizationDialogProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isUpdating: boolean;
  onLeave: () => void;
}

export default function LeaveOrganizationDialog({
  open,
  isUpdating,
  onLeave,
  onOpenChange,
}: LeaveOrganizationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-lg">Leave organization</DialogTitle>
          <DialogDescription className="text-sm">
            Are you sure you want to leave this organization? You will lose
            access to all resources.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={isUpdating} className="flex-1">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={onLeave}
            disabled={isUpdating}
            className="flex-1"
          >
            {isUpdating ? 'Leaving...' : 'Leave organization'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
