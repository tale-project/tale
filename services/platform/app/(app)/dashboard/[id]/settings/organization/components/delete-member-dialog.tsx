'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useMutation } from 'convex/react';
import { toast } from '@/hooks/use-toast';

type MemberLite = {
  _id: string;
  email?: string;
  displayName?: string;
  role?: string;
};

interface DeleteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberLite | null;
}

export default function DeleteMemberDialog({
  open,
  onOpenChange,
  member,
}: DeleteMemberDialogProps) {
  const removeMember = useMutation(api.member.removeMember);

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (!member) return null;

  const handleConfirm = async (memberId: string) => {
    try {
      await removeMember({
        memberId,
      });

      toast({
        title: 'Member removed',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to remove member',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="size-6 text-red-600" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-foreground">
                Remove team member
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-foreground">
            Are you sure you want to remove{' '}
            <span className="font-medium">
              {member.displayName || member.email || 'this member'}
            </span>{' '}
            from the team? They will lose access to this organization and all
            associated resources.
          </p>
          {member.role === 'admin' && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
              <p className="text-sm text-amber-800">
                <strong>Warning:</strong> Your organization must have at least 2
                Admins for security. This action will be blocked if it would
                leave fewer than 2 Admins.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-3">
          <Button variant="outline" onClick={handleCancel} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleConfirm(member._id)}
            className="flex-1"
          >
            Remove member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
