'use client';

import { Dialog } from '@/components/ui/dialog';
import { EyeIcon } from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { DialogTrigger } from '@radix-ui/react-dialog';
import { Doc } from '@/convex/_generated/dataModel';

import { Button } from '@/components/ui/button';

interface ViewCustomerButtonProps {
  customer: Doc<'customers'>;
}

export default function ViewCustomerButton({
  customer,
}: ViewCustomerButtonProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="View Subscriptions">
          <EyeIcon className="size-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>

      <CustomerInfoDialog customer={customer} />
    </Dialog>
  );
}
