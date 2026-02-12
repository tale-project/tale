'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Plus, Webhook, Copy, Check, Trash2 } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WfWebhook } from '@/lib/collections/entities/wf-webhooks';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

import { useWebhookCollection } from '../hooks/collections';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
} from '../hooks/mutations';
import { useWebhooks } from '../hooks/queries';
import { CollapsibleSection } from './collapsible-section';
import { SecretRevealDialog } from './secret-reveal-dialog';

interface WebhooksSectionProps {
  workflowRootId: Id<'wfDefinitions'>;
  organizationId: string;
}

type WebhookRow = WfWebhook;

export function WebhooksSection({
  workflowRootId,
  organizationId,
}: WebhooksSectionProps) {
  const { t } = useT('automations');
  const { toast } = useToast();

  const webhookCollection = useWebhookCollection(workflowRootId);
  const { webhooks } = useWebhooks(webhookCollection);

  const createWebhook = useCreateWebhook();
  const toggleWebhook = useToggleWebhook(webhookCollection);
  const deleteWebhookMutation = useDeleteWebhook(webhookCollection);

  const [isCreating, setIsCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const siteUrl = useSiteUrl();

  const getWebhookUrl = useCallback(
    (token: string) => `${siteUrl}/api/workflows/wh/${token}`,
    [siteUrl],
  );

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    try {
      const result = await createWebhook({
        organizationId,
        workflowRootId,
      });
      setCreatedUrl(getWebhookUrl(result.token));
      toast({
        title: t('triggers.webhooks.toast.created'),
        variant: 'success',
      });
    } catch {
      toast({ title: 'Failed to create webhook', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  }, [createWebhook, organizationId, workflowRootId, toast, t, getWebhookUrl]);

  const handleToggle = useCallback(
    async (webhookId: Id<'wfWebhooks'>, isActive: boolean) => {
      try {
        await toggleWebhook({ webhookId, isActive });
        toast({
          title: isActive
            ? t('triggers.webhooks.toast.enabled')
            : t('triggers.webhooks.toast.disabled'),
          variant: 'success',
        });
      } catch {
        toast({ title: 'Failed to toggle webhook', variant: 'destructive' });
      }
    },
    [toggleWebhook, toast, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteWebhookMutation({ webhookId: deleteTarget._id });
      toast({
        title: t('triggers.webhooks.toast.deleted'),
        variant: 'success',
      });
      setDeleteTarget(null);
    } catch {
      toast({ title: 'Failed to delete webhook', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteWebhookMutation, toast, t]);

  const handleCopyUrl = useCallback(
    async (token: string) => {
      const url = getWebhookUrl(token);
      try {
        await navigator.clipboard.writeText(url);
        setCopiedUrl(token);
        toast({
          title: t('triggers.webhooks.toast.urlCopied'),
          variant: 'success',
        });
        setTimeout(() => setCopiedUrl(null), 2000);
      } catch {
        // Clipboard API not available
      }
    },
    [getWebhookUrl, toast, t],
  );

  const formatDate = useCallback(
    (timestamp?: number) => {
      if (!timestamp) return t('triggers.common.never');
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(timestamp));
    },
    [t],
  );

  const columns = useMemo<ColumnDef<WebhookRow>[]>(
    () => [
      {
        id: 'url',
        header: t('triggers.webhooks.columns.url'),
        cell: ({ row }) => {
          const url = getWebhookUrl(row.original.token);
          return (
            <div className="flex min-w-0 items-center gap-2">
              <code
                className="max-w-[300px] truncate font-mono text-sm"
                title={url}
              >
                {url}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyUrl(row.original.token)}
                aria-label={t('triggers.webhooks.webhookUrl')}
                className="shrink-0"
              >
                {copiedUrl === row.original.token ? (
                  <Check className="size-3.5 text-green-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
          );
        },
        size: 400,
      },
      {
        id: 'active',
        header: t('triggers.webhooks.columns.active'),
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(checked) =>
              handleToggle(row.original._id, checked)
            }
            aria-label={t('triggers.webhooks.columns.active')}
          />
        ),
        size: 80,
      },
      {
        id: 'lastTriggered',
        header: t('triggers.webhooks.columns.lastTriggered'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.lastTriggeredAt)}
          </span>
        ),
        size: 180,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label="Delete webhook"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
        size: 60,
      },
    ],
    [t, getWebhookUrl, handleToggle, handleCopyUrl, formatDate, copiedUrl],
  );

  return (
    <CollapsibleSection
      id="webhooks"
      icon={Webhook}
      title={t('triggers.webhooks.title')}
    >
      <DataTable
        columns={columns}
        data={webhooks ?? []}
        caption={t('triggers.webhooks.title')}
        getRowId={(row) => row._id}
        emptyState={{
          icon: Webhook,
          title: t('triggers.webhooks.emptyTitle'),
          description: t('triggers.webhooks.emptyDescription'),
        }}
        actionMenu={
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={isCreating}
          >
            <Plus className="mr-2 size-4" />
            {t('triggers.webhooks.createButton')}
          </Button>
        }
      />

      {createdUrl && (
        <SecretRevealDialog
          open={!!createdUrl}
          onOpenChange={() => setCreatedUrl(null)}
          title={t('triggers.webhooks.createdTitle')}
          warning={t('triggers.webhooks.urlWarning')}
          secrets={[
            {
              label: t('triggers.webhooks.webhookUrl'),
              value: createdUrl,
            },
          ]}
        />
      )}

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('triggers.webhooks.deleteTitle')}
        description={t('triggers.webhooks.deleteDescription')}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
    </CollapsibleSection>
  );
}
