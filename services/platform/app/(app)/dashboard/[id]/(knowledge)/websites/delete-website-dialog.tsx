'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface DeleteWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

export default function DeleteWebsiteDialog({
  isOpen,
  onClose,
  website,
}: DeleteWebsiteDialogProps) {
  const { t: tCommon } = useT('common');
  const { t: tWebsites } = useT('websites');
  const [isLoading, setIsLoading] = useState(false);
  const deleteWebsite = useMutation(api.websites.deleteWebsite);

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      await deleteWebsite({ websiteId: website._id });

      onClose();
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : tWebsites('toast.deleteError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">{tWebsites('delete.title')}</DialogTitle>
          <DialogDescription>
            {tWebsites('delete.confirmation')}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-secondary/20 rounded-lg p-4 my-4">
          <div className="text-sm font-medium text-foreground">
            {website.domain}
          </div>
          {website.title && (
            <div className="text-xs text-muted-foreground mt-1">
              {website.title}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading}
          >
            {isLoading ? tCommon('actions.deleting') : tCommon('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
