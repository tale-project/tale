import { describe, expect, it, vi } from 'vitest';

import {
  MAX_STAGED_TASK_OUTPUTS,
  selectTaskOutputsForStaging,
} from '../../../lib/agent/task-brief.ts';
import type { ActionCtx } from '../lib/ctx';
import type { SessionStageFile } from '../node_only/sandbox/helpers/session_client';
import {
  partitionTaskInputSkips,
  type PlannedTaskInput,
  stageTaskInputs,
} from './agent_run_host.ts';

const stage = vi.hoisted(() => ({ files: vi.fn(), url: vi.fn() }));
vi.mock(
  '../node_only/sandbox/helpers/session_client',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../node_only/sandbox/helpers/session_client')
    >()),
    sessionStageFiles: stage.files,
  }),
);
vi.mock('../node_only/sandbox/helpers/stage_url', () => ({
  stageUrlForBlobRef: stage.url,
}));

/**
 * What a skipped input means to the run. The blob door passes the store's
 * 404 through, so `http_404` under an attachment is the person's input gone
 * — the run fails by the file's SHOWN name, since the on-disk name may carry
 * a collision suffix — while the same under an earlier deliverable only
 * leaves the brief. Every other reason stays the infra fault it is, each
 * skip listed with its reason.
 */
const DIR = '/agent/inputs/task-1';
const planned = new Map<string, PlannedTaskInput>([
  [
    `${DIR}/attachments/Afos.xlsx`,
    { kind: 'attachments', stagedName: 'Afos.xlsx', fileName: 'Afos.xlsx' },
  ],
  [
    `${DIR}/attachments/2-brief.pdf`,
    { kind: 'attachments', stagedName: '2-brief.pdf', fileName: 'brief.pdf' },
  ],
  [
    `${DIR}/outputs/report.docx`,
    { kind: 'outputs', stagedName: 'report.docx', fileName: 'report.docx' },
  ],
]);

describe('partitionTaskInputSkips', () => {
  it('lands everything when nothing was skipped', () => {
    expect(partitionTaskInputSkips([], planned)).toEqual({
      kind: 'staged',
      droppedOutputs: [],
    });
  });

  it('fails the run by the shown name of an attachment the store no longer holds', () => {
    expect(
      partitionTaskInputSkips(
        [{ path: `${DIR}/attachments/2-brief.pdf`, reason: 'http_404' }],
        planned,
      ),
    ).toEqual({
      kind: 'inputs_missing',
      fileNames: ['brief.pdf'],
      droppedOutputs: [],
    });
  });

  it('leaves a gone earlier deliverable out of the brief instead of failing', () => {
    expect(
      partitionTaskInputSkips(
        [{ path: `${DIR}/outputs/report.docx`, reason: 'http_404' }],
        planned,
      ),
    ).toEqual({ kind: 'staged', droppedOutputs: ['report.docx'] });
  });

  it('reports both when attachments and deliverables are gone', () => {
    expect(
      partitionTaskInputSkips(
        [
          { path: `${DIR}/outputs/report.docx`, reason: 'http_404' },
          { path: `${DIR}/attachments/Afos.xlsx`, reason: 'http_404' },
          { path: `${DIR}/attachments/2-brief.pdf`, reason: 'http_404' },
        ],
        planned,
      ),
    ).toEqual({
      kind: 'inputs_missing',
      fileNames: ['Afos.xlsx', 'brief.pdf'],
      droppedOutputs: ['report.docx'],
    });
  });

  it('keeps any other skip an infra fault, every skip listed with its reason', () => {
    expect(
      partitionTaskInputSkips(
        [
          { path: `${DIR}/attachments/Afos.xlsx`, reason: 'http_502' },
          { path: `${DIR}/outputs/report.docx`, reason: 'http_404' },
        ],
        planned,
      ),
    ).toEqual({
      kind: 'failed',
      message: `staging task inputs failed: ${DIR}/attachments/Afos.xlsx (http_502), ${DIR}/outputs/report.docx (http_404)`,
    });
    expect(
      partitionTaskInputSkips(
        [{ path: `${DIR}/attachments/Afos.xlsx`, reason: 'timeout' }],
        planned,
      ).kind,
    ).toBe('failed');
  });

  it('treats a 404 on a path it never planned as a fault, not a gone file', () => {
    expect(
      partitionTaskInputSkips(
        [{ path: `${DIR}/attachments/stranger.pdf`, reason: 'http_404' }],
        planned,
      ).kind,
    ).toBe('failed');
  });
});

describe('selectTaskOutputsForStaging', () => {
  it('keeps all outputs when the task is within the mirror cap', () => {
    const outputs = [{ fileName: 'first.md' }, { fileName: 'latest.md' }];
    expect(selectTaskOutputsForStaging(outputs, 2)).toEqual({
      selected: outputs,
      omitted: 0,
    });
  });

  it('keeps the newest outputs and reports the retained history omitted', () => {
    const outputs = Array.from({ length: 5 }, (_, index) => `out-${index}`);
    expect(selectTaskOutputsForStaging(outputs, 2)).toEqual({
      selected: ['out-3', 'out-4'],
      omitted: 3,
    });
  });

  it('does not let a non-positive cap bypass bounding', () => {
    expect(selectTaskOutputsForStaging(['old-1', 'old-2'], 0)).toEqual({
      selected: [],
      omitted: 2,
    });
  });

  it.each([64, 65])(
    'selects the newest 64 from %i outputs with the default cap',
    (count) => {
      const outputs = Array.from({ length: count }, (_, index) => index);
      expect(selectTaskOutputsForStaging(outputs)).toEqual({
        selected: outputs.slice(count - 64),
        omitted: count - 64,
      });
    },
  );

  it('uses the production cap so a large retained history stays bounded', () => {
    const outputs = Array.from(
      { length: MAX_STAGED_TASK_OUTPUTS + 7 },
      (_, index) => index,
    );
    const selection = selectTaskOutputsForStaging(outputs);
    expect(selection.selected).toHaveLength(MAX_STAGED_TASK_OUTPUTS);
    expect(selection.omitted).toBe(7);
    expect(selection.selected[0]).toBe(7);
  });
});

describe('the staging of a task’s files', () => {
  it('hands each file’s recorded size to the stager, which packs large ones apart', async () => {
    stage.url.mockImplementation(
      async (ref: string) => `https://platform.test/api/sandbox-blob/${ref}`,
    );
    stage.files.mockResolvedValue({ staged: [], skipped: [] });

    await stageTaskInputs({} as ActionCtx, {
      organizationId: 'org-1',
      sessionId: 'ses-1',
      taskId: 'task-1',
      attachments: [
        { fileId: 's3:org-1/a', fileName: 'Afos.xlsx', fileSize: 80_000_000 },
      ],
      // An entry from before sizes were recorded stays of unknown size.
      outputs: [{ fileId: 's3:org-1/b', fileName: 'report.docx' }],
    });

    const files = (stage.files.mock.calls[0]?.[1] ?? []) as SessionStageFile[];
    expect(
      files.map((file) => ({
        leaf: file.path.split('/').slice(-2).join('/'),
        expectedBytes: file.expectedBytes,
      })),
    ).toEqual([
      { leaf: 'attachments/Afos.xlsx', expectedBytes: 80_000_000 },
      { leaf: 'outputs/report.docx', expectedBytes: undefined },
    ]);
  });
});
