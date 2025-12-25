'use client';

import { useState } from 'react';
import { EyeIcon } from 'lucide-react';
import { VendorInfoDialog } from '@/components/email-table/vendor-info-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface ViewVendorButtonProps {
  vendor: Doc<'vendors'>;
}

export default function ViewVendorButton({ vendor }: ViewVendorButtonProps) {
  const { t } = useT('vendors');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={t('viewDetails')}
        className="hover:bg-transparent"
        onClick={() => setIsOpen(true)}
      >
        <EyeIcon className="size-4" />
      </Button>

      <VendorInfoDialog
        vendor={vendor}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
