'use client';

import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { EyeIcon } from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { Doc } from '@/convex/_generated/dataModel';

interface ViewCustomerSubscriptionsButtonProps {
  customer: Doc<'customers'>;
}

export default function ViewCustomerSubscriptionsButton({
  customer,
}: ViewCustomerSubscriptionsButtonProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="p-1 hover:bg-muted rounded"
          title="View Subscriptions"
        >
          <EyeIcon className="size-4 text-muted-foreground" />
        </button>
      </DialogTrigger>

      <CustomerInfoDialog customer={customer} />
    </Dialog>
  );
}
