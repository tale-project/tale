import type { TaskAgentReviewStageFileInput } from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStageFiles } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { stageUrlForBlobRef } from '../../core/node_only/sandbox/helpers/stage_url.ts';
import { getTaskReviewFileMetadata } from '../files/service.ts';
import {
  authorizeAgentReviewFile,
  readAgentTaskReviewFiles,
  stageAgentReviewFile,
} from './agent-review-files.ts';
import { readAgentTaskReviewAccess } from './agent-review.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { loadTaskOrThrow, type TaskRow } from './service.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sessionStageFiles: vi.fn(),
}));
vi.mock('../../core/node_only/sandbox/helpers/stage_url.ts', () => ({
  stageUrlForBlobRef: vi.fn(),
}));
vi.mock('../files/service.ts', () => ({ getTaskReviewFileMetadata: vi.fn() }));
vi.mock('./agent-review.ts', () => ({ readAgentTaskReviewAccess: vi.fn() }));
vi.mock('./reviews.ts', () => ({ getPendingReviewForTask: vi.fn() }));
vi.mock('./service.ts', () => ({ loadTaskOrThrow: vi.fn() }));

const tx = {} as TransactionSql;
const auth = {
  organizationId: 'org',
  projectId: 'project',
  agentId: 'reviewer',
  sessionId: 'session',
  execId: 'exec',
};
const request: TaskAgentReviewStageFileInput = {
  operation: 'stage_file',
  taskId: 'task',
  fileId: 'file',
  expected: {
    approvalId: 'approval',
    runId: 'source',
    evidenceRevision: 'a'.repeat(64),
  },
};
const entry = {
  fileId: 'file',
  fileName: '../../report.bin',
  fileType: 'application/octet-stream',
  fileSize: 4,
  runId: 'source',
};
const metadata = {
  id: 'file',
  organizationId: 'org',
  storageRef: 's3:acme/output',
  fileName: 'report.bin',
  contentType: 'application/octet-stream',
  size: 4,
  uploadedBy: null,
  documentId: null,
  threadId: null,
  conversationId: null,
  createdAt: 1,
  documentBound: false,
};
const task = {
  id: 'task',
  organizationId: 'org',
  projectId: 'project',
  status: 'in_review',
  attachments: [],
  outputs: [entry],
} as unknown as TaskRow;
const manifestArgs = {
  organizationId: 'org',
  projectId: 'project',
  taskId: request.taskId,
  expected: request.expected,
  reviewerAgentId: 'reviewer',
};
const access = {
  task,
  approval: { id: 'approval' },
  source: { runId: 'source' },
  issuerRunId: 'issuer',
} as Awaited<ReturnType<typeof readAgentTaskReviewAccess>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadTaskOrThrow).mockResolvedValue(task);
  vi.mocked(readAgentTaskReviewAccess).mockResolvedValue(access);
  vi.mocked(getPendingReviewForTask).mockResolvedValue({
    approvalId: 'approval',
    runId: 'source',
    evidenceRevision: request.expected.evidenceRevision,
    reviewer: { kind: 'agent', agentId: 'reviewer' },
  } as Awaited<ReturnType<typeof getPendingReviewForTask>>);
  vi.mocked(getTaskReviewFileMetadata).mockResolvedValue(
    new Map([['file', metadata]]),
  );
  vi.mocked(stageUrlForBlobRef).mockResolvedValue(
    'https://signed-stage.test/private-capability',
  );
  vi.mocked(sessionStageFiles).mockImplementation(async (_session, files) => ({
    staged: [{ path: files[0]!.path, bytes: 4 }],
    skipped: [],
  }));
});

