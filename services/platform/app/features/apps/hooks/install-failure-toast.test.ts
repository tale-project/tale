import { afterEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));

vi.mock('@/app/hooks/use-toast', () => ({ toast: toastSpy }));

import { notifyOnInstallFailure } from './install-failure-toast';

describe('notifyOnInstallFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows a destructive toast and logs when the action rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('App "x" not found in the catalog');

    notifyOnInstallFailure(Promise.reject(err), 'Couldn’t install the app');
    // Let the rejected promise settle through the attached `.catch`.
    await Promise.resolve();
    await Promise.resolve();

    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Couldn’t install the app',
      description: 'App "x" not found in the catalog',
      variant: 'destructive',
    });
    expect(errorSpy).toHaveBeenCalledWith(err);
  });

  it('omits the description when the rejection is not an Error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    notifyOnInstallFailure(
      Promise.reject('boom'),
      'Couldn’t reinstall the app',
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Couldn’t reinstall the app',
      description: undefined,
      variant: 'destructive',
    });
  });

  it('does not toast when the action resolves', async () => {
    notifyOnInstallFailure(Promise.resolve('ok'), 'Couldn’t install the app');
    await Promise.resolve();
    await Promise.resolve();

    expect(toastSpy).not.toHaveBeenCalled();
  });
});
