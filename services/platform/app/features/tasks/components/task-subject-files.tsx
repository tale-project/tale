'use client';

import { FolderUploadCard } from '@/app/features/automations/registry/connected/folder-upload-card';
import type { FileAttachment } from '@/app/features/chat/hooks/use-convex-file-upload';
import type { Id } from '@/convex/_generated/dataModel';

import { useTaskSubjectContract } from '../hooks/use-task-subject-contract';
import { TaskAttachments } from './task-attachments';

/**
 * The task modal's input surface. For a task whose owning automation declares
 * a FOLDER input (`subjects.task.input.kind: 'folder'`), the Attachments zone
 * is replaced by the bound folder's upload card — files land where the run
 * actually reads them, not as task-blob copies the pipeline never sees. Any
 * pre-existing task attachments stay listed below (read path unchanged).
 * Tasks without a folder-bound owner keep the plain Attachments zone.
 */
export function TaskSubjectFiles({
  organizationId,
  task,
  attachments,
  uploadingFiles,
  canEdit,
  onUpload,
  onRemove,
}: {
  organizationId: string;
  task: {
    projectId: Id<'projects'>;
    createdBy: string;
    createdByType: 'user' | 'agent' | 'app';
    externalSystem?: string;
    externalId?: string;
  };
  attachments: FileAttachment[];
  uploadingFiles: string[];
  canEdit: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (fileId: string) => void;
}) {
  const resolved = useTaskSubjectContract(organizationId, task);
  const folderId =
    resolved?.contract.input?.kind === 'folder' &&
    typeof task.externalId === 'string' &&
    task.externalId !== ''
      ? task.externalId
      : null;

  if (folderId === null) {
    return (
      <TaskAttachments
        attachments={attachments}
        uploadingFiles={uploadingFiles}
        canEdit={canEdit}
        organizationId={organizationId}
        onUpload={onUpload}
        onRemove={onRemove}
      />
    );
  }

  return (
    <>
      <FolderUploadCard
        folderId={folderId}
        organizationId={organizationId}
        projectId={task.projectId}
        showFolderName
      />
      {attachments.length > 0 && (
        <TaskAttachments
          attachments={attachments}
          uploadingFiles={uploadingFiles}
          canEdit={canEdit}
          organizationId={organizationId}
          onUpload={onUpload}
          onRemove={onRemove}
        />
      )}
    </>
  );
}
