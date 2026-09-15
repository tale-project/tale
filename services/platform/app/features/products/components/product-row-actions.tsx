'use client';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import { ExternalLink, Eye, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import type { Product } from '../hooks/use-products-table-config';
import { ProductDeleteDialog } from './product-delete-dialog';
import { ProductEditDialog } from './product-edit-dialog';
import { ProductViewDialog } from './product-view-dialog';

interface ProductRowActionsProps {
  product: Product;
}

export function ProductRowActions({ product }: ProductRowActionsProps) {
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  // Dialogs opened from the menu return focus to its trigger: the menu item
  // that opened them is gone by the time they close.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);
  const sourceUrl =
    typeof product.metadata?.url === 'string' ? product.metadata.url : null;

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCommon('actions.view'),
        icon: Eye,
        onClick: dialogs.open.view,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        visible: canWrite,
      },
      {
        key: 'external',
        label: tCommon('actions.viewSource'),
        icon: ExternalLink,
        onClick: () => {
          if (sourceUrl)
            window.open(sourceUrl, '_blank', 'noopener,noreferrer');
        },
        visible: sourceUrl !== null,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: canWrite,
      },
    ],
    [tCommon, dialogs.open, sourceUrl, canWrite],
  );

  return (
    <>
      <EntityRowActions actions={actions} triggerRef={menuTriggerRef} />

      {dialogs.isOpen.view && (
        <ProductViewDialog
          isOpen
          onClose={() => dialogs.setOpen.view(false)}
          restoreFocusRef={menuTriggerRef}
          product={product}
        />
      )}

      {dialogs.isOpen.edit && (
        <ProductEditDialog
          isOpen
          onClose={() => dialogs.setOpen.edit(false)}
          restoreFocusRef={menuTriggerRef}
          product={product}
        />
      )}

      {dialogs.isOpen.delete && (
        <ProductDeleteDialog
          isOpen
          onClose={() => dialogs.setOpen.delete(false)}
          restoreFocusRef={menuTriggerRef}
          product={product}
        />
      )}
    </>
  );
}
