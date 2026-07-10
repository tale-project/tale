'use client';

import { Badge } from '@tale/ui/badge';
import { Row } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { type ContactData, isContactDoc } from '../lib/contact-data';

interface InfoRowProps {
  label: string;
  children: React.ReactNode;
}

function InfoRow({ label, children }: InfoRowProps) {
  return (
    <Row gap={0} justify="between">
      <Text variant="muted" className="text-[13px]">
        {label}
      </Text>
      <div className="text-[13px]">{children}</div>
    </Row>
  );
}

export function ContactInfoCard({ contact }: { contact: ContactData }) {
  const { formatDate } = useFormatDate();
  const { t } = useT('common');

  const createdAt = useMemo(() => {
    if (isContactDoc(contact)) {
      return contact._creationTime
        ? formatDate(new Date(contact._creationTime), 'long')
        : null;
    }
    return contact.created_at
      ? formatDate(new Date(contact.created_at), 'long')
      : null;
  }, [contact, formatDate]);

  return (
    <>
      <div className="border-border space-y-0.5 border-b px-5 py-4">
        <Row gap={2}>
          <Text className="text-sm font-semibold tracking-tight">
            {contact.name || t('labels.notAvailable')}
          </Text>
        </Row>
        <Text variant="muted" className="text-xs tracking-tight break-all">
          {contact.email || t('labels.notAvailable')}
        </Text>
      </div>

      <div className="space-y-3.5 px-5 py-4">
        <InfoRow label={t('labels.created')}>
          <Text className="text-[13px]">
            {createdAt || t('labels.notAvailable')}
          </Text>
        </InfoRow>
        <InfoRow label={t('labels.locale')}>
          <Text className="text-[13px]">{contact.locale || 'en'}</Text>
        </InfoRow>
        <InfoRow label={t('labels.source')}>
          {contact.source ? (
            <Badge variant="outline">
              {contact.source
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase())}
            </Badge>
          ) : (
            <Text className="text-[13px]">{t('labels.notAvailable')}</Text>
          )}
        </InfoRow>
      </div>
    </>
  );
}

interface ContactInfoPopoverProps {
  contact: ContactData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
}

export function ContactInfoPopover({
  contact,
  open,
  onOpenChange,
  trigger,
}: ContactInfoPopoverProps) {
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      side="bottom"
      sideOffset={8}
      contentClassName="w-80 max-w-none p-0"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <ContactInfoCard contact={contact} />
    </Popover>
  );
}
