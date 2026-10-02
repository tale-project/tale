import { createHash } from 'node:crypto';

import {
  taskAgentReviewStageFileSchema,
  type TaskAgentReviewStageFileInput,
} from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';
import { z } from 'zod/v4';

import { safePathSegment } from '../../core/lib/safe_path_segment.ts';
import {
  mintCursorFor,
  verifyCursorFor,
} from '../../core/lib/signed_cursor.ts';
import { isS3Ref } from '../../core/lib/storage/blob_ref.ts';
import { sessionStageFiles } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { stageUrlForBlobRef } from '../../core/node_only/sandbox/helpers/stage_url.ts';
import {
  getTaskReviewFileMetadata,
  type FileMetadataRow,
} from '../files/service.ts';
import {
  readAgentTaskReviewAccess,
  type AgentReviewAuthority,
} from './agent-review.ts';
import { TaskError } from './errors.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { loadTaskOrThrow, type TaskRow } from './service.ts';

const REVIEW_FILE_MAX_BYTES = 20 * 1024 * 1024;
const REVIEW_FILES_PAGE_SIZE = 50;
const fileEntrySchema = z.object({
  fileId: z.string().min(1).max(4096),
  fileName: z.string().min(1).max(240),
  fileType: z.string().min(1).max(200),
  fileSize: z.number().int().nonnegative().safe(),
  runId: z.string().min(1).max(200).optional(),
});
type FileEntry = z.infer<typeof fileEntrySchema>;
type ReviewSourceInput = Pick<
  TaskAgentReviewStageFileInput,
  'taskId' | 'expected'
>;
type UnavailableReason =
  | 'ambiguous_membership'
  | 'invalid_metadata'
  | 'metadata_missing'
  | 'document_access_required'
  | 'unsupported_storage'
  | 'too_large';
type BoundFile = FileMetadataRow & { documentBound: boolean };

function sourceEntries(task: TaskRow) {
  return [
    ...(Array.isArray(task.attachments)
      ? task.attachments.map((raw: unknown) => ({
          kind: 'attachment' as const,
          raw,
        }))
      : []),
    ...(Array.isArray(task.outputs)
      ? task.outputs.map((raw: unknown) => ({ kind: 'output' as const, raw }))
      : []),
  ].map(({ kind, raw }) => {
    const parsed = fileEntrySchema.safeParse(raw);
    return { kind, entry: parsed.success ? parsed.data : null };
  });
}

function unavailable(
  entry: FileEntry,
  metadata: BoundFile | undefined,
): UnavailableReason | null {
  if (
    /[\x00-\x1f\x7f]/.test(entry.fileName) ||
    Buffer.byteLength(entry.fileName) > 240 ||
    /[\x00-\x1f\x7f]/.test(entry.fileType)
  )
    return 'invalid_metadata';
  if (metadata === undefined) return 'metadata_missing';
  if (metadata.documentBound) return 'document_access_required';
  if (!isS3Ref(metadata.storageRef)) return 'unsupported_storage';
  if (
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size !== entry.fileSize
  )
    return 'invalid_metadata';
  if (metadata.size > REVIEW_FILE_MAX_BYTES) return 'too_large';
  return null;
}

function staleFiles(): never {
  throw new TaskError(
    'TASK_REVIEW_STALE',
    'The review files changed; read task_get again before staging',
    409,
  );
}

/** Source metadata only, never a file capability. The existing task_get
 * project read precedes this query; the fresh snapshot prevents mixed pages. */
export async function readAgentTaskReviewFiles(
  tx: TransactionSql,
  args: ReviewSourceInput & {
    organizationId: string;
    projectId: string;
    reviewerAgentId: string;
    cursor?: unknown;
  },
) {
  const task = await loadTaskOrThrow(tx, args.taskId, args.organizationId);
  if (task.projectId !== args.projectId)
    throw new TaskError('TASK_NOT_FOUND', 'No task in this project', 404);
  const pending = await getPendingReviewForTask(
    tx,
    args.organizationId,
    task.id,
  );
  if (
    task.status !== 'in_review' ||
    pending?.approvalId !== args.expected.approvalId ||
    pending.runId !== args.expected.runId ||
    pending.evidenceRevision !== args.expected.evidenceRevision ||
    pending.reviewer?.kind !== 'agent' ||
    pending.reviewer.agentId !== args.reviewerAgentId
  )
    return staleFiles();
  const listing = `agent:task_get:review_files:${JSON.stringify({ taskId: task.id, ...args.expected, reviewerAgentId: args.reviewerAgentId })}`;
  let offset = 0;
  if (args.cursor !== undefined && args.cursor !== null && args.cursor !== '') {
    const position =
      typeof args.cursor === 'string'
        ? verifyCursorFor(args.organizationId, listing, args.cursor)
        : null;
    if (
      position === null ||
      !/^[1-9]\d*$/.test(position) ||
      !Number.isSafeInteger(Number(position))
    ) {
      throw new TaskError(
        'TASK_REVIEW_INVALID',
        'reviewFileCursor does not belong to this captured review; read task_get again',
      );
    }
    offset = Number(position);
  }
  const entries = sourceEntries(task);
  const memberships = new Map<string, number>();
  for (const { entry } of entries) {
    if (entry !== null)
      memberships.set(entry.fileId, (memberships.get(entry.fileId) ?? 0) + 1);
  }
  if (offset > entries.length) return staleFiles();
  const page = entries.slice(offset, offset + REVIEW_FILES_PAGE_SIZE);
  const metadata = await getTaskReviewFileMetadata(
    tx,
    args.organizationId,
    page.flatMap(({ entry }) => (entry === null ? [] : [entry.fileId])),
  );
  const files = page.map(({ kind, entry }) =>
    entry === null
      ? { kind, unavailableReason: 'invalid_metadata' as const }
      : {
          kind,
          ...entry,
          unavailableReason:
            (memberships.get(entry.fileId) ?? 0) > 1
              ? 'ambiguous_membership'
              : unavailable(entry, metadata.get(entry.fileId)),
        },
  );
  const next = offset + page.length;
  return {
    expected: args.expected,
    files,
    page:
      next < entries.length
        ? {
            isDone: false,
            continueCursor: mintCursorFor(
              args.organizationId,
              listing,
              String(next),
            ),
          }
        : { isDone: true },
    maxStageBytes: REVIEW_FILE_MAX_BYTES,
  };
}

