// The rule that decides which live writes hold for a human. The built-in
// default is the whole point of the change — a write leaving the tenant asks,
// a write on the platform's own surface does not — so the matrix is pinned
// here, together with the operator overrides that beat it.

import { describe, expect, it } from 'vitest';

import { approvalPolicyConfigSchema } from '../../../lib/shared/schemas/governance';
import { resolveApprovalRequirement } from './policy';

const platformWrite = {
  connector: 'task',
  action: 'update_status',
  platformInternal: true,
} as const;
const outboundWrite = {
  connector: 'imap-smtp',
  action: 'send',
  platformInternal: false,
} as const;

function policy(rules: unknown) {
  return approvalPolicyConfigSchema.parse({ rules });
}

describe('resolveApprovalRequirement', () => {
  it('lets a platform-internal write run and stops an outbound one', () => {
    expect(resolveApprovalRequirement({ ...platformWrite, policy: null })).toBe(
      'allow',
    );
    expect(resolveApprovalRequirement({ ...outboundWrite, policy: null })).toBe(
      'require',
    );
  });

  it('treats an empty policy exactly like no policy', () => {
    const empty = policy([]);
    expect(
      resolveApprovalRequirement({ ...platformWrite, policy: empty }),
    ).toBe('allow');
    expect(
      resolveApprovalRequirement({ ...outboundWrite, policy: empty }),
    ).toBe('require');
  });

  it('an org can tighten one internal connector', () => {
    const strict = policy([
      { connector: 'task', decision: 'require_approval' },
    ]);
    expect(
      resolveApprovalRequirement({ ...platformWrite, policy: strict }),
    ).toBe('require');
    // A sibling platform connector is untouched by that rule.
    expect(
      resolveApprovalRequirement({
        connector: 'document',
        action: 'create',
        platformInternal: true,
        policy: strict,
      }),
    ).toBe('allow');
  });

  it('an org can loosen one outbound action', () => {
    const loose = policy([
      { action: 'imap-smtp.send', decision: 'auto_approve' },
    ]);
    expect(
      resolveApprovalRequirement({ ...outboundWrite, policy: loose }),
    ).toBe('allow');
    // Another action of the same connector still asks.
    expect(
      resolveApprovalRequirement({
        connector: 'imap-smtp',
        action: 'delete_message',
        platformInternal: false,
        policy: loose,
      }),
    ).toBe('require');
  });

  it('an action rule beats a connector rule for the same operation', () => {
    const mixed = policy([
      { connector: 'github', decision: 'auto_approve' },
      { action: 'github.create_release', decision: 'require_approval' },
    ]);
    expect(
      resolveApprovalRequirement({
        connector: 'github',
        action: 'comment_issue',
        platformInternal: false,
        policy: mixed,
      }),
    ).toBe('allow');
    expect(
      resolveApprovalRequirement({
        connector: 'github',
        action: 'create_release',
        platformInternal: false,
        policy: mixed,
      }),
    ).toBe('require');
  });

  it('the later of two rules at the same specificity wins', () => {
    const rewritten = policy([
      { connector: 'slack', decision: 'auto_approve' },
      { connector: 'slack', decision: 'require_approval' },
    ]);
    expect(
      resolveApprovalRequirement({
        connector: 'slack',
        action: 'post_message',
        platformInternal: false,
        policy: rewritten,
      }),
    ).toBe('require');
  });

  it('refuses a rule that names neither or both targets', () => {
    expect(() => policy([{ decision: 'auto_approve' }])).toThrow();
    expect(() =>
      policy([
        { connector: 'task', action: 'task.comment', decision: 'auto_approve' },
      ]),
    ).toThrow();
  });
});