describe('review file manifest and selection', () => {
  it('reports stored provenance without exposing storage references or claiming a read', async () => {
    const result = await readAgentTaskReviewFiles(tx, manifestArgs);
    expect(result.files).toEqual([
      { kind: 'output', ...entry, unavailableReason: null },
    ]);
    expect(JSON.stringify(result)).not.toContain(metadata.storageRef);
    expect(result).toMatchObject({
      page: { isDone: true },
      maxStageBytes: 20 * 1024 * 1024,
    });
    expect(sessionStageFiles).not.toHaveBeenCalled();
  });
  it('pages all 61 entries with one bounded metadata query per page', async () => {
    const outputs = Array.from({ length: 61 }, (_, index) => ({
      ...entry,
      fileId: `file-${index}`,
    }));
    vi.mocked(loadTaskOrThrow).mockResolvedValue({ ...task, outputs });
    const first = await readAgentTaskReviewFiles(tx, manifestArgs);
    expect(first.files).toHaveLength(50);
    expect(first.page.isDone).toBe(false);
    const second = await readAgentTaskReviewFiles(tx, {
      ...manifestArgs,
      cursor: first.page.continueCursor,
    });
    expect(second.files).toHaveLength(11);
    expect(second.page.isDone).toBe(true);
    expect(getTaskReviewFileMetadata).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(getTaskReviewFileMetadata)
        .mock.calls.map((args) => args[2].length),
    ).toEqual([50, 11]);
  });
  it.each(['taskId', 'reviewerAgentId', 'evidenceRevision'] as const)(
    'rejects a manifest cursor after changing %s',
    async (field) => {
      vi.mocked(loadTaskOrThrow).mockResolvedValue({
        ...task,
        outputs: Array.from({ length: 51 }, () => entry),
      });
      const first = await readAgentTaskReviewFiles(tx, manifestArgs);
      const args = { ...manifestArgs, cursor: first.page.continueCursor };
      if (field === 'taskId') {
        args.taskId = 'other';
        vi.mocked(loadTaskOrThrow).mockResolvedValue({ ...task, id: 'other' });
      } else if (field === 'reviewerAgentId') {
        args.reviewerAgentId = 'other';
        vi.mocked(getPendingReviewForTask).mockResolvedValue({
          ...(await getPendingReviewForTask(tx, 'org', 'task'))!,
          reviewer: { kind: 'agent', agentId: 'other' },
        });
      } else {
        args.expected = {
          ...request.expected,
          evidenceRevision: 'b'.repeat(64),
        };
        vi.mocked(getPendingReviewForTask).mockResolvedValue({
          ...(await getPendingReviewForTask(tx, 'org', 'task'))!,
          evidenceRevision: args.expected.evidenceRevision,
        });
      }
      await expect(readAgentTaskReviewFiles(tx, args)).rejects.toMatchObject({
        code: 'TASK_REVIEW_INVALID',
      });
    },
  );
  it.each([
    ['metadata_missing', undefined, entry],
    ['document_access_required', { ...metadata, documentBound: true }, entry],
    ['unsupported_storage', { ...metadata, storageRef: 'old-storage' }, entry],
    ['invalid_metadata', { ...metadata, size: 3 }, entry],
    ['invalid_metadata', metadata, { ...entry, fileName: 'bad\0name' }],
    [
      'too_large',
      { ...metadata, size: 20 * 1024 * 1024 + 1 },
      { ...entry, fileSize: 20 * 1024 * 1024 + 1 },
    ],
  ] as const)(
    'keeps %s visible but unavailable for staging',
    async (reason, row, output) => {
      const changed = { ...task, outputs: [output] };
      vi.mocked(loadTaskOrThrow).mockResolvedValue(changed);
      vi.mocked(readAgentTaskReviewAccess).mockResolvedValue({
        ...access,
        task: changed,
      });
      vi.mocked(getTaskReviewFileMetadata).mockResolvedValue(
        row === undefined ? new Map() : new Map([['file', row]]),
      );
      expect(
        (await readAgentTaskReviewFiles(tx, manifestArgs)).files[0],
      ).toMatchObject({ unavailableReason: reason });
      await expect(
        authorizeAgentReviewFile(tx, auth, request),
      ).rejects.toMatchObject({
        code: 'TASK_REVIEW_FILE_UNAVAILABLE',
        message:
          'This review file is unavailable; read its current manifest for the reason',
      });
      expect(sessionStageFiles).not.toHaveBeenCalled();
    },
  );
  it.each([
    { outputs: [] },
    { outputs: [entry, entry] },
    { outputs: [{ malformed: true }] },
  ])(
    'refuses missing, ambiguous or malformed membership %j',
    async ({ outputs }) => {
      vi.mocked(readAgentTaskReviewAccess).mockResolvedValue({
        ...access,
        task: { ...task, outputs },
      });
      await expect(
        authorizeAgentReviewFile(tx, auth, request),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_FILE_UNAVAILABLE' });
      expect(getTaskReviewFileMetadata).not.toHaveBeenCalled();
    },
  );
  it('does not invent legacy output provenance', async () => {
    const { runId: _runId, ...legacy } = entry;
    vi.mocked(loadTaskOrThrow).mockResolvedValue({
      ...task,
      outputs: [legacy],
    });
    expect(
      (await readAgentTaskReviewFiles(tx, manifestArgs)).files[0],
    ).not.toHaveProperty('runId');
  });
  it('marks duplicate file membership unavailable in the manifest before an agent selects it', async () => {
    vi.mocked(loadTaskOrThrow).mockResolvedValue({
      ...task,
      attachments: [entry],
      outputs: [entry],
    });
    const result = await readAgentTaskReviewFiles(tx, manifestArgs);
    expect(result.files).toHaveLength(2);
    expect(
      result.files.every(
        (file) => file.unavailableReason === 'ambiguous_membership',
      ),
    ).toBe(true);
  });
});

