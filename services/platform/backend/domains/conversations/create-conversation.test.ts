import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));

import { createConversation } from './service.ts';

type InsertCapture = {
  query: string;
  values: unknown[];
};

function fakeTx(capture: InsertCapture[]): TransactionSql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?');
    if (query.includes('INSERT INTO app.conversations')) {
      capture.push({ query, values });
      return Promise.resolve([{ id: 'conv_test' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string) => text,
  }) as unknown as TransactionSql;
}

describe('createConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('persists assigneeUserId and assigneeTeamId on insert', async () => {
    const capture: InsertCapture[] = [];
    const id = await createConversation(fakeTx(capture), {
      organizationId: 'org_1',
      contactId: 'contact_1',
      assigneeUserId: 'user_1',
      assigneeTeamId: 'team_1',
      subject: 'Hello',
      status: 'open',
      channel: 'email',
      direction: 'outbound',
      connectorName: 'imap-smtp',
    });
    expect(id).toBe('conv_test');
    expect(capture).toHaveLength(1);
    const inserted = capture[0];
    expect(inserted?.query).toContain('assignee_team_id');
    // VALUES order: org, contact, assignee_user, assignee_team, …
    expect(inserted?.values.slice(0, 4)).toEqual([
      'org_1',
      'contact_1',
      'user_1',
      'team_1',
    ]);
  });

  test('stores null team when assigneeTeamId is omitted', async () => {
    const capture: InsertCapture[] = [];
    await createConversation(fakeTx(capture), {
      organizationId: 'org_1',
      assigneeUserId: 'user_1',
      subject: 'Solo',
    });
    expect(capture[0]?.values.slice(0, 4)).toEqual([
      'org_1',
      null,
      'user_1',
      null,
    ]);
  });
});
