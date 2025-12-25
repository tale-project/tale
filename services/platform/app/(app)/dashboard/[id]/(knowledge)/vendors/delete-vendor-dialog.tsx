'use client';

import { DeleteModal } from '@/components/ui/modals';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface DeleteVendorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  vendor: Doc<'vendors'>;
  isDeleting?: boolean;
}

export default function DeleteVendorDialog({
  isOpen,
  onClose,
  onConfirm,
  vendor,
  isDeleting = false,
}: DeleteVendorDialogProps) {
  const { t: tVendors } = useT('vendors');

  return (
    <DeleteModal
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tVendors('deleteVendor')}
      description={tVendors('deleteConfirmation', { name: vendor.name || tVendors('thisVendor') })}
      isDeleting={isDeleting}
      onDelete={onConfirm}
    />
  );
}
