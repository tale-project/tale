'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { CustomerInformation } from './customer-information';

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
      <div className="max-h-[calc(100vh-12rem)] space-y-8 overflow-y-auto">
        <CustomerInformation customer={customer} />
      </div>
    </ViewDialog>
  );
}
