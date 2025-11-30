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
import { Dialog } from '@/components/ui/dialog';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import EditCustomerButton from './edit-customer-button';
import DeleteCustomerButton from './delete-customer-button';
import { Doc } from '@/convex/_generated/dataModel';
interface CustomerRowActionsProps {
  customer: Doc<'customers'>;
}

export default function CustomerRowActions({
  customer,
}: CustomerRowActionsProps) {
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const canEdit =
    customer.source === 'manual_import' || customer.source === 'file_upload';

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreVertical className="size-4" />
            <span className="sr-only">Open menu</span>
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
            View Details
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
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setIsDeleteDialogOpen(true);
                  setIsDropdownOpen(false);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <CustomerInfoDialog customer={customer} />
      </Dialog>

      {/* Edit Dialog */}
      <EditCustomerButton
        customer={customer}
        isOpen={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        asChild
      />

      {/* Delete Dialog */}
      <DeleteCustomerButton
        customer={customer}
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        asChild
      />
    </>
  );
}
