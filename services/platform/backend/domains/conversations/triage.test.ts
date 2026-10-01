/**
 * The pure halves of Inbox triage: what a pack reads of a customer message,
 * the link it hands out, and the verdict guards that run before a
 * transaction opens. The listing and the stamp are SQL, proven by the
 * integration check's conversations lane.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  conversationUrl,
  inboundTextOf,
  normalizeTriageVerdicts,
  recordConversationTriage,
  TRIAGE_BATCH_MAX,
  TRIAGE_REASON_MAX_CHARS,
  TRIAGE_TEXT_MAX_CHARS,
} from './triage.ts';

describe('inboundTextOf', () => {
  it('prefers the plain text the ingest kept on the message', () => {
    expect(
      inboundTextOf('<p>Rendered <b>html</b></p>', {
        text: 'Plain text\r\n\r\n\r\nwith  folds   \n',
      }),
    ).toBe('Plain text\n\nwith  folds');
  });

  it('strips the HTML when no plain text was kept', () => {
    expect(
      inboundTextOf('<div>Hello<br>there &amp; thanks</div>', { text: '' }),
    ).toContain('Hello');
    expect(inboundTextOf('<div>Hello</div>', null)).not.toContain('<');
  });

  it('passes plain content through and cuts at the cap', () => {
    expect(inboundTextOf('just text', null)).toBe('just text');
    const long = 'x'.repeat(TRIAGE_TEXT_MAX_CHARS + 10);
    const cut = inboundTextOf(long, null);
    expect(cut).toHaveLength(TRIAGE_TEXT_MAX_CHARS + 1);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('conversationUrl', () => {
  it('opens the thread on the open tab of the Inbox', () => {
    expect(conversationUrl('org_1', 'conv_1')).toBe(
      '/dashboard/org_1/conversations/open?conversation=conv_1',
    );
  });
});

describe('normalizeTriageVerdicts', () => {
  it('refuses an empty batch', () => {
    expect(() => normalizeTriageVerdicts([])).toThrow(
      expect.objectContaining({ code: 'triage_empty', status: 400 }),
    );
  });

  it('refuses a batch past the cap', () => {
    const verdicts = Array.from({ length: TRIAGE_BATCH_MAX + 1 }, (_, i) => ({
      conversationId: `conv_${i}`,
      action: 'reply' as const,
    }));
    expect(() => normalizeTriageVerdicts(verdicts)).toThrow(
      expect.objectContaining({ code: 'triage_too_many' }),
    );
  });

  it('refuses an unknown action, priority, blank id or oversized reason', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guard under test is what refuses the bad literal
    const badAction = 'maybe' as 'reply';
    expect(() =>
      normalizeTriageVerdicts([{ conversationId: 'c', action: badAction }]),
    ).toThrow(expect.objectContaining({ code: 'triage_invalid' }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same
    const badPriority = 'asap' as 'low';
    expect(() =>
      normalizeTriageVerdicts([
        { conversationId: 'c', action: 'reply', priority: badPriority },
      ]),
    ).toThrow(expect.objectContaining({ code: 'triage_invalid' }));
    expect(() =>
      normalizeTriageVerdicts([{ conversationId: '  ', action: 'reply' }]),
    ).toThrow(expect.objectContaining({ code: 'triage_invalid' }));
    expect(() =>
      normalizeTriageVerdicts([
        {
          conversationId: 'c',
          action: 'reply',
          reason: 'r'.repeat(TRIAGE_REASON_MAX_CHARS + 1),
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'triage_invalid' }));
  });

  it('keeps the last verdict for a conversation named twice and trims', () => {
    expect(
      normalizeTriageVerdicts([
        { conversationId: 'c1', action: 'no_reply', reason: '  first ' },
        { conversationId: 'c2', action: 'reply', priority: 'high' },
        { conversationId: ' c1 ', action: 'reply', priority: 'urgent' },
      ]),
    ).toEqual([
      { conversationId: 'c1', action: 'reply', priority: 'urgent' },
      { conversationId: 'c2', action: 'reply', priority: 'high' },
    ]);
  });
});

describe('recordConversationTriage', () => {
  it('runs the guards before opening a transaction', async () => {
    const begin = vi.fn(() => {
      throw new Error('a refused record must not open a transaction');
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `begin` is reachable from the guards under test
    const sql = { begin } as unknown as Sql;
    await expect(
      recordConversationTriage(sql, { organizationId: 'org', verdicts: [] }),
    ).rejects.toMatchObject({ code: 'triage_empty' });
    expect(begin).not.toHaveBeenCalled();
  });
});
