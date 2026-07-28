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

  const pending = outcome.filter((slot) => slot.file === null).length;

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
        {pending > 0 && (
          <Text as="span" variant="muted" className="ml-auto text-xs">
            {t('outcome.pending')}
          </Text>
        )}
      </Row>
      {/* Announced before it exists: the declared deliverables are named from
          the first look at the task, so a reviewer knows what a run will
          produce before it produces it.

          ONE layout, promised or filed — a quiet line-up of rows, never a
          framed and divided list. Framing the filed state turned three
          deliverables into what reads as a table (a table of what? there is one
          column), and it made the zone restyle itself the moment a run landed,
          so the same three rows looked like two different things depending on
          when you opened the task. This is `main`'s OutcomeStrip behaviour:
          plain rows in a flex column, with the row idiom of the Files zone
          directly above it — the act is identical (open this file), so the
          affordance must be too. */}
      <ul
        className="flex min-w-0 flex-col gap-0.5"
        {...(pending > 0 ? { role: 'status' } : {})}
      >
        {outcome.map((slot, index) => {
          // A produced file with no title has nothing to promote itself with;
          // the declared-pattern path always carries one.
          const name = slot.label === '' ? t('outcome.untitled') : slot.label;
          return (
            <li key={`${slot.label}:${index}`} className="flex min-w-0">
              {slot.file === null ? (
                // Same padding and height as a filed row; the only difference
                // is the promise dot, which is the whole point of the row.
                <Row gap={2} className="min-w-0 flex-1 px-2 py-1">
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
                  className="hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                  aria-label={t('outcome.open', { name })}
                >
                  <span className="truncate font-medium">{name}</span>
                </button>
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
