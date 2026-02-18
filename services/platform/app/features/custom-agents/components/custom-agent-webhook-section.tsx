'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Check, Code, Copy, Plus, Trash2, Webhook } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Alert } from '@/app/components/ui/feedback/alert';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
import { toId } from '@/lib/utils/type-guards';

import { SecretRevealDialog } from '../../automations/triggers/components/secret-reveal-dialog';
import {
  useCreateCustomAgentWebhook,
  useDeleteCustomAgentWebhook,
  useToggleCustomAgentWebhook,
} from '../hooks/mutations';
import {
  useCustomAgentVersions,
  useCustomAgentWebhooks,
  type CustomAgentWebhook,
} from '../hooks/queries';

interface CustomAgentWebhookSectionProps {
  organizationId: string;
  agentId: string;
}

type WebhookRow = CustomAgentWebhook;

export function CustomAgentWebhookSection({
  organizationId,
  agentId,
}: CustomAgentWebhookSectionProps) {
  const { t } = useT('settings');
  const { toast } = useToast();

  const { versions } = useCustomAgentVersions(agentId);
  const { webhooks } = useCustomAgentWebhooks(agentId);

  const { mutateAsync: createWebhook, isPending: isCreating } =
    useCreateCustomAgentWebhook();
  const { mutateAsync: toggleWebhook } = useToggleCustomAgentWebhook();
  const { mutate: deleteWebhookMutation, isPending: isDeleting } =
    useDeleteCustomAgentWebhook();

  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [usageTarget, setUsageTarget] = useState<WebhookRow | null>(null);

  const siteUrl = useSiteUrl();
  const isPublished = versions?.some((v) => v.status === 'active') ?? false;

  const getWebhookUrl = useCallback(
    (token: string) => `${siteUrl}/api/agents/wh/${token}`,
    [siteUrl],
  );

  const handleCreate = useCallback(async () => {
    try {
      const result = await createWebhook({
        organizationId,
        customAgentId: toId<'customAgents'>(agentId),
      });
      setCreatedUrl(getWebhookUrl(result.token));
      toast({
        title: t('customAgents.webhook.toast.created'),
        variant: 'success',
      });
    } catch {
      toast({
        title: t('customAgents.webhook.toast.createFailed'),
        variant: 'destructive',
      });
    }
  }, [createWebhook, organizationId, agentId, toast, t, getWebhookUrl]);

  const handleToggle = useCallback(
    async (webhookId: Id<'customAgentWebhooks'>, isActive: boolean) => {
      try {
        await toggleWebhook({ webhookId, isActive });
        toast({
          title: isActive
            ? t('customAgents.webhook.toast.enabled')
            : t('customAgents.webhook.toast.disabled'),
          variant: 'success',
        });
      } catch {
        toast({
          title: t('customAgents.webhook.toast.toggleFailed'),
          variant: 'destructive',
        });
      }
    },
    [toggleWebhook, t, toast],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteWebhookMutation(
      { webhookId: toId<'customAgentWebhooks'>(deleteTarget._id) },
      {
        onSuccess: () => {
          toast({
            title: t('customAgents.webhook.toast.deleted'),
            variant: 'success',
          });
          setDeleteTarget(null);
        },
        onError: () => {
          toast({
            title: t('customAgents.webhook.toast.deleteFailed'),
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
        setCopiedToken(token);
        toast({
          title: t('customAgents.webhook.toast.urlCopied'),
          variant: 'success',
        });
        setTimeout(() => setCopiedToken(null), 2000);
      } catch {
        // Clipboard API not available
      }
    },
    [getWebhookUrl, toast, t],
  );

  const formatDate = useCallback(
    (timestamp?: number) => {
      if (!timestamp) return t('customAgents.webhook.never');
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
        header: t('customAgents.webhook.columns.url'),
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
                aria-label={t('customAgents.webhook.copyUrl')}
                className="shrink-0"
              >
                {copiedToken === row.original.token ? (
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
        header: t('customAgents.webhook.columns.active'),
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(checked) =>
              handleToggle(row.original._id, checked)
            }
            aria-label={t('customAgents.webhook.columns.active')}
          />
        ),
        size: 80,
      },
      {
        id: 'lastTriggered',
        header: t('customAgents.webhook.columns.lastTriggered'),
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
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUsageTarget(row.original)}
              aria-label={t('customAgents.webhook.usageExamples')}
            >
              <Code className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t('customAgents.webhook.deleteWebhook')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
        size: 100,
      },
    ],
    [t, getWebhookUrl, handleToggle, handleCopyUrl, formatDate, copiedToken],
  );

  const usageUrl = usageTarget ? getWebhookUrl(usageTarget.token) : '';

  const usageExamples = useMemo(() => {
    if (!usageUrl) return [];
    return [
      {
        key: 'nonStreaming',
        label: t('customAgents.webhook.exampleNonStreaming'),
        code: `curl -X POST ${usageUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`,
      },
      {
        key: 'streaming',
        label: t('customAgents.webhook.exampleStreaming'),
        code: `curl -X POST ${usageUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello", "stream": true}'`,
      },
      {
        key: 'multiTurn',
        label: t('customAgents.webhook.exampleMultiTurn'),
        code: `curl -X POST ${usageUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Follow-up", "threadId": "THREAD_ID"}'`,
      },
      {
        key: 'fileUpload',
        label: t('customAgents.webhook.exampleFileUpload'),
        code: `curl -X POST ${usageUrl} \\\n  -F 'message=Analyze this image' \\\n  -F 'file=@/path/to/image.png'`,
      },
      {
        key: 'fileUploadStream',
        label: t('customAgents.webhook.exampleFileUploadStream'),
        code: `curl -N -X POST ${usageUrl} \\\n  -F 'message=Analyze this image' \\\n  -F 'file=@/path/to/image.png' \\\n  -F 'stream=true'`,
      },
    ];
  }, [usageUrl, t]);

  return (
    <div className="w-full px-6 py-4">
      <Stack gap={6}>
        <SectionHeader
          title={t('customAgents.webhook.title')}
          description={t('customAgents.webhook.description')}
        />

        {!isPublished && (
          <Alert
            variant="warning"
            description={t('customAgents.webhook.notPublished')}
          />
        )}

        <DataTable
          columns={columns}
          data={webhooks ?? []}
          caption={t('customAgents.webhook.title')}
          getRowId={(row) => row._id}
          emptyState={{
            icon: Webhook,
            title: t('customAgents.webhook.emptyTitle'),
            description: t('customAgents.webhook.emptyDescription'),
          }}
          actionMenu={
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCreate}
              disabled={isCreating}
            >
              <Plus className="mr-2 size-4" />
              {t('customAgents.webhook.createButton')}
            </Button>
          }
        />

        {createdUrl && (
          <SecretRevealDialog
            open={!!createdUrl}
            onOpenChange={() => setCreatedUrl(null)}
            title={t('customAgents.webhook.createdTitle')}
            warning={t('customAgents.webhook.urlWarning')}
            secrets={[
              {
                label: t('customAgents.webhook.webhookUrl'),
                value: createdUrl,
              },
            ]}
          />
        )}

        <Dialog
          open={!!usageTarget}
          onOpenChange={(open) => {
            if (!open) setUsageTarget(null);
          }}
          title={t('customAgents.webhook.usageExamples')}
          description={t('customAgents.webhook.usageExamplesDescription')}
          size="lg"
        >
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {usageExamples.map((example) => (
              <CodeBlock
                key={example.key}
                label={example.label}
                copyValue={example.code}
                copyLabel={t('customAgents.webhook.copyUrl')}
              >
                {example.code}
              </CodeBlock>
            ))}
          </div>
        </Dialog>

        <DeleteDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t('customAgents.webhook.deleteTitle')}
          description={t('customAgents.webhook.deleteDescription')}
          isDeleting={isDeleting}
          onDelete={handleDelete}
        />
      </Stack>
    </div>
  );
}
