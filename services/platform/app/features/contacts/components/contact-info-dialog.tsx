'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import type { Doc } from '@/convex/_generated/dataModel';
import type { ContactInfo } from '@/convex/conversations/types';
import { useT } from '@/lib/i18n/client';

import { ContactInformation } from './contact-information';

interface ContactInfoDialogProps {
  contact: Doc<'contacts'> | ContactInfo;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function ContactInfoDialog({
  contact,
  open,
  onOpenChange,
  className,
}: ContactInfoDialogProps) {
  const { t } = useT('dialogs');
  return (
    <ViewDialog
      open={open ?? true}
      onOpenChange={onOpenChange ?? (() => {})}
      title={t('contactInfo.title')}
      className={className}
    >
      <div className="max-h-[calc(100vh-12rem)] space-y-8 overflow-y-auto">
        <ContactInformation contact={contact} />
      </div>
    </ViewDialog>
  );
}
