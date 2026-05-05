'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { useAction } from 'convex/react';
import {
  CheckCircle2,
  Ellipsis,
  Loader2,
  Pencil,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Sheet } from '@/app/components/ui/overlays/sheet';
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
  initialEditing?: boolean;
}

export function McpServerPanel({
  open,
  onOpenChange,
  server,
  onDeleted,
  onUpdated,
  initialEditing = false,
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
  const [isEditing, setIsEditing] = useState(initialEditing);
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

  const menuItems = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item' as const,
          label: t('editServer'),
          icon: Pencil,
          onClick: () => setIsEditing(true),
          disabled: isTesting || isDeleting,
        },
      ],
      [
        {
          type: 'item' as const,
          label: t('deleteServer'),
          icon: Trash2,
          onClick: () => setConfirmDelete(true),
          destructive: true,
          disabled: isTesting || isDeleting,
        },
      ],
    ],
    [t, isTesting, isDeleting],
  );

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
          <HStack gap={1}>
            {!isEditing && (
              <DropdownMenu
                trigger={
                  <IconButton
                    icon={Ellipsis}
                    aria-label={tCommon('aria.actionsMenu')}
                    variant="ghost"
                    disabled={isTesting || isDeleting}
                  />
                }
                items={menuItems}
                align="end"
              />
            )}
            <IconButton
              icon={X}
              aria-label={tCommon('aria.close')}
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
          </HStack>
        </HStack>

        <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          {isEditing ? (
            <McpServerForm
              formId="edit-mcp-server"
              hideActions
              server={server}
              isSubmitting={isSubmitting}
              onSubmit={handleUpdate}
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

        <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
          {isEditing ? (
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsEditing(false)}
                disabled={isSubmitting}
              >
                {t('form.cancel')}
              </Button>
              <Button
                type="submit"
                form="edit-mcp-server"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('form.saving') : t('form.save')}
              </Button>
            </div>
          ) : (
            <HStack justify="between" align="center">
              <Button
                variant="secondary"
                onClick={handleToggleStatus}
                disabled={isTesting || isDeleting}
              >
                {server.status === 'active' ? t('deactivate') : t('activate')}
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
          )}
        </div>
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
