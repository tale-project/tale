'use client';

import { Link } from '@tanstack/react-router';
import { FileText, Trash2, Upload } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import type { KnowledgeFile } from '@/convex/agents/schema';
import type { RagStatus } from '@/types/documents';

import { ContentArea } from '@/app/components/layout/content-area';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { EmptyPlaceholder } from '@/app/components/ui/feedback/empty-placeholder';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { useDocuments } from '@/app/features/documents/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { isRetrievalMode } from '@/lib/shared/schemas/agents';

import { useRemoveKnowledgeFile } from '../hooks/mutations';
import { useAgentConfig } from '../hooks/use-agent-config-context';
import { useAgentFileUpload } from '../hooks/use-agent-file-upload';

interface AgentKnowledgeProps {
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
}

function DocumentRow({ doc }: { doc: DocumentEntry }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FileText
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
      <Text as="span" variant="body" truncate className="min-w-0 flex-1">
        {doc.name ?? doc.id}
      </Text>
      {doc.extension && (
        <Text as="span" variant="caption" className="shrink-0 uppercase">
          {doc.extension}
        </Text>
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

function AgentFileRow({
  file,
  onRemove,
  isReadOnly,
}: {
  file: KnowledgeFile;
  onRemove: (fileId: string) => void;
  isReadOnly: boolean;
}) {
  const { t } = useT('settings');
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FileText
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
      <Text as="span" variant="body" truncate className="min-w-0 flex-1">
        {file.fileName}
      </Text>
      {file.extension && (
        <Text as="span" variant="caption" className="shrink-0 uppercase">
          {file.extension}
        </Text>
      )}
      <RagStatusBadge
        status={file.ragStatus}
        indexedAt={file.ragIndexedAt}
        error={file.ragError}
        documentId={file.fileId}
      />
      {!isReadOnly && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmOpen(true)}
            aria-label={t('agents.knowledge.removeFile')}
          >
            <Trash2 className="text-muted-foreground size-4" />
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={t('agents.knowledge.removeFile')}
            description={t('agents.knowledge.removeFileConfirm')}
            variant="destructive"
            onConfirm={() => {
              onRemove(file.fileId);
              setConfirmOpen(false);
            }}
          />
        </>
      )}
    </div>
  );
}

