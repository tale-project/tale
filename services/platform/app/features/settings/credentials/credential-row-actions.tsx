'use client';

import { KeyRound, Pencil, Power, Star, Trash2 } from 'lucide-react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
  type EntityRowAction,
} from '@/app/components/ui/entity/entity-row-actions';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { CredentialEditDialog } from './credential-edit-dialog';
import { ReplaceSecretDialog } from './replace-secret-dialog';

const DIALOGS = ['edit', 'replace', 'delete'] as const;

/**
 * Everything one credential row can be told to do: make it the default, disable
 * it, replace its secret, edit its label, delete it — plus whatever the surface
 * adds (a connector's Reconnect).
 *
 * The copy is the shared `settings.credentials.*` namespace, not a per-surface
 * one: "Make default" and "Delete credential" mean the same thing whether the
 * secret belongs to a connector or an AI provider, and static keys keep the
 * i18n usage check able to see them.
 *
 * `vendor` is nullable because the credential table joins rows to a catalog
 * that can move underneath them — a provider YAML deleted from disk leaves its
 * stored keys behind. Such a row can still be disabled or deleted (the two
 * things an operator needs then), but not edited against a vendor definition
 * that no longer exists.
 */
export function CredentialRowActions<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  credential,
  vendor,
  adapter,
}: {
  organizationId: string;
  credential: Cred;
  vendor: V | null;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const setDefault = adapter.mutations.useSetDefault();
  const update = adapter.mutations.useUpdate();
  const remove = adapter.mutations.useDelete();
  const dialogs = useEntityRowDialogs([...DIALOGS]);

  const disabled = credential.status === 'disabled';
  const busy = setDefault.isPending || update.isPending || remove.isPending;

  const failToast = (err: unknown) =>
    toast({
      title: t('credentials.updateFailed', { error: adapter.mapError(err) }),
      variant: 'destructive',
    });

  const handleMakeDefault = async () => {
    try {
      await setDefault.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
    } catch (err) {
      console.error(`${adapter.logTag}: set default credential failed`, err);
      failToast(err);
    }
  };

  const handleToggleStatus = async () => {
    try {
      await update.mutateAsync({
        organizationId,
        credentialId: credential.id,
        status: disabled ? 'active' : 'disabled',
      });
    } catch (err) {
      console.error(`${adapter.logTag}: toggle credential status failed`, err);
      failToast(err);
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
      toast({ title: t('credentials.deletedToast') });
      dialogs.setOpen.delete(false);
    } catch (err) {
      console.error(`${adapter.logTag}: delete credential failed`, err);
      failToast(err);
    }
  };

  const method = adapter.methodOf(credential);
  // One source of truth for "is this replaceable": the same `null` that makes
  // the dialog render nothing also hides the action, so they cannot disagree.
  const replaceLabel =
    method === null ? null : adapter.secret.replaceTitle(t, method);
  const replaceable =
    method !== null &&
    replaceLabel !== null &&
    adapter.secret.hasFields(method);

  const actions: EntityRowAction[] = [
    ...(adapter.extraActions?.({ t, credential, organizationId, busy }) ?? []),
    {
      key: 'make-default',
      label: t('credentials.makeDefault'),
      icon: Star,
      onClick: () => void handleMakeDefault(),
      visible: !credential.isDefault,
      // A disabled credential cannot serve requests, so it cannot be the
      // fallback either. Visible but inert, so the rule is discoverable
      // rather than mysterious.
      disabled: disabled || busy,
    },
    {
      key: 'toggle-status',
      label: disabled ? t('credentials.enable') : t('credentials.disable'),
      icon: Power,
      onClick: () => void handleToggleStatus(),
      disabled: busy,
    },
    {
      key: 'replace-secret',
      label: replaceLabel ?? '',
      icon: KeyRound,
      onClick: () => dialogs.setOpen.replace(true),
      visible: replaceable,
      disabled: busy,
    },
    {
      key: 'edit',
      label: t('credentials.edit'),
      icon: Pencil,
      onClick: () => dialogs.setOpen.edit(true),
      visible: vendor !== null,
      disabled: busy,
    },
    {
      key: 'delete',
      label: t('credentials.delete'),
      icon: Trash2,
      onClick: () => dialogs.setOpen.delete(true),
      destructive: true,
      disabled: busy,
    },
  ];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('credentials.actionsLabel', { name: credential.name })}
        // Size to the longest label ("Replace username & password" / the DE
        // and FR equivalents) instead of a fixed narrow width that wraps the
        // text and hides Delete behind a scroll.
        contentWidth="w-max min-w-[14rem]"
      />

      {vendor !== null && (
        <CredentialEditDialog
          organizationId={organizationId}
          credential={credential}
          vendor={vendor}
          adapter={adapter}
          open={dialogs.isOpen.edit}
          onOpenChange={dialogs.setOpen.edit}
        />
      )}
      {replaceable && (
        <ReplaceSecretDialog
          organizationId={organizationId}
          credential={credential}
          vendor={vendor}
          adapter={adapter}
          open={dialogs.isOpen.replace}
          onOpenChange={dialogs.setOpen.replace}
        />
      )}
      <DeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        title={t('credentials.deleteTitle')}
        description={t('credentials.deleteBody', { name: credential.name })}
        warning={
          credential.isDefault
            ? t('credentials.deleteDefaultWarning')
            : undefined
        }
        isDeleting={remove.isPending}
        onDelete={() => void handleDelete()}
      />
    </>
  );
}
