import { describe, expect, it } from 'vitest';

import {
  advancedPosition,
  byArrival,
  distinctCandidates,
  edgeAt,
  edgeIds,
  fittingWindow,
  type MailCandidate,
  type MailFolder,
  MAX_EDGE_IDS,
  planTimedPass,
  readEdges,
  sameEdge,
  usablePosition,
} from './mail_sync_plan';

function mail(
  key: string,
  at: number | null,
  folder: MailFolder = 'inbox',
): MailCandidate {
  return { folder, key, row: { id: key }, at };
}

function keys(candidates: readonly MailCandidate[]): string[] {
  return candidates.map((candidate) => candidate.key);
}

describe('usablePosition', () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');

  it('continues from a stored position', () => {
    expect(usablePosition(now - 1000, now)).toBe(now - 1000);
  });

  it('has none for a mailbox never read', () => {
    expect(usablePosition(undefined, now)).toBeNull();
    expect(usablePosition(null, now)).toBeNull();
  });

  it('tolerates a provider clock a little ahead of the server', () => {
    expect(usablePosition(now + 60_000, now)).toBe(now + 60_000);
  });

  it('drops a position far in the future, left by a sender’s Date header', () => {
    expect(usablePosition(Date.parse('2030-01-01T00:00:00Z'), now)).toBeNull();
  });
});

describe('byArrival', () => {
  it('reads the oldest first, what the mailbox sent before an answer of the same instant', () => {
    expect(
      keys(
        byArrival([
          mail('late', 30),
          mail('answer', 20, 'inbox'),
          mail('sent', 20, 'sent'),
          mail('early', 10),
        ]),
      ),
    ).toEqual(['early', 'sent', 'answer', 'late']);
  });

  it('keeps the provider’s order between emails of one folder and instant', () => {
    expect(keys(byArrival([mail('b', 5), mail('a', 5)]))).toEqual(['b', 'a']);
  });
});

describe('distinctCandidates', () => {
  it('reads an email listed in two folders once, as the first listing offered it', () => {
    const both = distinctCandidates([
      mail('g1', null, 'sent'),
      mail('g2', null, 'inbox'),
      mail('g1', null, 'inbox'),
    ]);
    expect(both.map((entry) => [entry.key, entry.folder])).toEqual([
      ['g1', 'sent'],
      ['g2', 'inbox'],
    ]);
  });
});

describe('planTimedPass', () => {
  it('reads up to the limit, oldest first across folders', () => {
    const plan = planTimedPass(
      [
        { folder: 'sent', candidates: [mail('s1', 15, 'sent')] },
        { folder: 'inbox', candidates: [mail('i1', 10), mail('i2', 20)] },
      ],
      5,
    );
    expect(keys(plan.take)).toEqual(['i1', 's1', 'i2']);
    expect(plan.capped).toBe(false);
  });

  it('says more is waiting when the listing went past the limit', () => {
    const plan = planTimedPass(
      [
        {
          folder: 'inbox',
          candidates: [mail('i1', 10), mail('i2', 20), mail('i3', 30)],
        },
      ],
      2,
    );
    expect(keys(plan.take)).toEqual(['i1', 'i2']);
    expect(plan.capped).toBe(true);
  });

  it('leaves an instant whole for the next pass rather than splitting it', () => {
    const plan = planTimedPass(
      [
        {
          folder: 'inbox',
          candidates: [mail('i1', 10), mail('i2', 20), mail('i3', 20)],
        },
      ],
      2,
    );
    expect(keys(plan.take)).toEqual(['i1']);
    expect(plan.capped).toBe(true);
  });

  it('splits nothing in the other folder when one folder’s instant is left', () => {
    const plan = planTimedPass(
      [
        { folder: 'sent', candidates: [mail('s1', 5, 'sent')] },
        {
          folder: 'inbox',
          candidates: [mail('i1', 20), mail('i2', 20), mail('i3', 20)],
        },
      ],
      2,
    );
    expect(keys(plan.take)).toEqual(['s1']);
  });

  it('asks to read an instant whole when it alone holds more than a pass', () => {
    const plan = planTimedPass(
      [
        {
          folder: 'inbox',
          candidates: [mail('i1', 20), mail('i2', 20), mail('i3', 20)],
        },
      ],
      2,
    );
    expect(plan).toEqual({
      take: [],
      capped: true,
      widen: { folder: 'inbox', at: 20 },
    });
  });

  it('reads nothing from empty listings', () => {
    expect(planTimedPass([{ folder: 'inbox', candidates: [] }], 5)).toEqual({
      take: [],
      capped: false,
    });
  });
});

describe('advancedPosition', () => {
  it('moves to the newest instant read when every email was handled', () => {
    const listed = [mail('a', 10), mail('b', 20)];
    expect(advancedPosition(listed, new Set(['a', 'b']))).toBe(20);
  });

  it('stops before the first email the pass did not handle', () => {
    const listed = [mail('a', 10), mail('b', 20), mail('c', 30)];
    expect(advancedPosition(listed, new Set(['a', 'c']))).toBe(10);
  });

  it('never ends inside an instant an unhandled email shares', () => {
    const listed = [mail('a', 10), mail('b', 20), mail('c', 20)];
    expect(advancedPosition(listed, new Set(['a', 'b']))).toBe(10);
  });

  it('does not move while an unhandled email’s instant is unknown', () => {
    const listed = [mail('a', 10), mail('b', null)];
    expect(advancedPosition(listed, new Set(['a']))).toBeNull();
  });

  it('lets a handled email with no instant (gone before its read) pass', () => {
    const listed = [mail('a', 10), mail('gone', null), mail('b', 20)];
    expect(advancedPosition(listed, new Set(['a', 'gone', 'b']))).toBe(20);
  });

  it('does not move when nothing was handled', () => {
    expect(advancedPosition([mail('a', 10)], new Set())).toBeNull();
    expect(advancedPosition([], new Set())).toBeNull();
  });
});

