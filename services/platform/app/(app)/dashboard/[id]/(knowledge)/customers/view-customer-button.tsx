'use client';

import { useState } from 'react';
import { EyeIcon } from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface ViewCustomerButtonProps {
  customer: Doc<'customers'>;
}

export default function ViewCustomerButton({
  customer,
}: ViewCustomerButtonProps) {
  const { t } = useT('customers');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={t('viewSubscriptions')}
        onClick={() => setIsOpen(true)}
      >
        <EyeIcon className="size-4 text-muted-foreground" />
      </Button>

      <CustomerInfoDialog
        customer={customer}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
