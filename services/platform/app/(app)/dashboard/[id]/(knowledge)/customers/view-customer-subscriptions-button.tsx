'use client';

import { useState } from 'react';
import { EyeIcon } from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface ViewCustomerSubscriptionsButtonProps {
  customer: Doc<'customers'>;
}

export default function ViewCustomerSubscriptionsButton({
  customer,
}: ViewCustomerSubscriptionsButtonProps) {
  const { t } = useT('customers');
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="p-1 hover:bg-muted rounded"
        title={t('viewSubscriptions')}
        onClick={() => setIsOpen(true)}
      >
        <EyeIcon className="size-4 text-muted-foreground" />
      </button>

      <CustomerInfoDialog
        customer={customer}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
