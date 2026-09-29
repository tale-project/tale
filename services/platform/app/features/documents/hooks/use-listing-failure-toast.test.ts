// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { CloudListingError } from '../lib/cloud-listing-error';
import { useListingFailureToast } from './use-listing-failure-toast';

// A cloud picker's listing runs its write as a query that retries it twice,
// and each attempt used to raise the write's own toast: up to three toasts
// for one failed folder. The write stays quiet now, and the dialog reports
// the query's final error once.

const toast = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', () => ({ toast }));

const TITLE = "Couldn't load items";
const handedOff = (error: unknown) =>
  error instanceof Error && error.message.includes('not authorized');

function render(error: unknown) {
  return renderHook(
    ({ current }: { current: unknown }) =>
      useListingFailureToast(current, TITLE, handedOff),
    { initialProps: { current: error } },
  );
}

beforeEach(() => {
  toast.mockReset();
});

describe('useListingFailureToast', () => {
  it('says nothing while the listing has not failed', () => {
    render(null);
    expect(toast).not.toHaveBeenCalled();
  });

  it("reports a failed listing once, with the refusal's words", () => {
    const refusal = new AppError({
      code: 'GRAPH_UNAVAILABLE',
      message: 'Microsoft Graph did not answer',
    });
    const { rerender } = render(refusal);
    rerender({ current: refusal });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: TITLE,
      description: 'Microsoft Graph did not answer',
      variant: 'destructive',
    });
  });

  it('reports a later failure of the same listing again', () => {
    const { rerender } = render(new Error('first'));
    rerender({ current: null });
    rerender({ current: new Error('second') });

    expect(toast).toHaveBeenCalledTimes(2);
  });

  // A `success: false` listing carries the provider's raw answer: English,
  // and often its JSON body. It goes to the log; the toast keeps its title.
  it("never shows the provider's raw answer to a listing", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = 'OneDrive API error: 403 {"error":{"code":"accessDenied"}}';
    render(new CloudListingError(raw));

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: TITLE,
      description: undefined,
      variant: 'destructive',
    });
    expect(warn).toHaveBeenCalledWith('Cloud listing failed:', raw);
    warn.mockRestore();
  });

  it('leaves an error the dialog hands off to the connect dialog', () => {
    render(new Error('Cloud import is not authorized'));
    expect(toast).not.toHaveBeenCalled();
  });
});
