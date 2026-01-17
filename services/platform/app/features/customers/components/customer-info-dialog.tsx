'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { CustomerInformation } from './customer-information';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface CustomerInfoDialogProps {
  customer: Doc<'customers'>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function CustomerInfoDialog({
  customer,
  open,
  onOpenChange,
  className,
}: CustomerInfoDialogProps) {
  const { t } = useT('dialogs');
  return (
    <ViewDialog
      open={open ?? true}
      onOpenChange={onOpenChange ?? (() => {})}
      title={t('customerInfo.title')}
      className={className}
    >
      <div className="overflow-y-auto max-h-[calc(100vh-12rem)] space-y-8">
        <CustomerInformation customer={customer} />
      </div>
    </ViewDialog>
  );
}
