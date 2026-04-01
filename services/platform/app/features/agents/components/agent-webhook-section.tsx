'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Check, Code, Copy, Plus, Trash2, Webhook } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { ContentArea } from '@/app/components/layout/content-area';
import { CodeBlock } from '@/app/components/ui/data-display/code-block';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Alert } from '@/app/components/ui/feedback/alert';
import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

import { SecretRevealDialog } from '../../automations/triggers/components/secret-reveal-dialog';
import {
  useCreateAgentWebhook,
  useDeleteAgentWebhook,
  useToggleAgentWebhook,
} from '../hooks/mutations';
import { useAgentWebhooks, type AgentWebhook } from '../hooks/queries';

interface AgentWebhookSectionProps {
  organizationId: string;
  agentSlug: string;
}

type WebhookRow = AgentWebhook;

export function AgentWebhookSection({
  organizationId,
  agentSlug,
}: AgentWebhookSectionProps) {
  const { t } = useT('settings');
  const { toast } = useToast();

  const { webhooks } = useAgentWebhooks(organizationId, agentSlug);

  const { mutateAsync: createWebhook, isPending: isCreating } =
    useCreateAgentWebhook();
  const { mutateAsync: toggleWebhook } = useToggleAgentWebhook();
  const { mutate: deleteWebhookMutation, isPending: isDeleting } =
    useDeleteAgentWebhook();

  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [usageTarget, setUsageTarget] = useState<WebhookRow | null>(null);

  const siteUrl = useSiteUrl();
  const basePath = getEnv('BASE_PATH');
  const isPublished = true; // All agents are live in the file-based architecture

  const getWebhookUrl = useCallback(
    (token: string) => `${siteUrl}${basePath}/api/agents/wh/${token}`,
    [siteUrl, basePath],
  );

  const handleCreate = useCallback(async () => {
    try {
      const result = await createWebhook({
        organizationId,
        agentSlug,
      });
      setCreatedUrl(getWebhookUrl(result.token));
      toast({
        title: t('agents.webhook.toast.created'),
        variant: 'success',
      });
    } catch {
      toast({
        title: t('agents.webhook.toast.createFailed'),
        variant: 'destructive',
      });
    }
  }, [createWebhook, organizationId, agentSlug, toast, t, getWebhookUrl]);

  const handleToggle = useCallback(
    async (webhookId: Id<'agentWebhooks'>, isActive: boolean) => {
      try {
        await toggleWebhook({ webhookId, isActive });
        toast({
          title: isActive
            ? t('agents.webhook.toast.enabled')
            : t('agents.webhook.toast.disabled'),
          variant: 'success',
        });
      } catch {
        toast({
          title: t('agents.webhook.toast.toggleFailed'),
          variant: 'destructive',
        });
      }
    },
    [toggleWebhook, t, toast],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteWebhookMutation(
      { webhookId: toId<'agentWebhooks'>(deleteTarget._id) },
      {
        onSuccess: () => {
          toast({
            title: t('agents.webhook.toast.deleted'),
            variant: 'success',
          });
          setDeleteTarget(null);
        },
        onError: () => {
          toast({
            title: t('agents.webhook.toast.deleteFailed'),
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
          title: t('agents.webhook.toast.urlCopied'),
          variant: 'success',
        });
        setTimeout(() => setCopiedToken(null), 2000);
      } catch {
        // Clipboard API not available
      }
    },
    [getWebhookUrl, toast, t],
  );

  const { formatDate: formatDateLong } = useFormatDate();
  const formatTimestamp = useCallback(
    (timestamp?: number) => {
      if (!timestamp) return t('agents.webhook.never');
      return formatDateLong(new Date(timestamp), 'long');
    },
    [t, formatDateLong],
  );

  const columns = useMemo<ColumnDef<WebhookRow>[]>(
    () => [
      {
        id: 'url',
        header: t('agents.webhook.columns.url'),
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
                aria-label={t('agents.webhook.copyUrl')}
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
        header: t('agents.webhook.columns.active'),
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(checked) =>
              handleToggle(row.original._id, checked)
            }
            aria-label={t('agents.webhook.columns.active')}
          />
        ),
        size: 80,
      },
      {
        id: 'lastTriggered',
        header: t('agents.webhook.columns.lastTriggered'),
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
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUsageTarget(row.original)}
              aria-label={t('agents.webhook.usageExamples')}
            >
              <Code className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t('agents.webhook.deleteWebhook')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
        size: 100,
      },
    ],
    [
      t,
      getWebhookUrl,
      handleToggle,
      handleCopyUrl,
      formatTimestamp,
      copiedToken,
    ],
  );

  const usageUrl = usageTarget ? getWebhookUrl(usageTarget.token) : '';

  const usageExamples = useMemo(() => {
    if (!usageUrl) return [];
    return [
      {
        key: 'nonStreaming',
        label: t('agents.webhook.exampleNonStreaming'),
        code: `curl -X POST ${usageUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`,
      },
      {
        key: 'streaming',
        label: t('agents.webhook.exampleStreaming'),
        code: `curl -X POST ${usageUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello", "stream": true}'`,
      },
      {
        key: 'multiTurn',
        label: t('agents.webhook.exampleMultiTurn'),
        code: `curl -X POST ${usageUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Follow-up", "threadId": "THREAD_ID"}'`,
      },
      {
        key: 'fileUpload',
        label: t('agents.webhook.exampleFileUpload'),
        code: `curl -X POST ${usageUrl} \\\n  -F 'message=Analyze this image' \\\n  -F 'file=@/path/to/image.png'`,
      },
      {
        key: 'fileUploadStream',
        label: t('agents.webhook.exampleFileUploadStream'),
        code: `curl -N -X POST ${usageUrl} \\\n  -F 'message=Analyze this image' \\\n  -F 'file=@/path/to/image.png' \\\n  -F 'stream=true'`,
      },
    ];
  }, [usageUrl, t]);

  return (
    <ContentArea variant="panel" gap={6}>
      <PageSection
        title={t('agents.webhook.title')}
        description={t('agents.webhook.description')}
      >
        {!isPublished && (
          <Alert
            variant="warning"
            description={t('agents.webhook.notPublished')}
          />
        )}

        <DataTable
          columns={columns}
          data={webhooks ?? []}
          caption={t('agents.webhook.title')}
          getRowId={(row) => row._id}
          emptyState={{
            icon: Webhook,
            title: t('agents.webhook.emptyTitle'),
            description: t('agents.webhook.emptyDescription'),
          }}
          actionMenu={
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCreate}
              disabled={isCreating}
            >
              <Plus className="mr-2 size-4" />
              {t('agents.webhook.createButton')}
            </Button>
          }
        />

        {createdUrl && (
          <SecretRevealDialog
            open={!!createdUrl}
            onOpenChange={() => setCreatedUrl(null)}
            title={t('agents.webhook.createdTitle')}
            warning={t('agents.webhook.urlWarning')}
            secrets={[
              {
                label: t('agents.webhook.webhookUrl'),
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
          title={t('agents.webhook.usageExamples')}
          description={t('agents.webhook.usageExamplesDescription')}
          size="lg"
        >
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {usageExamples.map((example) => (
              <CodeBlock
                key={example.key}
                label={example.label}
                copyValue={example.code}
                copyLabel={t('agents.webhook.copyExample')}
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
          title={t('agents.webhook.deleteTitle')}
          description={t('agents.webhook.deleteDescription')}
          isDeleting={isDeleting}
          onDelete={handleDelete}
        />
      </PageSection>
    </ContentArea>
  );
}
