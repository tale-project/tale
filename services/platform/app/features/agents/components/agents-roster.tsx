'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { CatalogGridSkeleton } from '@/app/components/catalog/catalog-card-skeleton';
import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { ConfigIcon } from '@/app/components/catalog/config-icon';
import { useCatalogSearch } from '@/app/components/catalog/use-catalog-search';
import { useT } from '@/lib/i18n/client';

import { useAgents } from '../hooks/queries';
import { AgentCreateDialog } from './agent-create-dialog';

interface AgentSummary {
  slug: string;
  displayName: string;
  description?: string;
  visibility: 'private' | 'org';
  icon?: string;
  labels?: string[];
  canEdit: boolean;
}

const agentHaystack = (agent: AgentSummary) => [
  agent.slug,
  agent.displayName,
  agent.description,
  ...(agent.labels ?? []),
];

/**
 * The org's agent roster: every agent file the viewer may use, as catalog
 * cards. An agent is a slim persona (identity, instructions, two allowlists,
 * knowledge scope) — presence in the org's `agents/` directory IS the roster;
 * there is no install state. Unreadable files surface as an operator banner
 * instead of vanishing.
 */
export function AgentsRoster({
  organizationId,
  onOpen,
}: {
  organizationId: string;
  onOpen: (slug: string) => void;
}) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const agentsQuery = useAgents(organizationId);
  const agents: AgentSummary[] = agentsQuery.data?.agents ?? [];
  const failures = agentsQuery.data?.failures ?? [];

  const filtered = useCatalogSearch(agents, query, agentHaystack);

  return (
    <Stack gap={4}>
      <CatalogToolbar
        search={{
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: t('agents.searchAgent'),
        }}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t('agents.createAgent')}
          </Button>
        }
      />

      {agentsQuery.isError && (
        <Alert variant="destructive" description={t('agents.listFailed')} />
      )}
      {failures.length > 0 && (
        <Alert
          variant="destructive"
          title={t('agents.loadError')}
          description={
            <ul className="list-inside list-disc">
              {failures.map((failure) => (
                <li key={failure.path}>
                  <code>{failure.path}</code> — {failure.message}
                </li>
              ))}
            </ul>
          }
        />
      )}

      {agentsQuery.isPending ? (
        <Skeletonize loading>
          <CatalogGridSkeleton />
        </Skeletonize>
      ) : filtered.length === 0 ? (
        <Stack gap={2} align="center" className="py-12 text-center">
          <Text as="p" className="font-medium">
            {agents.length === 0
              ? tEmpty('agents.title')
              : t('agents.noResults.title')}
          </Text>
          <Text as="p" variant="muted" className="max-w-md">
            {agents.length === 0
              ? tEmpty('agents.description')
              : t('agents.noResults.description')}
          </Text>
          {agents.length === 0 && (
            <Button variant="secondary" onClick={() => setCreateOpen(true)}>
              {t('agents.createAgent')}
            </Button>
          )}
        </Stack>
      ) : (
        <CatalogGrid>
          {filtered.map((agent) => (
            <CatalogCard
              key={agent.slug}
              media={
                <CatalogCardIcon>
                  <ConfigIcon icon={agent.icon} className="size-6" />
                </CatalogCardIcon>
              }
              title={agent.displayName}
              badge={
                agent.visibility === 'private' ? (
                  <Badge variant="outline">
                    {t('agents.visibility.private')}
                  </Badge>
                ) : undefined
              }
              meta={<CatalogLabels labels={agent.labels} tone="quiet" />}
              description={agent.description}
              onClick={() => onOpen(agent.slug)}
              ariaLabel={t('agents.openAgent', { name: agent.displayName })}
            />
          ))}
        </CatalogGrid>
      )}

      <AgentCreateDialog
        organizationId={organizationId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingSlugs={agents.map((agent) => agent.slug)}
        onCreated={(slug) => {
          setCreateOpen(false);
          onOpen(slug);
        }}
      />
    </Stack>
  );
}
