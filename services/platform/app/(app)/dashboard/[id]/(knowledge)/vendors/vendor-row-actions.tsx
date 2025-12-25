'use client';

import { useState } from 'react';
import { MoreVertical, Eye, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { VendorInfoDialog } from '@/components/email-table/vendor-info-dialog';
import EditVendorButton from './edit-vendor-button';
import DeleteVendorButton from './delete-vendor-button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface VendorRowActionsProps {
  vendor: Doc<'vendors'>;
}

export default function VendorRowActions({ vendor }: VendorRowActionsProps) {
  const { t } = useT('vendors');
  const { t: tCommon } = useT('common');
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const canEdit =
    vendor.source === 'manual_import' || vendor.source === 'file_upload';

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreVertical className="size-4" />
            <span className="sr-only">{tCommon('actions.openMenu')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[10rem]">
          <DropdownMenuItem
            onClick={() => {
              setIsViewDialogOpen(true);
              setIsDropdownOpen(false);
            }}
          >
            <Eye className="mr-2 size-4" />
            {t('viewDetails')}
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setIsEditDialogOpen(true);
                  setIsDropdownOpen(false);
                }}
              >
                <Pencil className="mr-2 size-4" />
                {tCommon('actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setIsDeleteDialogOpen(true);
                  setIsDropdownOpen(false);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" />
                {tCommon('actions.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View Dialog */}
      <VendorInfoDialog
        vendor={vendor}
        open={isViewDialogOpen}
        onOpenChange={setIsViewDialogOpen}
      />

      {/* Edit Dialog */}
      <EditVendorButton
        vendor={vendor}
        isOpen={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        asChild
      />

      {/* Delete Dialog */}
      <DeleteVendorButton
        vendor={vendor}
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        asChild
      />
    </>
  );
}
