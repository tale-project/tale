import type { ConversationRoutingConfig } from '@tale/shared/schemas/governance';
import { describe, expect, it } from 'vitest';

import { matchRoutingRule, type RoutingArrival } from './routing-match';

function config(
  partial: Partial<ConversationRoutingConfig>,
): ConversationRoutingConfig {
  return { rules: [], sourceRules: [], ...partial };
}

/** An email arrival; `credentialId: null` is a thread whose mailbox is
 *  unknown. */
const email = (
  recipient: string | undefined,
  credentialId: string | null = 'cred-a',
): RoutingArrival => ({
  lane: 'email',
  ...(credentialId !== null ? { credentialId } : {}),
  ...(recipient !== undefined ? { recipient } : {}),
});

/**
 * Every tier, each shown to beat the next, so a reordering turns one of these
 * red. From most specific: mailbox + exact address, mailbox + base address,
 * any mailbox + exact, any mailbox + base, mailbox alone.
 */
describe('matchRoutingRule precedence (email)', () => {
  const tiers = config({
    sourceRules: [
      { mailbox: 'cred-a', teamId: 't-mailbox-only' },
      {
        mailbox: 'cred-a',
        address: 'support@acme.test',
        teamId: 't-mailbox-base',
      },
      {
        mailbox: 'cred-a',
        address: 'support+billing@acme.test',
        teamId: 't-mailbox-exact',
      },
    ],
    rules: [
      { address: 'support@acme.test', teamId: 't-any-base' },
      { address: 'support+billing@acme.test', teamId: 't-any-exact' },
    ],
  });

  it('1. a mailbox rule for the exact address', () => {
    expect(matchRoutingRule(tiers, email('Support+Billing@acme.test'))).toEqual(
      { teamId: 't-mailbox-exact' },
    );
  });

  it('2. a mailbox rule for the base address', () => {
    expect(matchRoutingRule(tiers, email('support+refunds@acme.test'))).toEqual(
      { teamId: 't-mailbox-base' },
    );
  });

  it('3. an any-mailbox rule for the exact address', () => {
    expect(
      matchRoutingRule(tiers, email('support+billing@acme.test', 'cred-b')),
    ).toEqual({ teamId: 't-any-exact' });
  });

  it('4. an any-mailbox rule for the base address', () => {
    expect(
      matchRoutingRule(tiers, email('support+refunds@acme.test', 'cred-b')),
    ).toEqual({ teamId: 't-any-base' });
  });

  it('5. a mailbox rule with no address, when nothing more specific matches', () => {
    expect(matchRoutingRule(tiers, email('jobs@acme.test'))).toEqual({
      teamId: 't-mailbox-only',
    });
    // A thread whose mailbox is unknown never meets a mailbox rule.
    expect(
      matchRoutingRule(tiers, email('jobs@acme.test', null)),
    ).toBeUndefined();
  });

  it('an address-only thread (no recipient) still meets its mailbox rule', () => {
    expect(matchRoutingRule(tiers, email(undefined))).toEqual({
      teamId: 't-mailbox-only',
    });
  });
});

describe('matchRoutingRule details', () => {
  it('takes the first rule in its array within a tier', () => {
    expect(
      matchRoutingRule(
        config({
          rules: [
            { address: 'support@acme.test', teamId: 't-first' },
            { address: 'SUPPORT@acme.test', teamId: 't-second' },
          ],
        }),
        email('support@acme.test'),
      ),
    ).toEqual({ teamId: 't-first' });
  });

  it('skips a rule with no target, so it cannot shadow the next one', () => {
    expect(
      matchRoutingRule(
        config({
          rules: [
            { address: 'support@acme.test' },
            { address: 'support@acme.test', userId: 'u-1' },
          ],
        }),
        email('support@acme.test'),
      ),
    ).toEqual({ userId: 'u-1' });
  });

  it('never base-matches a tagged rule address', () => {
    expect(
      matchRoutingRule(
        config({
          rules: [{ address: 'support+billing@acme.test', teamId: 't-tag' }],
        }),
        email('support+billing+eu@acme.test'),
      ),
    ).toBeUndefined();
  });

  it('routes an API conversation only by its source', () => {
    const rules = config({
      rules: [{ address: 'support@acme.test', teamId: 't-email' }],
      sourceRules: [
        { apiSource: 'helpdesk', teamId: 't-helpdesk' },
        { mailbox: 'helpdesk', teamId: 't-wrong-lane' },
      ],
    });
    expect(
      matchRoutingRule(rules, { lane: 'api', source: 'helpdesk' }),
    ).toEqual({ teamId: 't-helpdesk' });
    expect(
      matchRoutingRule(rules, { lane: 'api', source: 'crm' }),
    ).toBeUndefined();
    // An email thread never meets an API rule, even with the same slug.
    expect(matchRoutingRule(rules, email(undefined, 'helpdesk'))).toEqual({
      teamId: 't-wrong-lane',
    });
  });

  it('routes nothing when routing is switched off', () => {
    const off = config({
      enabled: false,
      rules: [{ address: 'support@acme.test', teamId: 't' }],
      sourceRules: [{ apiSource: 'helpdesk', teamId: 't' }],
    });
    expect(matchRoutingRule(off, email('support@acme.test'))).toBeUndefined();
    expect(
      matchRoutingRule(off, { lane: 'api', source: 'helpdesk' }),
    ).toBeUndefined();
  });
});
