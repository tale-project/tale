'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Plus, Webhook, Copy, Check, Trash2, Code } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
import { toId } from '@/lib/utils/type-guards';

import { SecretRevealDialog } from '../../automations/triggers/components/secret-reveal-dialog';
import {
  useCustomAgentVersionCollection,
  useCustomAgentWebhookCollection,
} from '../hooks/collections';
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

  const customAgentVersionCollection = useCustomAgentVersionCollection(agentId);
  const { versions } = useCustomAgentVersions(customAgentVersionCollection);
  const customAgentWebhookCollection = useCustomAgentWebhookCollection(agentId);
  const { webhooks } = useCustomAgentWebhooks(customAgentWebhookCollection);

  const { mutateAsync: createWebhook, isPending: isCreating } =
    useCreateCustomAgentWebhook();
  const toggleWebhook = useToggleCustomAgentWebhook(
    customAgentWebhookCollection,
  );
  const deleteWebhookMutation = useDeleteCustomAgentWebhook(
    customAgentWebhookCollection,
  );

  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [usageTarget, setUsageTarget] = useState<WebhookRow | null>(null);
  const [copiedExample, setCopiedExample] = useState<string | null>(null);

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
    [toggleWebhook, toast, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteWebhookMutation({ webhookId: deleteTarget._id });
      toast({
        title: t('customAgents.webhook.toast.deleted'),
        variant: 'success',
      });
      setDeleteTarget(null);
    } catch {
      toast({
        title: t('customAgents.webhook.toast.deleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
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

  const handleCopyExample = useCallback(async (key: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedExample(key);
      setTimeout(() => setCopiedExample(null), 2000);
    } catch {
      // Clipboard API not available
    }
  }, []);

  return (
    <div className="w-full px-6 py-4">
      <Stack gap={6}>
        <Stack gap={1}>
          <h2 className="text-base font-semibold">
            {t('customAgents.webhook.title')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('customAgents.webhook.description')}
          </p>
        </Stack>

        {!isPublished && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
            role="alert"
          >
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t('customAgents.webhook.notPublished')}
            </p>
          </div>
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
              variant="outline"
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
            if (!open) {
              setUsageTarget(null);
              setCopiedExample(null);
            }
          }}
          title={t('customAgents.webhook.usageExamples')}
          description={t('customAgents.webhook.usageExamplesDescription')}
          size="lg"
        >
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {usageExamples.map((example) => (
              <div key={example.key}>
                <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                  {example.label}
                </p>
                <div className="group relative">
                  <pre className="bg-muted rounded-md p-3 pr-10 font-mono text-xs break-all whitespace-pre-wrap">
                    {example.code}
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => handleCopyExample(example.key, example.code)}
                    aria-label={t('customAgents.webhook.copyUrl')}
                  >
                    {copiedExample === example.key ? (
                      <Check className="size-3.5 text-green-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
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
