/**
 * Routing assigns a new conversation by where it arrived, through the same
 * writes the Inbox doors use, as the system. Its audit trail must say what
 * it did per dimension: a team route used to be recorded as
 * `assign_conversation`, the person action, whatever it set.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog, readGovernancePolicyForOrg, findOrganizationMember } =
  vi.hoisted(() => ({
    createAuditLog: vi.fn(async () => undefined),
    readGovernancePolicyForOrg: vi.fn(),
    findOrganizationMember: vi.fn(async () => ({ role: 'member' })),
  }));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../collab/service.ts', () => ({
  notifyConversationAssigned: vi.fn(async () => undefined),
  notifyConversationAssignedTeam: vi.fn(async () => undefined),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config.ts', () => ({ readGovernancePolicyForOrg }));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember,
  getUserTeamIds: vi.fn(async () => []),
}));

import { applyConversationRouting } from './routing.ts';

const ORG = 'o1';

/** Answers the team lookup with `teamOrg`, records every statement. */
function fakeTx(teamOrg: string) {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(
      text.includes('FROM "team"') ? [{ organizationId: teamOrg }] : [],
    );
  };
  const tx = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    organizationId: ORG,
    subject: 'Invoice question',
    status: 'open',
    channel: 'email',
    connectorName: 'imap-smtp',
    assigneeUserId: null,
    assigneeTeamId: null,
    metadata: { to: [{ address: 'billing@acme.test' }] },
    ...overrides,
  };
}

function actions(): unknown[] {
  return createAuditLog.mock.calls.map((call) => {
    const [, entry] = call as unknown as [
      unknown,
      { action: string; actorType: string },
    ];
    return [entry.action, entry.actorType];
  });
}

beforeEach(() => vi.clearAllMocks());

describe('applyConversationRouting', () => {
  it('audits a team route as a team assignment, by the system', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      rules: [{ address: 'billing@acme.test', teamId: 't-billing' }],
      sourceRules: [],
    });
    const { tx } = fakeTx(ORG);

    await expect(applyConversationRouting(tx, conversation())).resolves.toBe(
      true,
    );
    expect(actions()).toEqual([['assign_conversation_team', 'system']]);
  });

  it('audits each dimension of a team-and-person route on its own', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      rules: [
        { address: 'billing@acme.test', teamId: 't-billing', userId: 'u-1' },
      ],
      sourceRules: [],
    });
    const { tx } = fakeTx(ORG);

    await applyConversationRouting(tx, conversation());
    expect(actions()).toEqual([
      ['assign_conversation_team', 'system'],
      ['assign_conversation', 'system'],
    ]);
  });

  it('routes by the mailbox it arrived on', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      rules: [],
      sourceRules: [{ mailbox: 'cred-general', teamId: 't-general' }],
    });
    const { tx, statements } = fakeTx(ORG);

    await expect(
      applyConversationRouting(tx, conversation({ metadata: null }), {
        credentialId: 'cred-general',
      }),
    ).resolves.toBe(true);
    expect(
      statements.some((text) => text.includes('SET assignee_team_id')),
    ).toBe(true);
  });

  it('routes an API conversation by its source', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      rules: [],
      sourceRules: [{ apiSource: 'helpdesk', teamId: 't-helpdesk' }],
    });
    const { tx } = fakeTx(ORG);

    await expect(
      applyConversationRouting(
        tx,
        conversation({
          channel: 'api',
          connectorName: 'helpdesk',
          metadata: null,
        }),
      ),
    ).resolves.toBe(true);
    expect(actions()).toEqual([['assign_conversation_team', 'system']]);
  });

  it('leaves the conversation untouched when a rule names a team from elsewhere', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      rules: [
        { address: 'billing@acme.test', teamId: 't-gone', userId: 'u-1' },
      ],
      sourceRules: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, statements } = fakeTx('another-org');

    await expect(applyConversationRouting(tx, conversation())).resolves.toBe(
      false,
    );
    expect(statements.some((text) => text.startsWith('UPDATE'))).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never re-routes a conversation that is already assigned', async () => {
    const { tx } = fakeTx(ORG);
    await expect(
      applyConversationRouting(tx, conversation({ assigneeTeamId: 't-x' })),
    ).resolves.toBe(false);
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
  });
});