describe('review file snapshot transfer', () => {
  const authorize = () => authorizeAgentReviewFile(tx, auth, request);
  it('reuses the signed stage path, returns exact identity and rechecks after bytes', async () => {
    const ordering: string[] = [];
    const read = vi.fn(async () => {
      ordering.push('authorize');
      return authorize();
    });
    vi.mocked(sessionStageFiles).mockImplementation(async (_session, files) => {
      ordering.push('stage');
      return { staged: [{ path: files[0]!.path, bytes: 4 }], skipped: [] };
    });
    const result = await stageAgentReviewFile('session', request, read);
    expect(ordering).toEqual(['authorize', 'stage', 'authorize']);
    expect(result).toMatchObject({
      expected: request.expected,
      fileId: 'file',
      bytes: 4,
      runId: 'source',
    });
    expect(result.path).toMatch(
      /^\/agent\/inputs\/reviews\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\/\.\._\.\._report.bin$/,
    );
    expect(stageUrlForBlobRef).toHaveBeenCalledWith(
      metadata.storageRef,
      'org',
      4,
      4,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private-capability|storageRef|https:/,
    );
    expect(
      (await stageAgentReviewFile('session', request, authorize)).path,
    ).toBe(result.path);
  });
  it.each([
    'TASK_REVIEW_FORBIDDEN',
    'TASK_REVIEW_STALE',
    'TASK_REVIEW_POLICY_UNAVAILABLE',
  ])('returns %s with no transfer when initial access fails', async (code) => {
    vi.mocked(readAgentTaskReviewAccess).mockRejectedValue(
      Object.assign(new Error('Refused'), { code }),
    );
    await expect(
      stageAgentReviewFile('session', request, authorize),
    ).rejects.toMatchObject({ code });
    expect(sessionStageFiles).not.toHaveBeenCalled();
  });
  it('does not report success after a concurrent revocation, while retaining the historical path', async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(authorize)
      .mockRejectedValueOnce(
        Object.assign(new Error('Revoked'), { code: 'TASK_REVIEW_FORBIDDEN' }),
      );
    await expect(
      stageAgentReviewFile('session', request, read),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_FORBIDDEN' });
    expect(sessionStageFiles).toHaveBeenCalledOnce();
  });
  it('refuses a changed blob ledger binding after transfer', async () => {
    const before = await authorize();
    const read = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        ...before,
        metadata: { ...before.metadata, documentBound: true },
      });
    await expect(
      stageAgentReviewFile('session', request, read),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_STALE' });
  });
  it.each([
    { staged: [], skipped: [] },
    { staged: [], skipped: [{ path: '/agent/skip', reason: 'http_403' }] },
    { staged: [{ path: '/agent/wrong', bytes: 4 }], skipped: [] },
    { unexpected: true },
  ])(
    'never claims a skipped, partial or malformed daemon receipt %j',
    async (result) => {
      vi.mocked(sessionStageFiles).mockResolvedValue(
        result as Awaited<ReturnType<typeof sessionStageFiles>>,
      );
      await expect(
        stageAgentReviewFile('session', request, authorize),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_FILE_UNAVAILABLE' });
    },
  );
  it.each([3, 5, 20 * 1024 * 1024 + 1])(
    'refuses a byte count of %s differing from the selected immutable metadata',
    async (bytes) => {
      vi.mocked(sessionStageFiles).mockImplementation(
        async (_session, files) => ({
          staged: [{ path: files[0]!.path, bytes }],
          skipped: [],
        }),
      );
      await expect(
        stageAgentReviewFile('session', request, authorize),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_FILE_UNAVAILABLE' });
    },
  );
});