/** File membership is read only after the same live native-review gate as
 * a verdict. A supplied ledger id/ref alone never authorizes these bytes. */
export async function authorizeAgentReviewFile(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  request: TaskAgentReviewStageFileInput,
) {
  const access = await readAgentTaskReviewAccess(tx, auth, request);
  const entries = sourceEntries(access.task).filter(
    ({ entry }) => entry?.fileId === request.fileId,
  );
  const selected = entries[0];
  if (
    entries.length !== 1 ||
    selected?.entry === null ||
    selected === undefined
  ) {
    throw new TaskError(
      'TASK_REVIEW_FILE_UNAVAILABLE',
      'Select one unambiguous file from this review manifest',
      409,
    );
  }
  const metadata = (
    await getTaskReviewFileMetadata(tx, auth.organizationId, [request.fileId])
  ).get(request.fileId);
  const reason = unavailable(selected.entry, metadata);
  if (reason !== null || metadata === undefined) {
    throw new TaskError(
      'TASK_REVIEW_FILE_UNAVAILABLE',
      'This review file is unavailable; read its current manifest for the reason',
      409,
    );
  }
  return {
    organizationId: auth.organizationId,
    issuerRunId: access.issuerRunId,
    kind: selected.kind,
    entry: selected.entry,
    metadata,
  };
}

type AuthorizedFile = Awaited<ReturnType<typeof authorizeAgentReviewFile>>;
const stageResultSchema = z.object({
  staged: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int().nonnegative().safe(),
    }),
  ),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
function hashSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Snapshot-authorized transfer outside DB locks. A late revocation refuses
 * success but cannot erase bytes already delivered while access was valid. */
export async function stageAgentReviewFile(
  sessionId: string,
  raw: unknown,
  authorize: (
    request: TaskAgentReviewStageFileInput,
  ) => Promise<AuthorizedFile>,
) {
  const parsed = taskAgentReviewStageFileSchema.safeParse(raw);
  if (!parsed.success)
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'Select a review file and its exact approval, source run and evidence revision',
    );
  const request = parsed.data;
  const before = await authorize(request);
  const path = `/agent/inputs/reviews/${hashSegment(request.taskId)}/${hashSegment(request.expected.approvalId)}/${request.expected.evidenceRevision}/${hashSegment(before.metadata.storageRef)}/${safePathSegment(before.entry.fileName)}`;
  const url = await stageUrlForBlobRef(
    before.metadata.storageRef,
    before.organizationId,
    Math.max(1, before.metadata.size),
    before.metadata.size,
  );
  if (url === null)
    throw new TaskError(
      'TASK_REVIEW_FILE_UNAVAILABLE',
      'Review file staging is unavailable; no supported signed transfer could be prepared',
      409,
    );
  let result: unknown;
  try {
    result = await sessionStageFiles(sessionId, [{ path, url }]);
  } catch {
    throw new TaskError(
      'TASK_REVIEW_FILE_UNAVAILABLE',
      'The review file transfer failed; no successful staging receipt is available',
      409,
    );
  }
  const staged = stageResultSchema.safeParse(result);
  if (
    !staged.success ||
    staged.data.skipped.length !== 0 ||
    staged.data.staged.length !== 1 ||
    staged.data.staged[0]?.path !== path ||
    staged.data.staged[0]?.bytes !== before.metadata.size
  ) {
    throw new TaskError(
      'TASK_REVIEW_FILE_UNAVAILABLE',
      'The review file was not completely staged; read its current manifest and retry',
      409,
    );
  }
  const after = await authorize(request);
  if (JSON.stringify(before) !== JSON.stringify(after)) return staleFiles();
  return {
    taskId: request.taskId,
    expected: request.expected,
    fileId: request.fileId,
    kind: before.kind,
    fileName: before.entry.fileName,
    fileType: before.entry.fileType,
    path,
    bytes: before.metadata.size,
    ...(before.entry.runId === undefined ? {} : { runId: before.entry.runId }),
  };
}
