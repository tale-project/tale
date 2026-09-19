import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { updateMessageText } from '../threads/store.ts';
import { editTaskComment } from './comments.ts';

vi.mock('../collab/mention-directory.ts', () => ({
  resolveSurfaceMentions: vi.fn().mockResolvedValue({ mentions: [] }),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow: vi
    .fn()
    .mockResolvedValue({ id: 'p-1', organizationId: 'org-1' }),
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  loadTaskOrThrow: vi.fn().mockResolvedValue({
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Check figures',
  }),
  assertTaskWritable: vi.fn(),
}));
vi.mock('../threads/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../threads/store.ts')>()),
  updateMessageText: vi.fn(),
}));

describe('editing a localized comment', () => {
  it('replaces the canonical text and clears translations that would hide the edit', async () => {
    const statements: string[] = [];
    const tag = (strings: TemplateStringsArray) => {
      const text = strings.join('?').replace(/\s+/g, ' ');
      statements.push(text);
      return Promise.resolve(
        text.includes('SELECT task_id')
          ? [
              {
                taskId: 't-1',
                authorType: 'user',
                authorId: 'u-1',
                mentions: [],
              },
            ]
          : [],
      );
    };
    const tx = tag as unknown as TransactionSql;
    await editTaskComment(
      tx,
      { organizationId: 'org-1', userId: 'u-1', role: 'owner', teamIds: [] },
      { messageId: 'm-1', body: 'Corrected figures.' },
    );
    expect(updateMessageText).toHaveBeenCalledWith(
      tx,
      'm-1',
      'Corrected figures.',
    );
    expect(
      statements.find((text) =>
        text.includes('UPDATE app.task_discussion_message_meta'),
      ),
    ).toContain('body_by_locale = NULL');
  });
});
