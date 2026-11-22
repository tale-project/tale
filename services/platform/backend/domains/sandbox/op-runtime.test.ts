import { describe, expect, it } from 'vitest';

import { opRuntimeView } from './op-runtime.ts';

describe('opRuntimeView', () => {
  it('names the harness a turn ran on, its display name and why it ran there', () => {
    expect(
      opRuntimeView({
        harness: 'claude-code',
        harnessReason: 'subscription_bound',
      }),
    ).toEqual({
      harness: 'claude-code',
      harnessLabel: 'Claude Code',
      harnessReason: 'subscription_bound',
    });
  });

  it('keeps the slug of a harness the deployment no longer ships, without a name', () => {
    expect(
      opRuntimeView({ harness: 'retired-cli', harnessReason: 'pinned' }),
    ).toEqual({ harness: 'retired-cli', harnessReason: 'pinned' });
  });

  it('leaves out a reason this image does not know, and one with no harness to explain', () => {
    expect(
      opRuntimeView({ harness: 'pi', harnessReason: 'a-newer-rule' }),
    ).toEqual({ harness: 'pi', harnessLabel: 'Pi' });
    expect(opRuntimeView({ harness: null, harnessReason: 'default' })).toEqual(
      {},
    );
    // A row written before ops recorded the reason.
    expect(opRuntimeView({ harness: 'pi', harnessReason: null })).toEqual({
      harness: 'pi',
      harnessLabel: 'Pi',
    });
  });
});
