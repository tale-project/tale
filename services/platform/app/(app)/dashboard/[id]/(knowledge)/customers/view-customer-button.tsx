'use client';

import { Dialog } from '@/components/ui/dialog';
import { EyeIcon } from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { DialogTrigger } from '@radix-ui/react-dialog';
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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t('viewSubscriptions')}>
          <EyeIcon className="size-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>

      <CustomerInfoDialog customer={customer} />
    </Dialog>
  );
}
