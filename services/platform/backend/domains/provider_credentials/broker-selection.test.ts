/**
 * The broker pick without its transaction: which candidate the shared
 * cooldowns, the retry exclusions and the broker's refresh holds leave.
 *
 * The pool this guards (TALE-101): two subscription accounts. The run on A
 * gets a 429, so A cools down for a minute, while the broker holds B back
 * for its coming token refresh — it counts A as able to take the work, and
 * knows nothing of the cooldown. Refusing B as well left the pool with no
 * account at all, and the immediate retries burned their budget in seconds.
 */
import { describe, expect, it } from 'vitest';

import { pickBrokerCandidate } from './broker-selection.ts';

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

type States = Parameters<typeof pickBrokerCandidate>[1];

function states(
  entries: Record<string, { cooldownUntilMs?: number; sequence?: string }>,
): States {
  return new Map(
    Object.entries(entries).map(([hash, state]) => [
      hash,
      {
        cooldownUntilMs: state.cooldownUntilMs ?? 0,
        sequence: state.sequence ?? '0',
      },
    ]),
  );
}

describe('pickBrokerCandidate', () => {
  it('vends the account held for its refresh while the only available one cools down', () => {
    const picked = pickBrokerCandidate(
      [
        { hash: 'account-a', excluded: true },
        { hash: 'account-b', excluded: false, held: true },
      ],
      states({ 'account-a': { cooldownUntilMs: NOW + 60_000 } }),
      'round-robin',
      NOW,
      () => 0,
    );
    expect(picked).toEqual({
      selected: { hash: 'account-b', excluded: false, held: true },
      fellBack: false,
      held: true,
    });
  });

  it('vends a held account when the broker counts none as available here', () => {
    // An OpenAI pool whose available account has no vendor account id: the
    // resolver hands only the held one over.
    const picked = pickBrokerCandidate(
      [{ hash: 'account-b', excluded: false, held: true }],
      states({}),
      'random',
      NOW,
      () => 0.99,
    );
    expect(picked.selected?.hash).toBe('account-b');
    expect(picked.held).toBe(true);
  });

  it('keeps a held account out while an available one can serve, even one already tried', () => {
    const picked = pickBrokerCandidate(
      [
        { hash: 'account-a', excluded: true },
        { hash: 'account-b', excluded: false, held: true },
      ],
      states({}),
      'first',
      NOW,
      () => 0,
    );
    expect(picked).toEqual({
      selected: { hash: 'account-a', excluded: true },
      fellBack: true,
      held: false,
    });
  });

  it('takes held accounts in the order given — the most token life first — preferring one not yet tried', () => {
    const later = { hash: 'refresh-later', held: true };
    const sooner = { hash: 'refresh-sooner', held: true };
    // Round-robin history would pick the sooner one; the refresh decides.
    const history = states({
      'refresh-later': { sequence: '9' },
      'refresh-sooner': { sequence: '1' },
    });
    expect(
      pickBrokerCandidate(
        [
          { ...later, excluded: false },
          { ...sooner, excluded: false },
        ],
        history,
        'round-robin',
        NOW,
        () => 0.99,
      ).selected?.hash,
    ).toBe('refresh-later');
    expect(
      pickBrokerCandidate(
        [
          { ...later, excluded: true },
          { ...sooner, excluded: false },
        ],
        history,
        'round-robin',
        NOW,
        () => 0.99,
      ),
    ).toMatchObject({
      selected: { hash: 'refresh-sooner' },
      fellBack: false,
      held: true,
    });
    expect(
      pickBrokerCandidate(
        [
          { ...later, excluded: true },
          { ...sooner, excluded: true },
        ],
        history,
        'round-robin',
        NOW,
        () => 0.99,
      ),
    ).toMatchObject({
      selected: { hash: 'refresh-later' },
      fellBack: true,
      held: true,
    });
  });

  it('never vends a cooling account, held or not, and says when the first comes back', () => {
    const picked = pickBrokerCandidate(
      [
        { hash: 'account-a', excluded: false },
        { hash: 'account-b', excluded: false, held: true },
      ],
      states({
        'account-a': { cooldownUntilMs: NOW + 60_000 },
        'account-b': { cooldownUntilMs: NOW + 30_000 },
      }),
      'first',
      NOW,
      () => 0,
    );
    expect(picked).toEqual({
      fellBack: false,
      held: false,
      retryAtMs: NOW + 30_000,
    });
  });

  it('keeps the strategy among available accounts', () => {
    const candidates = [
      { hash: 'account-a', excluded: false },
      { hash: 'account-b', excluded: false },
      { hash: 'account-c', excluded: false, held: true },
    ];
    expect(
      pickBrokerCandidate(candidates, states({}), 'random', NOW, () => 0.99)
        .selected?.hash,
    ).toBe('account-b');
    expect(
      pickBrokerCandidate(
        candidates,
        states({
          'account-a': { sequence: '5' },
          'account-b': { sequence: '2' },
        }),
        'round-robin',
        NOW,
        () => 0,
      ).selected?.hash,
    ).toBe('account-b');
  });
});
