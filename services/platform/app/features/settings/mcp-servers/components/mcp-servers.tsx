'use client';

import { useAction } from 'convex/react';
import { Plus, Server } from 'lucide-react';
import { useCallback, useState } from 'react';

import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Grid, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useMcpServers } from '../hooks/use-mcp-servers';
import { McpServerCard } from './mcp-server-card';
import { type McpServerFormData, McpServerForm } from './mcp-server-form';
import { McpServerPanel } from './mcp-server-panel';
import type { McpServerListItem } from './types';

interface McpServersProps {
  organizationId: string;
}

export function McpServers({ organizationId }: McpServersProps) {
  const { t } = useT('mcpServers');

  const { data: servers, refetch } = useMcpServers(organizationId);
  const createAction = useAction(api.mcp_servers.public_mutations.create);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedServer, setSelectedServer] =
    useState<McpServerListItem | null>(null);

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
        setAddDialogOpen(false);
        void refetch();
      } catch {
        toast({ title: t('error'), variant: 'destructive' });
      } finally {
        setIsCreating(false);
      }
    },
    [createAction, organizationId, t, refetch],
  );

  const handleCardClick = useCallback((server: McpServerListItem) => {
    setSelectedServer(server);
  }, []);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex query returns loosely typed data; shape matches McpServerListItem from queries.ts
  const serverList = (servers ?? []) as McpServerListItem[];

  return (
    <Stack gap={0} className="pb-8">
      <HStack wrap justify="between" align="start" className="pb-5">
        <Stack gap={1}>
          <Heading level={2} size="lg" tracking="tight">
            {t('title')}
          </Heading>
          <Text variant="muted">{t('description')}</Text>
        </Stack>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 size-4" />
          {t('addServer')}
        </Button>
      </HStack>

      {serverList.length > 0 ? (
        <Grid cols={1} md={2} lg={3}>
          {serverList.map((server) => (
            <McpServerCard
              key={server._id}
              server={server}
              onClick={() => handleCardClick(server)}
            />
          ))}
        </Grid>
      ) : (
        <EmptyState
          icon={Server}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      )}

      <Sheet
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        title={t('addServer')}
        size="md"
        className="p-6"
      >
        <McpServerForm
          isSubmitting={isCreating}
          onSubmit={handleCreate}
          onCancel={() => setAddDialogOpen(false)}
        />
      </Sheet>

      {selectedServer && (
        <McpServerPanel
          open={!!selectedServer}
          onOpenChange={(open) => {
            if (!open) setSelectedServer(null);
          }}
          server={selectedServer}
          onDeleted={() => {
            setSelectedServer(null);
            void refetch();
          }}
          onUpdated={() => void refetch()}
        />
      )}
    </Stack>
  );
}