export function AgentKnowledge({
  organizationId,
  agentId,
}: AgentKnowledgeProps) {
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();
  const removeKnowledgeFile = useRemoveKnowledgeFile();

  const knowledgeMode = config.knowledgeMode ?? 'off';
  const includeOrgKnowledge = config.includeOrgKnowledge ?? false;
  const includeTeamKnowledge = config.includeTeamKnowledge ?? true;

  const isEnabled = knowledgeMode !== 'off';

  const { documents: allDocuments, isLoading: isDocumentsLoading } =
    useDocuments(organizationId);

  const documents = useMemo(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex query result matches DocumentEntry shape
    () => (allDocuments ?? []) as DocumentEntry[],
    [allDocuments],
  );

  const teamDocuments = useMemo((): DocumentEntry[] => [], []);

  const orgDocuments = useMemo(() => {
    if (!isEnabled || !includeOrgKnowledge) return [];
    return documents.filter((doc) => !doc.teamId);
  }, [documents, isEnabled, includeOrgKnowledge]);

  const knowledgeFiles: KnowledgeFile[] = [];

  const { uploadFiles, isUploading, accept } = useAgentFileUpload({
    organizationId,
    agentFileName: agentId,
  });

  const handleRemoveFile = useCallback(
    (fileId: string) => {
      removeKnowledgeFile
        .mutateAsync({
          organizationId,
          agentFileName: agentId,
          fileId: toId<'_storage'>(fileId),
        })
        .catch(() => {
          toast({
            title: t('agents.knowledge.removeFailed'),
            variant: 'destructive',
          });
        });
    },
    [agentId, organizationId, removeKnowledgeFile, t],
  );

  const modeOptions = useMemo(
    () => [
      {
        value: 'off',
        label: `${t('agents.knowledge.modeOff')} — ${t('agents.knowledge.modeOffDescription')}`,
      },
      {
        value: 'tool',
        label: `${t('agents.knowledge.modeTool')} — ${t('agents.knowledge.modeToolDescription')}`,
      },
      {
        value: 'context',
        label: `${t('agents.knowledge.modeContext')} — ${t('agents.knowledge.modeContextDescription')}`,
      },
      {
        value: 'both',
        label: `${t('agents.knowledge.modeBoth')} — ${t('agents.knowledge.modeBothDescription')}`,
      },
    ],
    [t],
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader
        title={t('agents.form.sectionKnowledge')}
        description={
          <>
            {t('agents.form.sectionKnowledgeDescription')}
            {'. '}
            {t('agents.form.knowledgeHint')}{' '}
            <Link
              to="/dashboard/$id/documents"
              params={{ id: organizationId }}
              className="text-primary hover:underline"
            >
              {t('agents.form.knowledgeHintLink')}
            </Link>
          </>
        }
      />

      <RadioGroup
        label={t('agents.knowledge.retrievalMode')}
        value={knowledgeMode}
        onValueChange={(value) => {
          if (isRetrievalMode(value)) {
            updateConfig({ knowledgeMode: value });
          }
        }}
        options={modeOptions}
      />

      {isEnabled && (
        <>
          <Switch
            checked={includeTeamKnowledge}
            onCheckedChange={(checked) =>
              updateConfig({ includeTeamKnowledge: checked })
            }
            label={t('agents.knowledge.includeTeamKnowledge')}
            description={t('agents.knowledge.includeTeamKnowledgeHelp')}
          />

          {includeTeamKnowledge && teamDocuments.length > 0 && (
            <PageSection
              as="h3"
              titleSize="sm"
              titleWeight="medium"
              title={t('agents.knowledge.teamDocuments')}
              gap={3}
            >
              <div className="divide-y rounded-lg border">
                {teamDocuments.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} />
                ))}
              </div>
            </PageSection>
          )}

          {includeTeamKnowledge &&
            teamDocuments.length === 0 &&
            !isDocumentsLoading && (
              <EmptyPlaceholder icon={FileText}>
                {t('agents.knowledge.emptyState')}
              </EmptyPlaceholder>
            )}

          <Switch
            checked={includeOrgKnowledge}
            onCheckedChange={(checked) =>
              updateConfig({ includeOrgKnowledge: checked })
            }
            label={t('agents.knowledge.includeOrgKnowledge')}
            description={t('agents.knowledge.includeOrgKnowledgeHelp')}
          />

          {includeOrgKnowledge && orgDocuments.length > 0 && (
            <PageSection
              as="h3"
              titleSize="sm"
              titleWeight="medium"
              title={t('agents.knowledge.orgDocuments')}
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
                {t('agents.knowledge.orgDocumentsEmptyState')}
              </EmptyPlaceholder>
            )}

          <PageSection
            as="h3"
            titleSize="sm"
            titleWeight="medium"
            title={t('agents.knowledge.agentDocuments')}
            description={t('agents.knowledge.agentDocumentsHelp')}
            gap={3}
          >
            {knowledgeFiles.length > 0 && (
              <div className="divide-y rounded-lg border">
                {knowledgeFiles.map((file) => (
                  <AgentFileRow
                    key={file.fileId}
                    file={file}
                    onRemove={handleRemoveFile}
                    isReadOnly={false}
                  />
                ))}
              </div>
            )}

            {knowledgeFiles.length === 0 && (
              <EmptyPlaceholder icon={FileText}>
                {t('agents.knowledge.agentDocumentsEmptyState')}
              </EmptyPlaceholder>
            )}

            <FileUpload.Root>
              <FileUpload.DropZone
                onFilesSelected={uploadFiles}
                accept={accept}
                multiple
                disabled={isUploading}
                inputId="agent-knowledge-file-upload"
                aria-label={t('agents.knowledge.uploadAgentDocuments')}
                className="hover:border-primary/50 relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors"
              >
                <Upload
                  className="text-muted-foreground size-6"
                  aria-hidden="true"
                />
                <Text as="span" variant="muted">
                  {isUploading
                    ? t('agents.knowledge.uploadStarted')
                    : t('agents.knowledge.uploadAgentDocuments')}
                </Text>
                <FileUpload.Overlay />
              </FileUpload.DropZone>
            </FileUpload.Root>
          </PageSection>
        </>
      )}
    </ContentArea>
  );
}
