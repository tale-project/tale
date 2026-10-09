import { describe, expect, it } from 'vitest';

import {
  AGENT_HANDLE_BASE_MAX,
  AGENT_HANDLE_MAX,
  agentHandleBase,
  agentHandleCandidate,
  deriveAgentHandles,
  handleFitsBase,
  nextAgentHandle,
  renameKeepsHandle,
} from './agent-handle';

/** The shape the column's CHECK and the API's pattern hold a handle to:
 * lowercase letters and digits in runs joined by single hyphens. */
const HANDLE_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('an agent handle is its name in plain letters [PROJ-R18]', () => {
  it.each([
    ['My Opus Agent #3', 'my-opus-agent-3'],
    ['Research Bot', 'research-bot'],
    ['Büro Agent', 'buero-agent'],
    ['BÜRO ÄRGER ÖL', 'buero-aerger-oel'],
    ['Straße & Café', 'strasse-cafe'],
    ['GROẞE Sache', 'grosse-sache'],
    ["O'Brien's agent", 'obriens-agent'],
    ['O’Brien’s agent', 'obriens-agent'],
    ['Coder (v2)', 'coder-v2'],
    ['Søren Łódź Þór Æsir Œuvre', 'soren-lodz-thor-aesir-oeuvre'],
    ['Crème brûlée', 'creme-brulee'],
    ['  --Leading and trailing--  ', 'leading-and-trailing'],
    ['ﬁnance Ａgent', 'finance-agent'],
    ['发票助手', 'agent'],
    ['🚀', 'agent'],
    ['Standard agent', 'standard-agent'],
    ['Standard-Agent', 'standard-agent'],
    ['Agent standard', 'agent-standard'],
  ])('%s → %s', (name, handle) => {
    expect(agentHandleBase(name)).toBe(handle);
    expect(handle).toMatch(HANDLE_SHAPE);
  });

  it('cuts a long name to the base limit without a trailing hyphen', () => {
    const name = `${'a'.repeat(47)} ${'b'.repeat(12)}`;
    const base = agentHandleBase(name);
    expect(base).toBe('a'.repeat(47));
    expect(base.length).toBeLessThanOrEqual(AGENT_HANDLE_BASE_MAX);

    const sixty = 'Quarterly revenue reconciliation agent for the finance team';
    expect(agentHandleBase(sixty)).toBe(
      'quarterly-revenue-reconciliation-agent-for-the-f',
    );
  });

  it('adds -02, -03 … -99 and then -100 when the base is taken', () => {
    expect(agentHandleCandidate('my-opus-agent-3', 1)).toBe('my-opus-agent-3');
    expect(agentHandleCandidate('my-opus-agent-3', 2)).toBe(
      'my-opus-agent-3-02',
    );
    expect(agentHandleCandidate('my-opus-agent-3', 99)).toBe(
      'my-opus-agent-3-99',
    );
    expect(agentHandleCandidate('my-opus-agent-3', 100)).toBe(
      'my-opus-agent-3-100',
    );

    const taken = new Set(['my-opus-agent-3']);
    expect(nextAgentHandle('my-opus-agent-3', taken)).toBe(
      'my-opus-agent-3-02',
    );
    const crowded = new Set(
      Array.from({ length: 99 }, (_, i) =>
        agentHandleCandidate('agent', i + 1),
      ),
    );
    expect(nextAgentHandle('agent', crowded)).toBe('agent-100');
  });

  it('keeps the suffix and cuts the base when a suffix would overflow', () => {
    const base = 'a'.repeat(AGENT_HANDLE_BASE_MAX);
    expect(agentHandleCandidate(base, 100)).toHaveLength(52);
    const long = agentHandleCandidate(base, 12345);
    expect(long.endsWith('-12345')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(AGENT_HANDLE_MAX);
    expect(long).toMatch(HANDLE_SHAPE);
  });

  it('knows which handles a base offers', () => {
    expect(handleFitsBase('qa-bot', 'qa-bot')).toBe(true);
    expect(handleFitsBase('qa-bot-02', 'qa-bot')).toBe(true);
    expect(handleFitsBase('qa-bot-100', 'qa-bot')).toBe(true);
    expect(handleFitsBase('my-opus-agent-3', 'my-opus-agent')).toBe(false);
    expect(handleFitsBase('qa-bot-1', 'qa-bot')).toBe(false);
    expect(handleFitsBase('qa-bot-01', 'qa-bot')).toBe(false);
    expect(handleFitsBase('research-bot', 'qa-bot')).toBe(false);
  });

  it('keeps a handle across a rename only while it still reads as the new name [PROJ-R19]', () => {
    expect(renameKeepsHandle('qa-bot', 'QA Bot', 'qa bot')).toBe(true);
    expect(renameKeepsHandle('qa-bot-02', 'QA Bot', 'QA-Bot!')).toBe(true);
    expect(renameKeepsHandle('qa-bot', 'Research Bot', 'QA Bot')).toBe(true);
    expect(renameKeepsHandle('research-bot', 'Research Bot', 'QA Bot')).toBe(
      false,
    );
    // The old name's own handle, not a twin's suffix: the number goes too.
    expect(
      renameKeepsHandle('tax-agent-2025', 'Tax agent 2025', 'Tax agent'),
    ).toBe(false);
    expect(renameKeepsHandle('tax-agent-10', 'Tax agent', 'tax agent')).toBe(
      true,
    );
  });

  it('gives the oldest agent the clean handle and skips reserved ones', () => {
    const minted = deriveAgentHandles(
      [
        { id: 'b', name: 'My Opus Agent 3', handle: null, createdAt: 2 },
        { id: 'a', name: 'My Opus Agent #3', handle: null, createdAt: 1 },
        { id: 'c', name: '发票助手', handle: null, createdAt: 3 },
        { id: 'd', name: '🚀', handle: null, createdAt: 4 },
        { id: 'e', name: 'Invoice checker', handle: null, createdAt: 5 },
        { id: 'f', name: 'Kept', handle: 'agent', createdAt: 0 },
      ],
      new Set(['invoice-checker']),
    );
    expect(Object.fromEntries(minted)).toEqual({
      a: 'my-opus-agent-3',
      b: 'my-opus-agent-3-02',
      c: 'agent-02',
      d: 'agent-03',
      e: 'invoice-checker-02',
    });
  });

  it('moves an agent off a handle a person or an automation came to answer to [PROJ-R19]', () => {
    // Ines's "Invoice checker" held `invoice-checker` until Marco deployed
    // an automation of that store name: the automation's claim is the
    // stronger, so the agent answers to the next free handle.
    const minted = deriveAgentHandles(
      [
        {
          id: 'a',
          name: 'Invoice checker',
          handle: 'invoice-checker',
          createdAt: 1,
        },
        {
          id: 'b',
          name: 'Invoice checker 2',
          handle: 'invoice-checker-2',
          createdAt: 2,
        },
        { id: 'c', name: 'Ops', handle: 'ops', createdAt: 3 },
      ],
      new Set(['invoice-checker']),
    );
    expect(Object.fromEntries(minted)).toEqual({ a: 'invoice-checker-02' });
  });
});
