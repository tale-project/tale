import { describe, expect, it } from 'vitest';

import { isMissingAutomationRead } from './errors';

describe('isMissingAutomationRead', () => {
  it("treats the store's null as missing", () => {
    expect(
      isMissingAutomationRead({ data: null, isError: false, error: null }),
    ).toBe(true);
  });

  it("treats the backend's structured 404 refusal as missing", () => {
    expect(
      isMissingAutomationRead({
        data: undefined,
        isError: true,
        error: {
          data: {
            code: 'automation not found',
            message: 'automation not found',
          },
        },
      }),
    ).toBe(true);
  });

  it('keeps a transport or server failure as an error, not a missing row', () => {
    expect(
      isMissingAutomationRead({
        data: undefined,
        isError: true,
        error: new Error('Request failed with status 502'),
      }),
    ).toBe(false);
  });

  it('is not missing while the read is still pending or has answered', () => {
    expect(
      isMissingAutomationRead({ data: undefined, isError: false, error: null }),
    ).toBe(false);
    expect(
      isMissingAutomationRead({
        data: { name: 'x' },
        isError: false,
        error: null,
      }),
    ).toBe(false);
  });
});
