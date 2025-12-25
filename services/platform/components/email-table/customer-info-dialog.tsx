'use client';

import {
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { CustomerInformation } from './customer-information';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface CustomerInfoDialogProps {
  customer: Doc<'customers'>;
  className?: string;
}

export function CustomerInfoDialog({
  customer,
  className,
}: CustomerInfoDialogProps) {
  const { t } = useT('dialogs');
  return (
    <DialogContent className={cn('p-0 gap-0', className)}>
      <DialogHeader className="px-4 py-6 border-b border-border">
        <DialogTitle>{t('customerInfo.title')}</DialogTitle>
      </DialogHeader>
      <div className="p-4 overflow-y-auto max-h-[calc(100vh-12rem)] space-y-8">
        <CustomerInformation customer={customer} />
      </div>
    </DialogContent>
  );
}
