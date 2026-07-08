'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Webhook, Copy, Check, Trash2 } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { maskSecretPreview } from '@/convex/sandbox/user_env_constants';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

import type { WfWebhook } from '../hooks/queries';
import { useWebhooks } from '../hooks/queries';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
} from '../hooks/slug-mutations';
import { useTriggerTimestamp } from '../hooks/use-trigger-timestamp';
import { CollapsibleSection } from './collapsible-section';
import { SecretRevealDialog } from './secret-reveal-dialog';

interface WebhooksSectionProps {
  workflowRootId: string;
  organizationId: string;
  workflowSlug: string;
}

type WebhookRow = WfWebhook;

export function WebhooksSection({
  workflowRootId: _workflowRootId,
  organizationId,
  workflowSlug,
}: WebhooksSectionProps) {
  const { t } = useT('automations');
  const { toast } = useToast();

  const { webhooks } = useWebhooks(organizationId, workflowSlug);

  const { mutateAsync: createWebhook, isPending: isCreating } =
    useCreateWebhook();
  const { mutateAsync: toggleWebhook } = useToggleWebhook();
  const { mutate: deleteWebhookMutation, isPending: isDeleting } =
    useDeleteWebhook();
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const siteUrl = useSiteUrl();
  const basePath = getEnv('BASE_PATH');

  const getWebhookUrl = useCallback(
    (token: string) => `${siteUrl}${basePath}/api/workflows/wh/${token}`,
    [siteUrl, basePath],
  );

  const handleCreate = useCallback(async () => {
    try {
      const result = await createWebhook({
        organizationId,
        workflowSlug,
      });
      setCreatedUrl(getWebhookUrl(result.token));
      toast({
        title: t('triggers.webhooks.toast.created'),
        variant: 'success',
      });
    } catch {
      toast({
        title: t('triggers.webhooks.toast.createFailed'),
        variant: 'destructive',
      });
    }
  }, [createWebhook, organizationId, workflowSlug, toast, t, getWebhookUrl]);

  const handleToggle = useCallback(
    async (webhookId: string, isActive: boolean) => {
      try {
        await toggleWebhook({
          webhookId: toId<'wfWebhooks'>(webhookId),
          isActive,
        });
        toast({
          title: isActive
            ? t('triggers.webhooks.toast.enabled')
            : t('triggers.webhooks.toast.disabled'),
          variant: 'success',
        });
      } catch {
        toast({
          title: t('triggers.webhooks.toast.toggleFailed'),
          variant: 'destructive',
        });
      }
    },
    [toggleWebhook, toast, t],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteWebhookMutation(
      { webhookId: deleteTarget._id },
      {
        onSuccess: () => {
          toast({
            title: t('triggers.webhooks.toast.deleted'),
            variant: 'success',
          });
          setDeleteTarget(null);
        },
        onError: () => {
          toast({
            title: t('triggers.webhooks.toast.deleteFailed'),
            variant: 'destructive',
          });
        },
      },
    );
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
      } catch (err) {
        console.warn('[webhooks-section] clipboard write failed', err);
        toast({
          title: t('triggers.common.copyFailed'),
          variant: 'destructive',
        });
      }
    },
    [getWebhookUrl, toast, t],
  );

  const formatTimestamp = useTriggerTimestamp();

  const columns = useMemo<ColumnDef<WebhookRow>[]>(
    () => [
      {
        id: 'url',
        header: t('triggers.webhooks.columns.url'),
        cell: ({ row }) => {
          // The token is the sole bearer credential (see the create dialog's
          // warning), so the table never renders it in plaintext: display the
          // URL with the token masked (same low-leak preview affordance as the
          // API-key UIs). The copy button still copies the full URL.
          const maskedUrl = getWebhookUrl(
            maskSecretPreview(row.original.token),
          );
          return (
            <Row gap={2} className="min-w-0">
              <code
                className="max-w-[300px] truncate font-mono text-sm"
                title={maskedUrl}
              >
                {maskedUrl}
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
            </Row>
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
          <Text as="span" variant="muted">
            {formatTimestamp(row.original.lastTriggeredAt)}
          </Text>
        ),
        size: 180,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Row gap={0} justify="end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t('triggers.webhooks.deleteWebhook')}
            >
              <Trash2 className="size-4" />
            </Button>
          </Row>
        ),
        size: 60,
      },
    ],
    [t, getWebhookUrl, handleToggle, handleCopyUrl, formatTimestamp, copiedUrl],
  );

  return (
    <CollapsibleSection
      id="webhooks"
      icon={Webhook}
      title={t('triggers.webhooks.title')}
      count={webhooks?.length ?? 0}
      defaultOpen={(webhooks?.length ?? 0) > 0}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCreate}
          disabled={isCreating}
        >
          <Plus className="mr-2 size-4" />
          {t('triggers.webhooks.createButton')}
        </Button>
      }
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