describe('fittingWindow', () => {
  /** A listing of one email per second in `seconds`, probed like Gmail. */
  function gmailLike(seconds: number[], perPass: number) {
    const probes: Array<number | null> = [];
    const probe = (beforeSec: number | null) => {
      probes.push(beforeSec);
      const rows = seconds.filter(
        (second) => beforeSec === null || second < beforeSec,
      );
      return Promise.resolve({
        rows: rows.slice(0, perPass + 1),
        overflow: rows.length > perPass,
      });
    };
    return { probe, probes };
  }

  it('reads the open window in one probe when it fits', async () => {
    const { probe, probes } = gmailLike([101, 102, 103], 5);
    await expect(
      fittingWindow({
        fromSec: 100,
        nowSec: 200,
        probe,
        maxProbes: 32,
        enough: 3,
      }),
    ).resolves.toEqual({
      rows: [101, 102, 103],
      beforeSec: null,
      narrowed: false,
    });
    expect(probes).toEqual([null]);
  });

  it('narrows a window that holds more than a pass to one that fits', async () => {
    const seconds = Array.from({ length: 300 }, (_, i) => 1001 + i);
    const { probe } = gmailLike(seconds, 50);
    const window = await fittingWindow({
      fromSec: 1000,
      nowSec: 2000,
      probe,
      maxProbes: 32,
      enough: 25,
    });
    expect('rows' in window && window.narrowed).toBe(true);
    if (!('rows' in window)) return;
    expect(window.rows.length).toBeGreaterThanOrEqual(25);
    expect(window.rows.length).toBeLessThanOrEqual(50);
    // The oldest emails, without a gap.
    expect(window.rows).toEqual(seconds.slice(0, window.rows.length));
  });

  it('names the second it cannot split', async () => {
    // Sixty emails in one second, a pass of fifty.
    const { probe } = gmailLike(
      Array.from({ length: 60 }, () => 1500),
      50,
    );
    await expect(
      fittingWindow({
        fromSec: 1000,
        nowSec: 2000,
        probe,
        maxProbes: 32,
        enough: 25,
      }),
    ).resolves.toEqual({ overflowAt: 1501 });
  });

  it('spends no more probes than it is given', async () => {
    const seconds = Array.from({ length: 300 }, (_, i) => 1001 + i);
    const { probe, probes } = gmailLike(seconds, 50);
    await fittingWindow({
      fromSec: 1000,
      nowSec: 1_000_000_000,
      probe,
      maxProbes: 4,
      enough: 25,
    });
    expect(probes.length).toBeLessThanOrEqual(5);
  });
});

describe('the edge of a Gmail position', () => {
  const second = 1_760_000_000;
  const at = (ms: number) => second * 1000 + ms;

  it('keeps the emails read in the position’s own second, up to the position', () => {
    const edge = edgeAt(at(500), {
      previousPosition: null,
      previous: new Set(),
      read: [
        mail('earlier-second', at(-1)),
        mail('same-second', at(100)),
        mail('the-position', at(500)),
        mail('later', at(600)),
      ],
    });
    expect(edge).toEqual({ at: at(500), ids: ['same-second', 'the-position'] });
  });

  it('adds to what the edge held while the position stays in that second', () => {
    const edge = edgeAt(at(700), {
      previousPosition: at(500),
      previous: new Set(['read-before']),
      read: [mail('read-now', at(700))],
    });
    expect(new Set(edge.ids)).toEqual(new Set(['read-before', 'read-now']));
  });

  it('starts afresh when the position moves to another second', () => {
    const edge = edgeAt(at(2500), {
      previousPosition: at(500),
      previous: new Set(['read-before']),
      read: [mail('read-now', at(2500))],
    });
    expect(edge.ids).toEqual(['read-now']);
  });

  it('keeps at most the bounded number of ids', () => {
    const read = Array.from({ length: MAX_EDGE_IDS + 5 }, (_, i) =>
      mail(`m${i}`, at(1)),
    );
    expect(
      edgeAt(at(1), { previousPosition: null, previous: new Set(), read }).ids,
    ).toHaveLength(MAX_EDGE_IDS);
  });

  it('counts an edge only at the position it was kept with', () => {
    const edges = readEdges({ inbox: { at: at(500), ids: ['a'] } });
    expect(edgeIds(edges.inbox, at(500))).toEqual(new Set(['a']));
    // A position an older version moved leaves the edge behind.
    expect(edgeIds(edges.inbox, at(900))).toEqual(new Set());
    expect(edgeIds(edges.sent, at(500))).toEqual(new Set());
    expect(edgeIds(edges.inbox, null)).toEqual(new Set());
  });

  it('reads nothing from a stored value it did not write', () => {
    expect(readEdges(null)).toEqual({});
    expect(readEdges({ inbox: { at: 'soon', ids: [] } })).toEqual({});
    expect(readEdges('edges')).toEqual({});
  });

  it('tells an unchanged edge from a changed one', () => {
    expect(
      sameEdge({ at: 1, ids: ['a', 'b'] }, { at: 1, ids: ['b', 'a'] }),
    ).toBe(true);
    expect(sameEdge({ at: 1, ids: ['a'] }, { at: 1, ids: ['a', 'b'] })).toBe(
      false,
    );
    expect(sameEdge({ at: 1, ids: ['a'] }, { at: 2, ids: ['a'] })).toBe(false);
    expect(sameEdge(undefined, { at: 1, ids: [] })).toBe(false);
  });
});
