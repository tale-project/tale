'use client';

import { Dialog } from '@/components/ui/dialog';
import { EyeIcon } from 'lucide-react';
import { VendorInfoDialog } from '@/components/email-table/vendor-info-dialog';
import { DialogTrigger } from '@radix-ui/react-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface ViewVendorButtonProps {
  vendor: Doc<'vendors'>;
}

export default function ViewVendorButton({ vendor }: ViewVendorButtonProps) {
  const { t } = useT('vendors');

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t('viewDetails')}
          className="hover:bg-transparent"
        >
          <EyeIcon className="size-4" />
        </Button>
      </DialogTrigger>

      <VendorInfoDialog vendor={vendor} />
    </Dialog>
  );
}
