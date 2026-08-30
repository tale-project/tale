'use client';

import { Row, Stack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useT } from '@/lib/i18n/client';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import { splitFolderFiles } from '../lib/folder-files';
import { FileOpenButton } from './file-open-button';

/**
 * The OUTCOME zone of an automation-owned task bound to a project folder: the
 * deliverables the automation declared, each openable in place.
 *
 * Always open, and always the same rows: the declared deliverables are ANNOUNCED
 * from the first look at the task, so a reviewer knows what a run will produce
 * before it produces it, and the list never reorders itself between runs. What
 * changes is only whether a row is a promise or a file — the pre-rewrite desk's
 * behaviour, quiet styling included.
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
  projectId: string;
  folderId: string;
  contract: TaskSubjectContract;
}) {
  const { t } = useT('tasks');
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(
    null,
  );
  const documentsQuery = useConvexQuery(
    'projects/queries:listProjectDocuments',
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

  const pending = outcome.filter((slot) => slot.file === null).length;

  return (
    <Stack as="section" gap={2}>
      <Row gap={2}>
        <PackageCheck
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <Text as="h3" variant="label" className="font-semibold">
          {t('outcome.title')}
        </Text>
        {pending > 0 && (
          <Text as="span" variant="muted" className="ml-auto text-xs">
            {t('outcome.pending')}
          </Text>
        )}
      </Row>
      {/* Announced before it exists: the declared deliverables are named from
          the first look at the task, so a reviewer knows what a run will
          produce before it produces it.

          ONE layout, promised or filed, and never a framed and divided list —
          framing the filed state turned three deliverables into what reads as a
          table (of what? there is one column) and made the zone restyle itself
          the moment a run landed.

          A file always owns its line, exactly as in the Files zone above: a
          deliverable is a thing to open and to name in conversation, not a tag
          in a row of tags, and names of unequal length packed onto one line have
          no scan order at all. What the line does NOT do is act as the target —
          that is the name itself ({@link FileOpenButton}). */}
      <ul
        className="flex min-w-0 flex-col items-start gap-2"
        {...(pending > 0 ? { role: 'status' } : {})}
      >
        {outcome.map((slot, index) => {
          // A produced file with no title has nothing to promote itself with;
          // the declared-pattern path always carries one.
          const name = slot.label === '' ? t('outcome.untitled') : slot.label;
          return (
            <li
              key={`${slot.label}:${index}`}
              className="flex max-w-full min-w-0"
            >
              {slot.file === null ? (
                // A promise is not a button — the dot is what distinguishes it,
                // and the padding matches so a name does not jump when it lands.
                <span className="px-1.5 py-0.5">
                  <StatusIndicator variant="neutral" size="sm">
                    <span className="truncate text-sm">{name}</span>
                  </StatusIndicator>
                </span>
              ) : (
                <FileOpenButton
                  name={name}
                  label={t('outcome.open', { name })}
                  emphasis
                  onOpen={() =>
                    setPreview({ id: String(slot.file?._id), name })
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
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
