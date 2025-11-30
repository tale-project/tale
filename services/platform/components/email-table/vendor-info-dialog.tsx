import {
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { VendorInformation } from './vendor-information';
import { Doc } from '@/convex/_generated/dataModel';

interface VendorInfoDialogProps {
  vendor: Doc<'vendors'>;
  className?: string;
}

export function VendorInfoDialog({ vendor, className }: VendorInfoDialogProps) {
  return (
    <DialogContent className={cn('p-0', className)}>
      <DialogHeader className="py-6 px-4 border-b">
        <DialogTitle>Vendor information</DialogTitle>
      </DialogHeader>
      <div className="px-4 pb-6 overflow-y-auto">
        <VendorInformation vendor={vendor} />
      </div>
    </DialogContent>
  );
}
