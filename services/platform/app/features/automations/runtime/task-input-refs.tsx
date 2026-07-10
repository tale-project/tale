'use client';

/**
 * Resolve task.externalId / task.externalUrl when they point at Knowledge
 * folders — operators see the folder name, never an opaque storage id. Plain
 * http(s) URLs stay as external links. Unknown / unresolved values are omitted.
 */
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Folder } from 'lucide-react';
import { type ReactNode } from 'react';

import { useTask } from '@/app/features/tasks/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function FolderRefRow({
  label,
  folderId,
  organizationId,
  projectId,
}: {
  label: string;
  folderId: string;
  organizationId: string;
  projectId: string;
}) {
  const folder = useConvexQuery(api.folders.queries.getFolder, {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- task external ref
    folderId: folderId as Id<'folders'>,
    organizationId,
  });
  if (!folder.data) return null;
  const linkProjectId =
    typeof folder.data.projectId === 'string' && folder.data.projectId !== ''
      ? folder.data.projectId
      : projectId;
  return (
    <HStack gap={3} className="items-baseline justify-between">
      <Text as="span" variant="muted" className="shrink-0">
        {label}
      </Text>
      <Link
        to="/dashboard/$id/projects/$projectId/files"
        params={{ id: organizationId, projectId: linkProjectId }}
        search={{ folderId }}
        className="text-primary focus-visible:ring-primary inline-flex min-w-0 items-center gap-1.5 rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        <Folder className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{folder.data.name}</span>
      </Link>
    </HStack>
  );
}

function HttpRefRow({ label, url }: { label: string; url: string }) {
  return (
    <HStack gap={3} className="items-baseline justify-between">
      <Text as="span" variant="muted" className="shrink-0">
        {label}
      </Text>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-primary focus-visible:ring-primary min-w-0 truncate rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {url}
      </a>
    </HStack>
  );
}

export function TaskInputRefs({ taskId }: { taskId: string }) {
  const { t } = useT('automations');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const { task } = useTask(taskId as Id<'tasks'>);
  if (!task) return null;

  const organizationId = task.organizationId;
  const projectId = task.projectId;
  const externalId =
    typeof task.externalId === 'string' && task.externalId.trim() !== ''
      ? task.externalId
      : undefined;
  const externalUrl =
    typeof task.externalUrl === 'string' && task.externalUrl.trim() !== ''
      ? task.externalUrl
      : undefined;

  const rows: ReactNode[] = [];

  if (externalId && !isHttpUrl(externalId)) {
    rows.push(
      <FolderRefRow
        key="externalId"
        label={t('detail.subjectFolder')}
        folderId={externalId}
        organizationId={organizationId}
        projectId={projectId}
      />,
    );
  }

  if (externalUrl) {
    if (isHttpUrl(externalUrl)) {
      rows.push(
        <HttpRefRow
          key="externalUrl"
          label={t('detail.externalRef')}
          url={externalUrl}
        />,
      );
    } else {
      rows.push(
        <FolderRefRow
          key="externalUrl"
          label={t('detail.relatedFolder')}
          folderId={externalUrl}
          organizationId={organizationId}
          projectId={projectId}
        />,
      );
    }
  }

  if (rows.length === 0) return null;

  return (
    <VStack gap={2} className="mt-3">
      {rows}
    </VStack>
  );
}
