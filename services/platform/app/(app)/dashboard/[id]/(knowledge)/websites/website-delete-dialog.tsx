'use client';

import { useState } from 'react';
import { DeleteDialog } from '@/components/ui/dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useDeleteWebsite } from './hooks';
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
