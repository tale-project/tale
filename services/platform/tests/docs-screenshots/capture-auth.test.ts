import type { BrowserContext } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({ visible: vi.fn<() => Promise<void>>() }));
vi.mock('@playwright/test', () => ({
  expect: () => ({ toBeVisible: ui.visible }),
}));

import { signUpOrIn } from './capture-auth';

function browserContext() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    getByRole: vi.fn(() => ({ control: 'email' })),
    evaluate: vi
      .fn<
        (
          _action: unknown,
          payload: { url: string },
        ) => Promise<{ status: number; body: string }>
      >()
      .mockResolvedValue({ status: 200, body: '{}' }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const context = { newPage: vi.fn().mockResolvedValue(page) };
  return { page, context: context as unknown as BrowserContext };
}

describe('screenshot authentication readiness', () => {
  beforeEach(() => ui.visible.mockReset().mockResolvedValue(undefined));

  it('does not fetch auth while the login form is still mounting', async () => {
    let mounted: () => void = () => {};
    ui.visible.mockReturnValue(
      new Promise<void>((resolve) => {
        mounted = resolve;
      }),
    );
    const { page, context } = browserContext();
    const pending = signUpOrIn(context);
    await vi.waitFor(() => expect(ui.visible).toHaveBeenCalledOnce());
    expect(page.evaluate).not.toHaveBeenCalled();
    mounted();
    await pending;
    expect(page.evaluate.mock.calls.map(([, payload]) => payload.url)).toEqual([
      '/api/auth/sign-up/email',
    ]);
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('signs in the existing synthetic owner after a rejected signup', async () => {
    const { page, context } = browserContext();
    page.evaluate.mockResolvedValueOnce({
      status: 422,
      body: 'already exists',
    });
    await signUpOrIn(context);
    expect(page.evaluate.mock.calls.map(([, payload]) => payload.url)).toEqual([
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
    ]);
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('does not send auth requests when the login form never becomes ready', async () => {
    const { page, context } = browserContext();
    ui.visible.mockRejectedValueOnce(new Error('auth form did not mount'));
    await expect(signUpOrIn(context)).rejects.toThrow(
      'auth form did not mount',
    );
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('surfaces failed signup and signin and closes the page', async () => {
    const { page, context } = browserContext();
    page.evaluate.mockResolvedValue({ status: 403, body: 'refused' });
    await expect(signUpOrIn(context)).rejects.toThrow(
      'sign-up 403 (refused), sign-in 403 (refused)',
    );
    expect(page.close).toHaveBeenCalledOnce();
  });
});
