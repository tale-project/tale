'use client';

import { Button } from '@tale/ui/button';
import { Stack, HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { FileText } from 'lucide-react';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDetachDocumentFromProject } from '../hooks/mutations';
import { useProject, useProjectDocuments } from '../hooks/queries';

interface ProjectFilesTabProps {
  projectId: Id<'projects'>;
}

export function ProjectFilesTab({ projectId }: ProjectFilesTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { documents, isLoading } = useProjectDocuments(projectId);
  const { mutateAsync: detachDocument } = useDetachDocumentFromProject();

  if (!project) return null;
  const canEdit = project.canEdit;

  const handleDetach = async (documentId: Id<'documents'>) => {
    try {
      await detachDocument({ documentId });
      toast({ title: t('files.detachSuccess'), variant: 'success' });
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'PROJECT_FORBIDDEN' || code === 'RBAC_FORBIDDEN') {
          toast({ title: t('errors.' + code), variant: 'destructive' });
          return;
        }
      }
      console.error('detachDocument failed', error);
      toast({ title: t('files.detachError'), variant: 'destructive' });
    }
  };

  const statusLabel = (status: string | null) => {
    if (status === 'queued') return t('files.ragStatusQueued');
    if (status === 'running') return t('files.ragStatusRunning');
    if (status === 'completed') return t('files.ragStatusCompleted');
    if (status === 'failed') return t('files.ragStatusFailed');
    return '';
  };

  return (
    <Stack gap={4} className="p-6">
      {documents.length === 0 && !isLoading ? (
        <div className="border-border flex flex-col items-center justify-center rounded-md border p-12 text-center">
          <FileText className="text-muted-foreground/60 mb-3 size-8" />
          <Text variant="label">{t('files.emptyTitle')}</Text>
          <Text variant="muted" className="mt-1">
            {t('files.emptyDescription')}
          </Text>
        </div>
      ) : (
        <Stack gap={2}>
          {documents.map((doc) => (
            <HStack
              key={doc._id}
              gap={3}
              align="center"
              className="border-border rounded-md border p-3"
            >
              <FileText className="text-muted-foreground size-5 shrink-0" />
              <Stack gap={0} className="min-w-0 flex-1">
                <Text className="truncate font-medium">
                  {doc.title ?? doc.extension ?? 'document'}
                </Text>
                <Text variant="caption">{statusLabel(doc.ragStatus)}</Text>
              </Stack>
              {canEdit ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleDetach(doc._id)}
                >
                  {t('files.detachAction')}
                </Button>
              ) : null}
            </HStack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
