import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { useRef, type RefObject } from 'react';

import type { SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

/** The control a dialog opened from a row gives the focus back to. */
export type ReturnPoint = RefObject<HTMLElement | null>;

interface SecretRowActionsProps {
  secret: SecretSummary;
  onView: (secret: SecretSummary, returnTo: ReturnPoint) => void;
  onEdit: (secret: SecretSummary, returnTo: ReturnPoint) => void;
  onDelete: (secret: SecretSummary, returnTo: ReturnPoint) => void;
}

/**
 * The menu at the end of a row: read it, change it, delete it. The dialogs it
 * opens get the menu button to return the focus to: the menu item that opened
 * them is gone when they close, and a dialog that hands over to another (the
 * form that replaces the details, the details that come back) has lost track
 * of who asked by then.
 */
export function SecretRowActions({
  secret,
  onView,
  onEdit,
  onDelete,
}: SecretRowActionsProps) {
  const { t } = useT('secrets');
  const { t: tCommon } = useT('common');
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <EntityRowActions
      ariaLabel={t('table.actionsFor', { title: secret.title })}
      triggerRef={menuButton}
      actions={[
        {
          key: 'view',
          label: t('actions.view'),
          icon: Eye,
          onClick: () => onView(secret, menuButton),
        },
        {
          key: 'edit',
          label: t('actions.edit'),
          icon: Pencil,
          onClick: () => onEdit(secret, menuButton),
        },
        {
          key: 'delete',
          label: tCommon('actions.delete'),
          icon: Trash2,
          onClick: () => onDelete(secret, menuButton),
          destructive: true,
        },
      ]}
    />
  );
}
