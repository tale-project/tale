'use client';

import { Row, Stack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import { splitFolderFiles } from '../lib/folder-files';

/**
 * The OUTCOME zone of an automation-owned task bound to a project folder: the
 * deliverables the automation declared, each openable in place.
 *
 * Always open, and always the same rows once a run has filed anything — a
 * deliverable still missing shows as a promised row, so the list a reviewer
 * reads does not reorder itself between runs. Before the first run there is
 * nothing to promise yet: the zone says so in one line rather than staging a
 * box of empty rows, which is the shape the pre-rewrite desk used too.
 *
 * Which files these are comes from the automation's contract
 * (`outcome.files`); with no declaration the zone falls back to whatever the
 * runs filed.
 */
export function TaskOutcomeFilesCard({
  organizationId,
  projectId,
  folderId,
  contract,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  folderId: Id<'folders'>;
  contract: TaskSubjectContract;
}) {
  const { t } = useT('tasks');
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(
    null,
  );
  const documentsQuery = useConvexQuery(
    api.projects.queries.listProjectDocuments,
    { organizationId, projectId },
  );

  const outcome = useMemo(
    () =>
      splitFolderFiles(documentsQuery.data ?? [], folderId, contract).outcome,
    [documentsQuery.data, folderId, contract],
  );

  // Nothing declared and nothing filed — an empty zone would promise a section
  // no automation here has a use for. The Files zone already says what to do.
  if (outcome.length === 0) return null;

  const filed = outcome.filter((slot) => slot.file !== null);
  const pending = outcome.length - filed.length;

  return (
    <Stack as="section" gap={2}>
      <Row gap={2}>
        <PackageCheck
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <Text as="h3" variant="label">
          {t('outcome.title')}
        </Text>
        {filed.length > 0 && pending > 0 && (
          <Text as="span" variant="muted" className="ml-auto text-xs">
            {t('outcome.pending')}
          </Text>
        )}
      </Row>
      {filed.length === 0 ? (
        // Not one deliverable exists yet: say that once. A box of "Not ready
        // yet" rows reads like a broken list, and the task's own panel already
        // names the next step.
        <Text as="p" variant="muted">
          {t('outcome.empty')}
        </Text>
      ) : (
        <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
          {outcome.map((slot, index) => {
            // A produced file with no title has nothing to promote itself with;
            // the declared-pattern path always carries one.
            const name = slot.label === '' ? t('outcome.untitled') : slot.label;
            return (
              <li key={`${slot.label}:${index}`} className="flex min-w-0">
                {slot.file === null ? (
                  <Row gap={2} className="min-w-0 flex-1 px-3 py-2">
                    <StatusIndicator variant="neutral" size="sm">
                      <span className="truncate text-sm">{name}</span>
                    </StatusIndicator>
                  </Row>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setPreview({ id: String(slot.file?._id), name })
                    }
                    className="hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={t('outcome.open', { name })}
                  >
                    <span className="truncate font-medium">{name}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        documentId={preview?.id}
        fileName={preview?.name}
      />
    </Stack>
  );
}
