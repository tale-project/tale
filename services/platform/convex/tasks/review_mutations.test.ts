import { describe, expect, it } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import { approvalRound } from './review_shared';

function approval(metadata: unknown): Pick<Doc<'approvals'>, 'metadata'> {
  return { metadata };
}

// The round is part of the request's idempotency key: a workflow loop that
// re-enters the SAME gate step bumps it to mint a fresh request, and rows
// predating the key must keep matching round-0 requests (else every deployed
// pause would re-request on resume and replay nothing).
describe('approvalRound', () => {
  it('reads the minted round from metadata', () => {
    expect(approvalRound(approval({ round: 2 }))).toBe(2);
  });

  it('treats pre-round rows and malformed metadata as round 0', () => {
    expect(approvalRound(approval({ question: 'legacy row' }))).toBe(0);
    expect(approvalRound(approval(undefined))).toBe(0);
    expect(approvalRound(approval('not-a-record'))).toBe(0);
    expect(approvalRound(approval({ round: 'two' }))).toBe(0);
  });
});
