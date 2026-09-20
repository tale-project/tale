'use client';

import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
  type EntityRowAction,
} from '@tale/ui/entity/entity-row-actions';
import { useToast } from '@tale/ui/use-toast';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import {
  useCheckProviderDefinitionCatalog,
  useDeleteProviderDefinition,
} from '../hooks/mutations';
import type { ProviderCatalog } from '../hooks/queries';
import { mapProviderDefinitionError } from './provider-definition-form';

const DIALOGS = ['delete'] as const;

/**
 * What one custom provider row can be told to do: edit its definition, list
 * its models afresh (the reachability check for a new endpoint), delete it.
 *
 * Deleting is refused — here and by the server — while credentials still name
 * the provider: a key whose connector vanished keeps listing under its slug
 * but can serve nothing, so the operator retires the keys first, knowingly.
 */
export function CustomProviderRowActions({
  organizationId,
  provider,
  credentialCount,
  onEdit,
}: {
  organizationId: string;
  provider: ProviderCatalog;
  /** How many of the organization's credentials name this provider. */
  credentialCount: number;
  onEdit: () => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const check = useCheckProviderDefinitionCatalog(organizationId);
  const remove = useDeleteProviderDefinition(organizationId);
  const dialogs = useEntityRowDialogs([...DIALOGS]);
  const busy = check.isPending || remove.isPending;

  const handleCheck = async () => {
    try {
      const models = await check.mutateAsync({
        organizationId,
        name: provider.name,
      });
      toast({
        title: t('providers.custom.checkOk', {
          name: provider.displayName,
          count: models.length,
        }),
      });
    } catch (err) {
      console.error('providers: custom provider catalog check failed', err);
      toast({
        title: t('providers.custom.checkFailed', {
          name: provider.displayName,
          error: mapProviderDefinitionError(t, err),
        }),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({ organizationId, name: provider.name });
      toast({ title: t('providers.custom.deletedToast') });
      dialogs.setOpen.delete(false);
    } catch (err) {
      console.error('providers: delete custom provider failed', err);
      toast({
        title: t('providers.custom.deleteFailed', {
          error: mapProviderDefinitionError(t, err),
        }),
        variant: 'destructive',
      });
    }
  };

  const actions: EntityRowAction[] = [
    {
      key: 'edit',
      label: t('providers.custom.edit'),
      icon: Pencil,
      onClick: onEdit,
      disabled: busy,
    },
    {
      key: 'check',
      label: t('providers.custom.check'),
      icon: RefreshCw,
      onClick: () => void handleCheck(),
      // Nothing to list for a provider whose models come from credentials.
      visible: provider.catalogSource !== 'none',
      disabled: busy,
    },
    {
      key: 'delete',
      label: t('providers.custom.delete'),
      icon: Trash2,
      onClick: () => dialogs.setOpen.delete(true),
      separator: true,
      destructive: true,
      disabled: busy,
    },
  ];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('providers.custom.actionsLabel', {
          name: provider.displayName,
        })}
        contentWidth="w-max min-w-[12rem]"
      />
      <DeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        title={t('providers.custom.deleteTitle')}
        description={t('providers.custom.deleteBody', {
          name: provider.displayName,
        })}
        warning={
          credentialCount > 0
            ? t('providers.custom.deleteInUse', { count: credentialCount })
            : undefined
        }
        disableDelete={credentialCount > 0}
        isDeleting={remove.isPending}
        onDelete={() => void handleDelete()}
      />
    </>
  );
}
