'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { formatDate } from '@/lib/utils/date/format';

interface ViewWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

const SCAN_INTERVALS: Record<string, string> = {
  '60m': 'Every 1 hour',
  '6h': 'Every 6 hours',
  '12h': 'Every 12 hours',
  '1d': 'Every 1 day',
  '5d': 'Every 5 days',
  '7d': 'Every 7 days',
  '30d': 'Every 30 days',
};

export default function ViewWebsiteDialog({
  isOpen,
  onClose,
  website,
}: ViewWebsiteDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="py-2">Website Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Domain</Label>
              <Value>{website.domain}</Value>
            </div>

            <div>
              <Label>Status</Label>
              <Value>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      website.status === 'active'
                        ? 'bg-green-500'
                        : website.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                    }`}
                  />
                  {website.status || 'Unknown'}
                </div>
              </Value>
            </div>

            <div>
              <Label>Scan Interval</Label>
              <Value>
                {SCAN_INTERVALS[website.scanInterval] || website.scanInterval}
              </Value>
            </div>

            <div>
              <Label>Last Scanned</Label>
              <Value>
                {website.lastScannedAt
                  ? formatDate(new Date(website.lastScannedAt), {
                      preset: 'long',
                    })
                  : 'Not scanned yet'}
              </Value>
            </div>

            <div className="col-span-2">
              <Label>Title</Label>
              <Value>{website.title || '-'}</Value>
            </div>

            <div className="col-span-2">
              <Label>Description</Label>
              <Value className="whitespace-pre-wrap">
                {website.description || '-'}
              </Value>
            </div>

            <div>
              <Label>Created</Label>
              <Value>
                {formatDate(new Date(website._creationTime), {
                  preset: 'long',
                })}
              </Value>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium text-muted-foreground mb-1">
      {children}
    </div>
  );
}

function Value({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-sm text-foreground ${className || ''}`}>
      {children}
    </div>
  );
}
