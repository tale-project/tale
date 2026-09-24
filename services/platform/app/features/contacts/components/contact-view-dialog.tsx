'use client';

import { Badge } from '@tale/ui/badge';
import { EntityViewDialog } from '@tale/ui/entity/entity-view-dialog';
import { Row, Stack } from '@tale/ui/layout';
import type { StatGridItem } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useNavigate } from '@tanstack/react-router';
import { Mail, User } from 'lucide-react';
import { type RefObject, useMemo } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import {
  canEmailContact,
  getContactLocaleLabel,
  getContactSourceLabel,
  isEditableContact,
} from '../lib/contact-data';
import { ContactEditDialog } from './contact-edit-dialog';

interface ContactViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contact: ContactDoc;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Read-only contact details (row click or the row menu's View). Offers the
 * same Edit / New email shortcuts as the row menu (#2639), gated the same way,
 * so a user can act on what they're looking at without closing it.
 */
export function ContactViewDialog({
  isOpen,
  onClose,
  contact,
  restoreFocusRef,
}: ContactViewDialogProps) {
  const { t: tDialogs } = useT('dialogs');
  const { t: tCommon } = useT('common');
  const { t: tContacts } = useT('contacts');
  const { t: tConversations } = useT('conversations');
  const { formatDate } = useFormatDate();
  const navigate = useNavigate();
  const ability = useAbility();
  const canEdit =
    ability.can('write', 'knowledgeWrite') && isEditableContact(contact);
  const notAvailable = tCommon('labels.notAvailable');

  const facts = useMemo<StatGridItem[]>(
    () => [
      ...(contact.email
        ? [
            {
              label: tContacts('email'),
              value: <Text>{contact.email}</Text>,
            },
          ]
        : []),
      ...(contact.phone
        ? [
            {
              label: tCommon('labels.phone'),
              value: <Text>{contact.phone}</Text>,
            },
          ]
        : []),
      {
        label: tCommon('labels.source'),
        value: (
          <Text>{getContactSourceLabel(contact.source, notAvailable)}</Text>
        ),
      },
      {
        label: tCommon('labels.locale'),
        value: <Text>{getContactLocaleLabel(contact.locale)}</Text>,
      },
      {
        label: tCommon('labels.created'),
        value: (
          <Text>{formatDate(new Date(contact._creationTime), 'long')}</Text>
        ),
      },
      ...(contact.address
        ? [
            {
              label: tCommon('labels.address'),
              value: (
                <Stack gap={0}>
                  {contact.address.street && (
                    <Text>{contact.address.street}</Text>
                  )}
                  {(contact.address.city || contact.address.state) && (
                    <Text>
                      {[contact.address.city, contact.address.state]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                  )}
                  {contact.address.postalCode && (
                    <Text>{contact.address.postalCode}</Text>
                  )}
                  {contact.address.country && (
                    <Text>{contact.address.country}</Text>
                  )}
                </Stack>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
      ...(contact.tags && contact.tags.length > 0
        ? [
            {
              label: tCommon('labels.tags'),
              value: (
                <Row gap={2} wrap>
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </Row>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
      ...(contact.notes
        ? [
            {
              label: tCommon('labels.notes'),
              value: (
                <Text className="leading-relaxed whitespace-pre-wrap">
                  {contact.notes}
                </Text>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
    ],
    [contact, tCommon, tContacts, formatDate, notAvailable],
  );

  return (
    <EntityViewDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={tDialogs('contactInfo.title')}
      name={contact.name || contact.email || notAvailable}
      icon={User}
      edit={
        canEdit
          ? {
              label: tCommon('actions.edit'),
              render: ({ onBack, onDone }) => (
                <ContactEditDialog
                  isOpen
                  onClose={onBack}
                  onSaved={onDone}
                  restoreFocusRef={restoreFocusRef}
                  contact={contact}
                />
              ),
            }
          : undefined
      }
      actions={[
        {
          key: 'email',
          label: tConversations('compose.newEmail'),
          icon: Mail,
          // Opens the inbox's compose pane, seeded with this contact — the
          // same surface as the row menu's New email.
          onClick: () => {
            onClose();
            void navigate({
              to: '/dashboard/$id/conversations/$status',
              params: { id: contact.organizationId, status: 'open' },
              search: { compose: 'new', composeContact: contact._id },
            });
          },
          visible: canEmailContact(contact),
        },
      ]}
      identifier={{
        label: tDialogs('contactInfo.contactId'),
        value: contact._id,
      }}
      facts={facts}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
