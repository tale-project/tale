'use client';

import { Dialog } from '@/components/ui/dialog';
import { EyeIcon } from 'lucide-react';
import { VendorInfoDialog } from '@/components/email-table/vendor-info-dialog';
import { DialogTrigger } from '@radix-ui/react-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

interface ViewVendorButtonProps {
  vendor: Doc<'vendors'>;
}

export default function ViewVendorButton({ vendor }: ViewVendorButtonProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="View Vendor Details"
          className="hover:bg-transparent"
        >
          <EyeIcon className="size-4" />
        </Button>
      </DialogTrigger>

      <VendorInfoDialog vendor={vendor} />
    </Dialog>
  );
}
