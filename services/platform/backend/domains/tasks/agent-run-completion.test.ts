import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { completeAgentRunInTx } from './agent-run-completion.ts';
import { settleAgentRunInTx } from './agent-runs.ts';
import { addTaskComment } from './comments.ts';

vi.mock('./agent-runs.ts', () => ({
  settleAgentRunInTx: vi.fn().mockResolvedValue(true),
}));
vi.mock('./agent-file-metadata.ts', () => ({ saveAgentFileMetadata: vi.fn() }));
vi.mock('./service.ts', () => ({
  agentRecordTaskOutputsTrusted: vi.fn(),
  agentUpdateTaskStatusTrusted: vi.fn(),
}));
vi.mock('./comments.ts', () => ({
  queuedOnTask: (_tx: unknown, _taskId: string, run: () => unknown) => run(),
  addTaskComment: vi.fn(),
}));

const noticeByLocale = {
  en: 'Deliverables:\n- report.md',
  de: 'Ergebnisse:\n- report.md',
  fr: 'Livrables :\n- report.md',
};
const args = {
  organizationId: 'org-1',
  taskId: 't-1',
  agentId: 'a-1',
  runId: 'r-1',
  execId: 'e-1',
  resultText: 'Prüfung abgeschlossen.',
  body: 'Prüfung abgeschlossen.',
  noticeByLocale,
  files: [],
};

beforeEach(() => {
  vi.mocked(addTaskComment).mockReset();
  vi.mocked(settleAgentRunInTx).mockClear();
  vi.mocked(addTaskComment)
    .mockResolvedValueOnce({
      messageId: 'report',
      threadId: 'thread',
      unresolvedMentionTokens: [],
    })
    .mockResolvedValueOnce({
      messageId: 'notice',
      threadId: 'thread',
      unresolvedMentionTokens: [],
    });
});

describe('localized completion transaction', () => {
  it('keeps the report canonical and adds a system notice with every translation under the same election', async () => {
    const tx = (() =>
      Promise.resolve([{ id: 'live' }])) as unknown as TransactionSql;
    await expect(completeAgentRunInTx(tx, args)).resolves.toBe(true);
    expect(addTaskComment).toHaveBeenNthCalledWith(1, tx, expect.any(Object), {
      taskId: 't-1',
      body: args.body,
      author: { actorType: 'agent', actorId: 'a-1' },
    });
    expect(addTaskComment).toHaveBeenNthCalledWith(2, tx, expect.any(Object), {
      taskId: 't-1',
      body: noticeByLocale.en,
      bodyByLocale: noticeByLocale,
      author: { actorType: 'agent', actorId: 'system' },
    });
    expect(settleAgentRunInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        resultText: args.resultText,
        resultMessageId: 'report',
      }),
    );
  });

  it('publishes neither report nor translated notice after cancellation wins', async () => {
    const tx = (() => Promise.resolve([])) as unknown as TransactionSql;
    await expect(completeAgentRunInTx(tx, args)).resolves.toBe(false);
    expect(addTaskComment).not.toHaveBeenCalled();
    expect(settleAgentRunInTx).not.toHaveBeenCalled();
  });

  it('propagates a failed notice write so the enclosing transaction rolls back the report too', async () => {
    vi.mocked(addTaskComment).mockReset();
    vi.mocked(addTaskComment)
      .mockResolvedValueOnce({
        messageId: 'report',
        threadId: 'thread',
        unresolvedMentionTokens: [],
      })
      .mockRejectedValueOnce(new Error('notice write failed'));
    const tx = (() =>
      Promise.resolve([{ id: 'live' }])) as unknown as TransactionSql;
    await expect(completeAgentRunInTx(tx, args)).rejects.toThrow(
      'notice write failed',
    );
    expect(addTaskComment).toHaveBeenCalledTimes(2);
    expect(settleAgentRunInTx).not.toHaveBeenCalled();
  });
});
