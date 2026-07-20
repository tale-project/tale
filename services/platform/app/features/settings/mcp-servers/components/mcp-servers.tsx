'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import { Grid, HStack, Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useAction } from 'convex/react';
import { Server, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { convexErrorMessage } from '@/lib/utils/convex-error';

import { useMcpServers } from '../hooks/use-mcp-servers';
import { McpServerCard } from './mcp-server-card';
import { type McpServerFormData, McpServerForm } from './mcp-server-form';
import { McpServerPanel } from './mcp-server-panel';
import type { McpServerListItem } from './types';

interface McpServersProps {
  organizationId: string;
  /** Controls the "Add MCP server" sheet; the trigger lives in the page header. */
  addDialogOpen: boolean;
  onAddDialogOpenChange: (open: boolean) => void;
}

export function McpServers({
  organizationId,
  addDialogOpen,
  onAddDialogOpenChange,
}: McpServersProps) {
  const { t } = useT('mcpServers');
  const { t: tCommon } = useT('common');

  const { data: servers, refetch } = useMcpServers(organizationId);
  const createAction = useAction(api.mcp_servers.public_mutations.create);
  const removeAction = useAction(api.mcp_servers.public_mutations.remove);

  const [isCreating, setIsCreating] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [deleteServer, setDeleteServer] = useState<McpServerListItem | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreate = useCallback(
    async (data: McpServerFormData) => {
      setIsCreating(true);
      try {
        await createAction({
          organizationId,
          name: data.name,
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
        onAddDialogOpenChange(false);
        void refetch();
      } catch (error) {
        toast({
          title: t('error'),
          description: convexErrorMessage(error, '') || undefined,
          variant: 'destructive',
        });
      } finally {
        setIsCreating(false);
      }
    },
    [createAction, organizationId, t, refetch, onAddDialogOpenChange],
  );

  const handleCardClick = useCallback((server: McpServerListItem) => {
    setOpenInEditMode(false);
    setSelectedServerId(server._id);
  }, []);

  const handleCardEdit = useCallback((server: McpServerListItem) => {
    setOpenInEditMode(true);
    setSelectedServerId(server._id);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteServer) return;
    setIsDeleting(true);
    try {
      await removeAction({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- server._id is a string at runtime; Convex actions require branded Id type
        id: deleteServer._id as Id<'mcpServers'>,
      });
      toast({ title: t('deleted'), variant: 'success' });
      setDeleteServer(null);
      void refetch();
    } catch {
      toast({ title: t('error'), variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  }, [removeAction, deleteServer, t, refetch]);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex query returns loosely typed data; shape matches McpServerListItem from queries.ts
  const serverList = (servers ?? []) as McpServerListItem[];

  // Derive selectedServer from query data so it stays in sync after refetch
  const selectedServer = selectedServerId
    ? (serverList.find((s) => s._id === selectedServerId) ?? null)
    : null;

  return (
    // Fill the settings pane so EmptyState (flex-1 + justify-center) sits in
    // the middle of the area below the section header — same fix as
    // Integrations / Automations.
    <Stack gap={0} className="min-h-0 flex-1 pb-8">
      {serverList.length > 0 ? (
        <Grid cols={1} md={2} lg={3}>
          {serverList.map((server) => (
            <McpServerCard
              key={server._id}
              server={server}
              onClick={() => handleCardClick(server)}
              onEdit={() => handleCardEdit(server)}
              onDelete={() => setDeleteServer(server)}
            />
          ))}
        </Grid>
      ) : (
        <EmptyState
          icon={Server}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          className="min-h-0"
        />
      )}

      <Sheet
        open={addDialogOpen}
        onOpenChange={onAddDialogOpenChange}
        title={t('addServer')}
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
            {t('addServer')}
          </Text>
          <IconButton
            icon={X}
            aria-label={tCommon('aria.close')}
            variant="ghost"
            onClick={() => onAddDialogOpenChange(false)}
          />
        </HStack>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
          <McpServerForm
            formId="add-mcp-server"
            hideActions
            isSubmitting={isCreating}
            onSubmit={handleCreate}
          />
        </div>
        <Row
          gap={3}
          align="stretch"
          justify="end"
          className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4"
        >
          <Button
            type="button"
            variant="secondary"
            onClick={() => onAddDialogOpenChange(false)}
            disabled={isCreating}
          >
            {t('form.cancel')}
          </Button>
          <Button type="submit" form="add-mcp-server" disabled={isCreating}>
            {isCreating ? t('form.saving') : t('form.save')}
          </Button>
        </Row>
      </Sheet>

      {selectedServer && (
        <McpServerPanel
          open={!!selectedServer}
          onOpenChange={(open) => {
            if (!open) setSelectedServerId(null);
          }}
          server={selectedServer}
          initialEditing={openInEditMode}
          onDeleted={() => {
            setSelectedServerId(null);
            void refetch();
          }}
          onUpdated={() => void refetch()}
        />
      )}

      <DeleteDialog
        open={!!deleteServer}
        onOpenChange={(open) => {
          if (!open) setDeleteServer(null);
        }}
        title={t('deleteServer')}
        description={t('deleteConfirmation')}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
    </Stack>
  );
}
