'use client';

import { LabeledValue } from '@tale/ui/labeled-value';
import { HStack, Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type ContactData,
  getContactLocaleLabel,
  getContactSourceLabel,
  isContactDoc,
} from '../lib/contact-data';

interface ContactInformationProps {
  contact: ContactData;
}

export function ContactInformation({ contact }: ContactInformationProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('common');

  const isDoc = isContactDoc(contact);
  // phone/address/tags/notes live only on the full directory row, never on the
  // lightweight ContactInfo embedded in a conversation.
  const phone = isDoc ? contact.phone : undefined;
  const address = isDoc ? contact.address : undefined;
  const tags = isDoc ? contact.tags : undefined;
  const notes = isDoc ? contact.notes : undefined;

  const createdAt = isDoc
    ? contact._creationTime
      ? formatDate(new Date(contact._creationTime), 'long')
      : null
    : contact.created_at
      ? formatDate(new Date(contact.created_at), 'long')
      : null;

  const items = useMemo<StatGridItem[]>(
    () => [
      ...(phone
        ? [{ label: t('labels.phone'), value: <Text>{phone}</Text> }]
        : []),
      {
        label: t('labels.source'),
        value: (
          <Text>
            {getContactSourceLabel(contact.source, t('labels.notAvailable'))}
          </Text>
        ),
      },
      {
        label: t('labels.created'),
        value: <Text>{createdAt || t('labels.notAvailable')}</Text>,
      },
      {
        label: t('labels.locale'),
        value: <Text>{getContactLocaleLabel(contact.locale)}</Text>,
      },
    ],
    [contact, phone, createdAt, t],
  );

  return (
    <Stack gap={5}>
      <StatGrid items={items} />

      {address && (
        <LabeledValue label={t('labels.address')}>
          <Stack gap={1} className="text-sm">
            {address.street && <p>{address.street}</p>}
            {(address.city || address.state) && (
              <p>
                {address.city}
                {address.city && address.state && ', '}
                {address.state}
              </p>
            )}
            {address.postalCode && <p>{address.postalCode}</p>}
            {address.country && <p>{address.country}</p>}
          </Stack>
        </LabeledValue>
      )}

      {tags && tags.length > 0 && (
        <LabeledValue label={t('labels.tags')}>
          <HStack gap={2} className="flex-wrap">
            {tags.map((tag) => (
              <span key={tag} className="bg-muted rounded-md px-2 py-1 text-xs">
                {tag}
              </span>
            ))}
          </HStack>
        </LabeledValue>
      )}

      {notes && (
        <LabeledValue label={t('labels.notes')}>
          <Text>{notes}</Text>
        </LabeledValue>
      )}
    </Stack>
  );
}
