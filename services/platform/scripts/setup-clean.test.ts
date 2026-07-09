import { describe, expect, it } from 'vitest';

import {
  canDestroyLocalConvex,
  DESTROY_LOCAL_CONVEX_ENV,
  DESTROY_LOCAL_CONVEX_ENV_VALUE,
  DESTROY_LOCAL_CONVEX_PHRASE,
} from './setup-clean-gate';

describe('canDestroyLocalConvex', () => {
  it('accepts the exact typed phrase on a TTY', () => {
    expect(
      canDestroyLocalConvex({
        isTty: true,
        typedAnswer: DESTROY_LOCAL_CONVEX_PHRASE,
        env: {},
      }).ok,
    ).toBe(true);
  });

  it('rejects a casual yes on a TTY', () => {
    expect(
      canDestroyLocalConvex({
        isTty: true,
        typedAnswer: 'yes',
        env: {},
      }).ok,
    ).toBe(false);
  });

  it('accepts the env gate without a TTY', () => {
    expect(
      canDestroyLocalConvex({
        isTty: false,
        typedAnswer: null,
        env: { [DESTROY_LOCAL_CONVEX_ENV]: DESTROY_LOCAL_CONVEX_ENV_VALUE },
      }).ok,
    ).toBe(true);
  });

  it('rejects non-TTY runs without the env gate', () => {
    const result = canDestroyLocalConvex({
      isTty: false,
      typedAnswer: null,
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(DESTROY_LOCAL_CONVEX_ENV);
    }
  });
});
