'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { VendorInformation } from './vendor-information';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface VendorInfoDialogProps {
  vendor: Doc<'vendors'>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function VendorInfoDialog({
  vendor,
  open,
  onOpenChange,
  className,
}: VendorInfoDialogProps) {
  const { t } = useT('dialogs');
  return (
    <ViewDialog
      open={open ?? true}
      onOpenChange={onOpenChange ?? (() => {})}
      title={t('vendorInfo.title')}
      className={className}
    >
      <div className="overflow-y-auto">
        <VendorInformation vendor={vendor} />
      </div>
    </ViewDialog>
  );
}
