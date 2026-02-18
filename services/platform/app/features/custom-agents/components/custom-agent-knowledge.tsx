'use client';

import { FileText } from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';

import type { RagStatus } from '@/types/documents';

import { EmptyPlaceholder } from '@/app/components/ui/feedback/empty-placeholder';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { useDocuments } from '@/app/features/documents/hooks/queries';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

import { useUpdateCustomAgent } from '../hooks/mutations';
import { useAutoSave } from '../hooks/use-auto-save';
import { useCustomAgentVersion } from '../hooks/use-custom-agent-version-context';
import { AutoSaveIndicator } from './auto-save-indicator';

interface CustomAgentKnowledgeProps {
  organizationId: string;
  agentId: string;
}

interface DocumentEntry {
  id: string;
  name?: string;
  extension?: string;
  ragStatus?: RagStatus;
  ragIndexedAt?: number;
  ragError?: string;
  teamId?: string | null;
  teamTags?: string[];
}

function DocumentRow({ doc }: { doc: DocumentEntry }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FileText
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {doc.name ?? doc.id}
      </span>
      {doc.extension && (
        <span className="text-muted-foreground shrink-0 text-xs uppercase">
          {doc.extension}
        </span>
      )}
      <RagStatusBadge
        status={doc.ragStatus}
        indexedAt={doc.ragIndexedAt}
        error={doc.ragError}
        documentId={doc.id}
      />
    </div>
  );
}

export function CustomAgentKnowledge({
  organizationId,
  agentId,
}: CustomAgentKnowledgeProps) {
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateAgent = useUpdateCustomAgent();
  const { teams } = useTeamFilter();

  const teamName = useMemo(() => {
    if (!agent?.teamId || !teams) return null;
    return teams.find((team) => team.id === agent.teamId)?.name ?? null;
  }, [agent?.teamId, teams]);

  const { documents: allDocuments, isLoading: isDocumentsLoading } =
    useDocuments(organizationId);

  const documents = useMemo(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Collection returns DocumentItemResponse; cast to DocumentEntry for display
    () => (allDocuments ?? []) as DocumentEntry[],
    [allDocuments],
  );

  const teamDocuments = useMemo(() => {
    if (!agent?.teamId) return [];
    return documents.filter((doc) =>
      doc.teamTags?.includes(agent.teamId ?? ''),
    );
  }, [documents, agent?.teamId]);

  const [knowledgeEnabled, setKnowledgeEnabled] = useState<boolean | undefined>(
    undefined,
  );
  const [includeOrgKnowledge, setIncludeOrgKnowledge] = useState<
    boolean | undefined
  >(undefined);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!agent) return;
    setKnowledgeEnabled(agent.knowledgeEnabled ?? false);
    setIncludeOrgKnowledge(agent.includeOrgKnowledge ?? false);
    setInitialized(true);
  }, [agent, agentId]);

  const orgDocuments = useMemo(() => {
    if (!knowledgeEnabled || !includeOrgKnowledge) return [];
    return documents.filter(
      (doc) => !doc.teamTags || doc.teamTags.length === 0,
    );
  }, [documents, knowledgeEnabled, includeOrgKnowledge]);

  const knowledgeData = useMemo(
    () => ({ knowledgeEnabled, includeOrgKnowledge }),
    [knowledgeEnabled, includeOrgKnowledge],
  );

  const handleSave = useCallback(
    async (data: {
      knowledgeEnabled?: boolean;
      includeOrgKnowledge?: boolean;
    }) => {
      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        knowledgeEnabled: data.knowledgeEnabled,
        includeOrgKnowledge: data.includeOrgKnowledge,
      });
    },
    [agentId, updateAgent],
  );

  const { status } = useAutoSave({
    data: knowledgeData,
    onSave: handleSave,
    enabled: initialized && !isReadOnly,
  });

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <SectionHeader
          title={t('customAgents.form.sectionKnowledge')}
          description={t('customAgents.form.sectionKnowledgeDescription')}
          action={<AutoSaveIndicator status={status} />}
        />

        <Switch
          checked={knowledgeEnabled ?? false}
          onCheckedChange={(checked) => setKnowledgeEnabled(checked)}
          label={t('customAgents.knowledge.enableKnowledge')}
          description={t('customAgents.knowledge.enableKnowledgeHelp')}
          disabled={isReadOnly}
        />

        {knowledgeEnabled && (
          <>
            {agent.teamId && teamName ? (
              <p className="text-muted-foreground text-sm">
                {t('customAgents.knowledge.teamDocumentsInfo', {
                  teamName,
                })}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t('customAgents.knowledge.noTeamAssigned')}
              </p>
            )}

            <Switch
              checked={includeOrgKnowledge ?? false}
              onCheckedChange={(checked) => setIncludeOrgKnowledge(checked)}
              label={t('customAgents.knowledge.includeOrgKnowledge')}
              description={t('customAgents.knowledge.includeOrgKnowledgeHelp')}
              disabled={isReadOnly}
            />

            {agent.teamId && teamDocuments.length > 0 && (
              <PageSection
                as="h3"
                titleSize="sm"
                titleWeight="medium"
                title={t('customAgents.knowledge.teamDocuments')}
                gap={3}
              >
                <div className="divide-y rounded-lg border">
                  {teamDocuments.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))}
                </div>
              </PageSection>
            )}

            {agent.teamId &&
              teamDocuments.length === 0 &&
              !isDocumentsLoading && (
                <EmptyPlaceholder icon={FileText}>
                  {t('customAgents.knowledge.emptyState')}
                </EmptyPlaceholder>
              )}

            {includeOrgKnowledge && orgDocuments.length > 0 && (
              <PageSection
                as="h3"
                titleSize="sm"
                titleWeight="medium"
                title={t('customAgents.knowledge.orgDocuments')}
                gap={3}
              >
                <div className="divide-y rounded-lg border">
                  {orgDocuments.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))}
                </div>
              </PageSection>
            )}

            {includeOrgKnowledge &&
              orgDocuments.length === 0 &&
              !isDocumentsLoading && (
                <EmptyPlaceholder icon={FileText}>
                  {t('customAgents.knowledge.orgDocumentsEmptyState')}
                </EmptyPlaceholder>
              )}
          </>
        )}
      </Stack>
    </NarrowContainer>
  );
}
