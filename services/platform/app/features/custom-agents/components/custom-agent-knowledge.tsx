'use client';

import { FileText } from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';

import type { RagStatus } from '@/types/documents';

import { Switch } from '@/app/components/ui/forms/switch';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
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
      await updateAgent({
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
        <div className="flex items-center justify-between">
          <Stack gap={1}>
            <h2 className="text-foreground text-base font-semibold">
              {t('customAgents.form.sectionKnowledge')}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t('customAgents.form.sectionKnowledgeDescription')}
            </p>
          </Stack>
          <AutoSaveIndicator status={status} />
        </div>

        <div>
          <Switch
            checked={knowledgeEnabled ?? false}
            onCheckedChange={(checked) => setKnowledgeEnabled(checked)}
            label={t('customAgents.knowledge.enableKnowledge')}
            disabled={isReadOnly}
          />
          <p className="text-muted-foreground mt-1.5 ml-10 text-xs">
            {t('customAgents.knowledge.enableKnowledgeHelp')}
          </p>
        </div>

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

            <div>
              <Switch
                checked={includeOrgKnowledge ?? false}
                onCheckedChange={(checked) => setIncludeOrgKnowledge(checked)}
                label={t('customAgents.knowledge.includeOrgKnowledge')}
                disabled={isReadOnly}
              />
              <p className="text-muted-foreground mt-1.5 ml-10 text-xs">
                {t('customAgents.knowledge.includeOrgKnowledgeHelp')}
              </p>
            </div>

            {agent.teamId && teamDocuments.length > 0 && (
              <section>
                <h3 className="text-foreground mb-3 text-sm font-medium">
                  {t('customAgents.knowledge.teamDocuments')}
                </h3>
                <div className="divide-y rounded-lg border">
                  {teamDocuments.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))}
                </div>
              </section>
            )}

            {agent.teamId &&
              teamDocuments.length === 0 &&
              !isDocumentsLoading && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <FileText
                    className="text-muted-foreground/50 mx-auto mb-2 size-8"
                    aria-hidden="true"
                  />
                  <p className="text-muted-foreground text-sm">
                    {t('customAgents.knowledge.emptyState')}
                  </p>
                </div>
              )}

            {includeOrgKnowledge && orgDocuments.length > 0 && (
              <section>
                <h3 className="text-foreground mb-3 text-sm font-medium">
                  {t('customAgents.knowledge.orgDocuments')}
                </h3>
                <div className="divide-y rounded-lg border">
                  {orgDocuments.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))}
                </div>
              </section>
            )}

            {includeOrgKnowledge &&
              orgDocuments.length === 0 &&
              !isDocumentsLoading && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <FileText
                    className="text-muted-foreground/50 mx-auto mb-2 size-8"
                    aria-hidden="true"
                  />
                  <p className="text-muted-foreground text-sm">
                    {t('customAgents.knowledge.orgDocumentsEmptyState')}
                  </p>
                </div>
              )}
          </>
        )}
      </Stack>
    </NarrowContainer>
  );
}
