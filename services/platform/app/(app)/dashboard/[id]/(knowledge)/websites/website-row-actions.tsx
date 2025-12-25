'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreVertical } from 'lucide-react';
import { Eye, ScanText, RefreshCcw, Pencil, Trash2 } from 'lucide-react';
import { Doc } from '@/convex/_generated/dataModel';
import ViewWebsiteDialog from './view-website-dialog';
import EditWebsiteDialog from './edit-website-dialog';
import DeleteWebsiteDialog from './delete-website-dialog';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface WebsiteRowActionsProps {
  website: Doc<'websites'>;
}

export default function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t } = useT('websites');
  const { t: tCommon } = useT('common');
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);

  const rescanWebsite = useMutation(api.websites.rescanWebsite);

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      await rescanWebsite({ websiteId: website._id });
      toast({
        title: t('actions.rescanTriggered'),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : t('actions.rescanFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRescanning(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="size-8 p-0">
            <MoreVertical className="size-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsViewDialogOpen(true)}>
            <Eye className="mr-2 size-4" />
            {tCommon('actions.view')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleRescan} disabled={isRescanning}>
            {isRescanning ? (
              <RefreshCcw className="mr-2 size-4 animate-spin text-muted-foreground" />
            ) : (
              <ScanText className="mr-2 size-4" />
            )}
            {t('actions.rescan')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
            <Pencil className="mr-2 size-4" />
            {tCommon('actions.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setIsDeleteDialogOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            {tCommon('actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isViewDialogOpen && (
        <ViewWebsiteDialog
          isOpen={isViewDialogOpen}
          onClose={() => setIsViewDialogOpen(false)}
          website={website}
        />
      )}

      {isEditDialogOpen && (
        <EditWebsiteDialog
          isOpen={isEditDialogOpen}
          onClose={() => setIsEditDialogOpen(false)}
          website={website}
        />
      )}

      {isDeleteDialogOpen && (
        <DeleteWebsiteDialog
          isOpen={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          website={website}
        />
      )}
    </>
  );
}
