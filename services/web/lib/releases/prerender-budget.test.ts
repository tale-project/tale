import { describe, expect, it } from 'vitest';

import {
  PRERENDER_BODY_BUDGET_CHARS,
  PRERENDER_BODY_MAX,
  prerenderedBodyCount,
} from './prerender-budget';

const body = (chars: number) => ({ body: 'x'.repeat(chars) });

describe('prerenderedBodyCount', () => {
  it('is zero for an empty stream', () => {
    expect(prerenderedBodyCount([])).toBe(0);
  });

  it('always prerenders the newest release, even one over the whole budget', () => {
    expect(
      prerenderedBodyCount([body(PRERENDER_BODY_BUDGET_CHARS * 2), body(10)]),
    ).toBe(1);
  });

  it('stops before the body that would overflow the budget', () => {
    const third = PRERENDER_BODY_BUDGET_CHARS / 3;
    expect(
      prerenderedBodyCount([
        body(third),
        body(third),
        body(third),
        body(1),
        body(1),
      ]),
    ).toBe(3);
  });

  it('counts a body-less release toward the cut at no cost', () => {
    const half = PRERENDER_BODY_BUDGET_CHARS / 2;
    expect(
      prerenderedBodyCount([
        body(half),
        { body: null },
        { body: null },
        body(half),
        body(1),
      ]),
    ).toBe(4);
  });

  it('never exceeds the maximum, however small the bodies', () => {
    const tiny = Array.from({ length: PRERENDER_BODY_MAX + 5 }, () => body(1));
    expect(prerenderedBodyCount(tiny)).toBe(PRERENDER_BODY_MAX);
  });
});
