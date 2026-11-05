/**
 * What a harness run's worker receives of a task's attachments. The
 * organization's secret scan and PII policy guard a file's text on its way
 * to the model, and a worker that held the file would hand the agent the
 * very bytes they refused — so an attachment they refuse, or are still
 * checking, is staged nowhere, and the brief names it with why. Every other
 * attachment, and every deliverable, is staged as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  staged: [] as { path: string; url: string }[][],
}));

vi.mock('../node_only/sandbox/helpers/stage_url', () => ({
  stageUrlForBlobRef: async (ref: string) => `https://store.test/${ref}`,
}));
vi.mock('../node_only/sandbox/helpers/session_client', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >();
  return {
    ...actual,
    sessionStageFiles: async (
      _sessionId: string,
      files: { path: string; url: string }[],
    ) => {
      io.staged.push(files);
      return {
        staged: files.map((file) => ({ path: file.path, bytes: 1 })),
        skipped: [],
      };
    },
  };
});

const { stageTaskInputs } = await import('./agent_run_host');

beforeEach(() => {
  io.staged = [];
});

describe('stageTaskInputs — attachments the organization’s checks withhold [CHAT-R48]', () => {
  it('stages none of them, and names each with why', async () => {
    const staged = await stageTaskInputs({} as never, {
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      taskId: 'task-1',
      attachments: [
        { fileId: 's3:tale/acme/notes', fileName: 'notes.md' },
        {
          fileId: 's3:tale/acme/keys',
          fileName: 'keys.txt',
          withheld: 'secret-detected',
        },
        {
          fileId: 's3:tale/acme/export',
          fileName: 'export.csv',
          withheld: 'checking',
        },
      ],
      outputs: [{ fileId: 's3:tale/acme/report', fileName: 'report.md' }],
    });

    expect(io.staged).toHaveLength(1);
    expect(io.staged[0]?.map((file) => file.url)).toEqual([
      'https://store.test/s3:tale/acme/notes',
      'https://store.test/s3:tale/acme/report',
    ]);
    expect(staged.attachments).toEqual(['notes.md']);
    expect(staged.outputs).toEqual(['report.md']);
    expect(staged.withheld).toEqual([
      { name: 'keys.txt', why: 'secret-detected' },
      { name: 'export.csv', why: 'checking' },
    ]);
  });

  it('says nothing of withheld files when every attachment is staged', async () => {
    const staged = await stageTaskInputs({} as never, {
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      taskId: 'task-1',
      attachments: [{ fileId: 's3:tale/acme/notes', fileName: 'notes.md' }],
      outputs: [],
    });
    expect(staged).not.toHaveProperty('withheld');
    expect(staged.attachments).toEqual(['notes.md']);
  });
});
