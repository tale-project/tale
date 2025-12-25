'use client';

import {
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { VendorInformation } from './vendor-information';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface VendorInfoDialogProps {
  vendor: Doc<'vendors'>;
  className?: string;
}

export function VendorInfoDialog({ vendor, className }: VendorInfoDialogProps) {
  const { t } = useT('dialogs');
  return (
    <DialogContent className={cn('p-0', className)}>
      <DialogHeader className="py-6 px-4 border-b">
        <DialogTitle>{t('vendorInfo.title')}</DialogTitle>
      </DialogHeader>
      <div className="px-4 pb-6 overflow-y-auto">
        <VendorInformation vendor={vendor} />
      </div>
    </DialogContent>
  );
}
