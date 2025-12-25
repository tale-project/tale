'use client';

import { Dialog, DialogTrigger } from '@/components/ui/dialog';
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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="p-1 hover:bg-muted rounded"
          title={t('viewSubscriptions')}
        >
          <EyeIcon className="size-4 text-muted-foreground" />
        </button>
      </DialogTrigger>

      <CustomerInfoDialog customer={customer} />
    </Dialog>
  );
}
