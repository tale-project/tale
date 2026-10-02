import { describe, expect, it } from 'vitest';

import {
  partitionTaskInputSkips,
  type PlannedTaskInput,
} from './agent_run_host.ts';

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
