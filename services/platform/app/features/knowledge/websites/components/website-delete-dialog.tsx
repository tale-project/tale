'use client';

import { useState } from 'react';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useDeleteWebsite } from '../hooks/use-delete-website';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface DeleteWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

export function DeleteWebsiteDialog({
  isOpen,
  onClose,
  website,
}: DeleteWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const [isLoading, setIsLoading] = useState(false);
  const deleteWebsite = useDeleteWebsite();

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
    <DeleteDialog
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tWebsites('delete.title')}
      description={tWebsites('delete.confirmation')}
      isDeleting={isLoading}
      onDelete={handleDelete}
      preview={{ primary: website.domain, secondary: website.title }}
    />
  );
}
