import { describe, expect, it } from 'vitest';

import {
  agentLegacyHandleVariants,
  agentMentionEntry,
  automationMentionEntry,
  buildMentionHandleIndex,
  emailHandle,
  memberMentionEntry,
  mentionRefKey,
  nameHandleForms,
  reservedAgentHandles,
} from './mention-handles';

const ada = memberMentionEntry({
  id: 'UserAda01',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
});
const opsMember = memberMentionEntry({
  id: 'user-ops',
  name: 'Operations',
  email: 'ops@example.com',
});
const invoiceAutomation = automationMentionEntry({
  slug: 'invoice-checker',
  name: 'Invoice checker',
});

describe('handle forms', () => {
  it('spells a name with dots and without spaces', () => {
    expect(nameHandleForms('  Ada  Lovelace ')).toEqual([
      'ada.lovelace',
      'adalovelace',
    ]);
    expect(nameHandleForms('Mia')).toEqual(['mia']);
    expect(nameHandleForms('Büro Agent')).toEqual([]);
    expect(agentLegacyHandleVariants('Research Bot')).toEqual([
      'research.bot',
      'researchbot',
    ]);
  });

  it('takes the local part of an email', () => {
    expect(emailHandle('Ada.K@example.com')).toBe('ada.k');
    expect(emailHandle('ada+test@example.com')).toBeNull();
    expect(emailHandle(null)).toBeNull();
  });

  it('labels a member by name, else by email', () => {
    expect(ada.name).toBe('Ada Lovelace');
    expect(
      memberMentionEntry({ id: 'u2', name: ' ', email: 'noah@example.com' })
        .name,
    ).toBe('noah');
  });
});

describe('who a plain handle names [COLLAB-R11]', () => {
  it('resolves every handle of a person, an automation and an agent', () => {
    const agent = agentMentionEntry({
      id: '3F2B8C1E-7D4A-4B6E-9A1C-2E5F8D7B6C40',
      name: 'My Opus Agent #3',
      handle: 'my-opus-agent-3',
      legacyHandles: [],
    });
    const index = buildMentionHandleIndex([ada, invoiceAutomation, agent]);
    for (const handle of ['ada', 'ada.lovelace', 'adalovelace', 'userada01']) {
      expect(index.resolve(handle)?.id).toBe('UserAda01');
    }
    for (const handle of [
      'invoice-checker',
      'invoice.checker',
      'invoicechecker',
    ]) {
      expect(index.resolve(handle)?.id).toBe('invoice-checker');
    }
    expect(index.resolve('my-opus-agent-3')?.id).toBe(agent.id);
    expect(index.resolve('3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40')?.id).toBe(
      agent.id,
    );
    expect(index.resolve('MY-OPUS-AGENT-3')?.id).toBe(agent.id);
    expect(index.resolve('nobody')).toBeNull();
  });

  it('keeps an older name form on the agent it named, past a rename and a newer agent', () => {
    // "Research Bot" was renamed "QA Bot"; a new agent took the old name.
    const renamed = agentMentionEntry({
      id: 'agent-old',
      name: 'QA Bot',
      handle: 'qa-bot',
      legacyHandles: ['research.bot', 'researchbot'],
    });
    const newcomer = agentMentionEntry({
      id: 'agent-new',
      name: 'ResearchBot',
      handle: 'researchbot',
      legacyHandles: [],
    });
    const index = buildMentionHandleIndex([renamed, newcomer]);
    expect(index.resolve('research.bot')?.id).toBe('agent-old');
    expect(index.resolve('researchbot')?.id).toBe('agent-old');
    expect(index.resolve('qa-bot')?.id).toBe('agent-old');
    expect(index.resolve('qa.bot')?.id).toBe('agent-old');
  });

  it('never lets an agent handle take a store name or an email from someone else', () => {
    const invoiceAgent = agentMentionEntry({
      id: 'agent-invoice',
      name: 'Invoice checker',
      handle: 'invoice-checker',
      legacyHandles: [],
    });
    const opsAgent = agentMentionEntry({
      id: 'agent-ops',
      name: 'Ops',
      handle: 'ops',
      legacyHandles: [],
    });
    const index = buildMentionHandleIndex([
      opsMember,
      invoiceAutomation,
      invoiceAgent,
      opsAgent,
    ]);
    expect(index.resolve('invoice-checker')?.kind).toBe('automation');
    expect(index.resolve('ops')?.kind).toBe('user');
  });

  it('lets an agent handle win over a name form of someone else', () => {
    const mia = memberMentionEntry({
      id: 'user-mia',
      name: 'Mia',
      email: 'mia.k@example.com',
    });
    const miaAgent = agentMentionEntry({
      id: 'agent-mia',
      name: 'Mia',
      handle: 'mia',
      legacyHandles: [],
    });
    const index = buildMentionHandleIndex([mia, miaAgent]);
    expect(index.resolve('mia')?.id).toBe('agent-mia');
  });

  it('gives a shared handle to the entry listed last within one tier', () => {
    const first = memberMentionEntry({ id: 'u1', name: 'Ada', email: null });
    const second = memberMentionEntry({ id: 'u2', name: 'Ada', email: null });
    const index = buildMentionHandleIndex([first, second]);
    expect(index.resolve('ada')?.id).toBe('u2');
  });

  it('prefers the actor a comment was saved naming', () => {
    const first = memberMentionEntry({ id: 'u1', name: 'Ada', email: null });
    const second = memberMentionEntry({ id: 'u2', name: 'Ada', email: null });
    const index = buildMentionHandleIndex([first, second]);
    expect(
      index.resolve('ada', new Set([mentionRefKey({ kind: 'user', id: 'u1' })]))
        ?.id,
    ).toBe('u1');
    expect(index.byRef({ kind: 'user', id: 'u1' })).toBe(first);
    expect(index.byRef({ kind: 'agent', id: 'u1' })).toBeNull();
  });
});

describe('reserved agent handles', () => {
  it('are the store names and email local parts of the organization', () => {
    expect(
      [...reservedAgentHandles([ada, opsMember, invoiceAutomation])].toSorted(),
    ).toEqual(['ada', 'invoice-checker', 'ops']);
  });
});
