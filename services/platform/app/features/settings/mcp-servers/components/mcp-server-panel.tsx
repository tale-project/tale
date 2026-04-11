'use client';

import { useAction } from 'convex/react';
import { CheckCircle2, Loader2, ShieldAlert, Wrench, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { type McpServerFormData, McpServerForm } from './mcp-server-form';
import type { McpServerListItem } from './types';

interface McpServerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: McpServerListItem;
  onDeleted: () => void;
  onUpdated: () => void;
}

export function McpServerPanel({
  open,
  onOpenChange,
  server,
  onDeleted,
  onUpdated,
}: McpServerPanelProps) {
  const { t } = useT('mcpServers');
  const { t: tCommon } = useT('common');

  const testConnectionAction = useAction(
    api.mcp_servers.actions.testConnection,
  );
  const updateAction = useAction(api.mcp_servers.public_mutations.update);
  const removeAction = useAction(api.mcp_servers.public_mutations.remove);
  const updateStatusAction = useAction(
    api.mcp_servers.public_mutations.updateStatus,
  );

  const [isTesting, setIsTesting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    toolCount?: number;
    error?: string;
  } | null>(null);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnectionAction({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- server._id is a string at runtime; Convex actions require branded Id type
        id: server._id as Id<'mcpServers'>,
      });
      setTestResult(result);
      if (result.success) {
        toast({ title: t('connected'), variant: 'success' });
        onUpdated();
      }
    } catch {
      setTestResult({ success: false, error: 'Connection test failed' });
    } finally {
      setIsTesting(false);
    }
  }, [testConnectionAction, server._id, t, onUpdated]);

  const handleUpdate = useCallback(
    async (data: McpServerFormData) => {
      setIsSubmitting(true);
      try {
        await updateAction({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- server._id is a string at runtime; Convex actions require branded Id type
          id: server._id as Id<'mcpServers'>,
          displayName: data.displayName,
          description: data.description,
          transportType: data.transportType,
          url: data.url,
          command: data.command,
          args: data.args,
          authType: data.authType,
          apiKey: data.apiKey,
          oauth2Config: data.oauth2Config,
        });
        toast({ title: t('saved'), variant: 'success' });
        setIsEditing(false);
        onUpdated();
      } catch {
        toast({
          title: t('error'),
          variant: 'destructive',
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [updateAction, server._id, t, onUpdated],
  );

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await removeAction({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- server._id is a string at runtime; Convex actions require branded Id type
        id: server._id as Id<'mcpServers'>,
      });
      toast({ title: t('deleted'), variant: 'success' });
      onOpenChange(false);
      onDeleted();
    } catch {
      toast({
        title: t('error'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }, [removeAction, server._id, t, onOpenChange, onDeleted]);

  const handleToggleStatus = useCallback(async () => {
    const newStatus = server.status === 'active' ? 'inactive' : 'active';
    try {
      await updateStatusAction({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- server._id is a string at runtime; Convex actions require branded Id type
        id: server._id as Id<'mcpServers'>,
        status: newStatus,
      });
      onUpdated();
    } catch {
      toast({ title: t('error'), variant: 'destructive' });
    }
  }, [updateStatusAction, server._id, server.status, onUpdated, t]);

  const discoveredTools = server.discoveredTools ?? [];

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={server.displayName}
        size="md"
        hideClose
        className="flex flex-col gap-0 p-0"
      >
        <HStack
          justify="between"
          align="center"
          className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
        >
          <Text variant="label" className="text-base font-semibold">
            {isEditing ? t('editServer') : server.displayName}
          </Text>
          <IconButton
            icon={X}
            aria-label={tCommon('aria.close')}
            variant="ghost"
            onClick={() => onOpenChange(false)}
          />
        </HStack>

        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          {isEditing ? (
            <McpServerForm
              server={server}
              isSubmitting={isSubmitting}
              onSubmit={handleUpdate}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <Stack gap={6}>
              <Stack gap={3}>
                <HStack gap={2} align="center">
                  <Badge
                    variant={
                      server.status === 'active'
                        ? 'green'
                        : server.status === 'error'
                          ? 'destructive'
                          : 'outline'
                    }
                    dot={server.status === 'active'}
                  >
                    {server.status === 'active'
                      ? t('connected')
                      : server.status === 'error'
                        ? t('error')
                        : t('disconnected')}
                  </Badge>
                  <Badge variant="blue">
                    {server.transportType === 'stdio'
                      ? 'stdio'
                      : server.transportType === 'sse'
                        ? 'SSE'
                        : 'HTTP'}
                  </Badge>
                  {server.authType !== 'none' && (
                    <Badge variant="outline">
                      {server.authType === 'api_key' ? 'API Key' : 'OAuth 2.0'}
                    </Badge>
                  )}
                </HStack>

                {server.description && (
                  <Text variant="muted">{server.description}</Text>
                )}

                {server.url && (
                  <Stack gap={1}>
                    <Text variant="label" className="text-xs">
                      URL
                    </Text>
                    <Text className="font-mono text-sm break-all">
                      {server.url}
                    </Text>
                  </Stack>
                )}

                {server.command && (
                  <Stack gap={1}>
                    <Text variant="label" className="text-xs">
                      {t('form.command')}
                    </Text>
                    <Text className="font-mono text-sm">
                      {server.command}
                      {server.args?.length ? ' ' + server.args.join(' ') : ''}
                    </Text>
                  </Stack>
                )}

                {server.lastError && (
                  <Text className="text-destructive text-sm">
                    {server.lastError}
                  </Text>
                )}
              </Stack>

              {testResult && (
                <div
                  role="status"
                  className={`rounded-lg border p-3 ${
                    testResult.success
                      ? 'border-green-500/30 bg-green-500/10'
                      : 'border-destructive/30 bg-destructive/10'
                  }`}
                >
                  <HStack gap={2} align="center">
                    {testResult.success ? (
                      <CheckCircle2 className="size-4 text-green-600" />
                    ) : (
                      <ShieldAlert className="text-destructive size-4" />
                    )}
                    <Text className="text-sm">
                      {testResult.success
                        ? `${t('connected')} - ${testResult.toolCount ?? 0} tools`
                        : testResult.error}
                    </Text>
                  </HStack>
                </div>
              )}

              <Stack gap={3}>
                <Heading level={3} size="sm">
                  {t('tools.title')}
                </Heading>
                {discoveredTools.length > 0 ? (
                  <Stack gap={2}>
                    {discoveredTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="border-border rounded-lg border p-3"
                      >
                        <HStack justify="between" align="start">
                          <HStack gap={2} align="center">
                            <Wrench className="text-muted-foreground size-4 shrink-0" />
                            <Stack gap={1}>
                              <Text className="text-sm font-medium">
                                {tool.name}
                              </Text>
                              {tool.description && (
                                <Text
                                  variant="muted"
                                  className="line-clamp-2 text-xs"
                                >
                                  {tool.description}
                                </Text>
                              )}
                            </Stack>
                          </HStack>
                          {tool.requiresApproval && (
                            <Badge variant="orange">
                              {t('tools.requiresApproval')}
                            </Badge>
                          )}
                        </HStack>
                      </div>
                    ))}
                  </Stack>
                ) : (
                  <Text variant="muted" className="text-sm">
                    {t('tools.noTools')}
                  </Text>
                )}
              </Stack>
            </Stack>
          )}
        </div>

        {!isEditing && (
          <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
            <Stack gap={3}>
              <HStack justify="between" align="center">
                <Button
                  variant="secondary"
                  onClick={handleToggleStatus}
                  disabled={isTesting || isDeleting}
                >
                  {server.status === 'active' ? t('deactivate') : t('activate')}
                </Button>
                <HStack gap={2}>
                  <Button
                    variant="secondary"
                    onClick={() => setIsEditing(true)}
                    disabled={isTesting || isDeleting}
                  >
                    {t('editServer')}
                  </Button>
                  <Button
                    onClick={handleTestConnection}
                    disabled={isTesting || isDeleting}
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t('testing')}
                      </>
                    ) : (
                      t('testConnection')
                    )}
                  </Button>
                </HStack>
              </HStack>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={isTesting || isDeleting}
                className="text-destructive hover:text-destructive/80 flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t('deleteServer')}
              </button>
            </Stack>
          </div>
        )}
      </Sheet>

      <DeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('deleteServer')}
        description={t('deleteConfirmation')}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
    </>
  );
}
