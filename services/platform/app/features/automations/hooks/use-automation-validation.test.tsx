import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation } from '@/lib/engine/core/types';

const { validate } = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('@/app/lib/backend/automation-validation', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/lib/backend/automation-validation')
  >()),
  validateAutomationDraft: validate,
}));

import {
  documentHash,
  useAutomationValidation,
  VALIDATION_DEBOUNCE_MS,
} from './use-automation-validation';

/**
 * The editor's draft check: one request per pause in the edits, the newest
 * document's answer only, the last result kept on screen while the next one
 * is on its way, and a failure that says so without a toast.
 */

function doc(prompt: string): Automation {
  return {
    version: 1,
    name: 'support/triage',
    nodes: [{ id: 'reply', type: 'llm', prompt }],
  };
}

const ISSUE = {
  level: 'error' as const,
  code: 'REF_UNKNOWN_NODE',
  message: 'nodes.nope does not exist',
  at: { pointer: '/nodes/0/prompt' },
};

function answer(errors: unknown[] = []) {
  return { valid: errors.length === 0, errors, warnings: [] };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface Props {
  document: Automation | null;
  isDraft: boolean;
  enabled: boolean;
}

function renderValidation(initial: Props) {
  return renderHook(
    (props: Props) =>
      useAutomationValidation({
        organizationId: 'org-1',
        automationSlug: 'support/triage',
        ...props,
      }),
    { wrapper, initialProps: initial },
  );
}

beforeEach(() => {
  client = new QueryClient();
  validate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  client.clear();
});

describe('useAutomationValidation', () => {
  it('checks nothing for a reader who cannot author', () => {
    const { result } = renderValidation({
      document: doc('Hi'),
      isDraft: false,
      enabled: false,
    });
    expect(result.current.status).toBe('idle');
    expect(validate).not.toHaveBeenCalled();
  });

  it('checks a stored version at once and settles on its answer', async () => {
    validate.mockResolvedValue(answer([ISSUE]));
    const stored = doc('Hi {{ nodes.nope.output }}');
    const { result } = renderValidation({
      document: stored,
      isDraft: false,
      enabled: true,
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.errors).toEqual([
      expect.objectContaining({ code: 'REF_UNKNOWN_NODE' }),
    ]);
    expect(result.current.settledFor).toBe(documentHash(stored));
    expect(validate).toHaveBeenCalledWith(
      'org-1',
      'support/triage',
      stored,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('waits for a pause in the edits and checks the newest draft only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    validate.mockResolvedValue(answer());
    const { result, rerender } = renderValidation({
      document: doc('Hi'),
      isDraft: false,
      enabled: true,
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    validate.mockClear();

    for (const prompt of ['Hi t', 'Hi th', 'Hi there']) {
      rerender({ document: doc(prompt), isDraft: true, enabled: true });
      act(() => {
        vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS / 4);
      });
    }
    expect(result.current.status).toBe('checking');
    expect(validate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0]?.[2]).toEqual(doc('Hi there'));
  });

  it("keeps the last result on screen while the next check runs, and drops a stale check's answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    validate.mockResolvedValueOnce(answer([ISSUE]));
    const { result, rerender } = renderValidation({
      document: doc('A'),
      isDraft: false,
      enabled: true,
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let signal: AbortSignal | undefined;
    validate.mockImplementationOnce(
      (_org, _name, _document, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => undefined);
      },
    );
    rerender({ document: doc('B'), isDraft: true, enabled: true });
    act(() => {
      vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS);
    });
    await waitFor(() => expect(signal).toBeDefined());
    // The previous answer stays listed, marked as being checked again.
    expect(result.current.status).toBe('checking');
    expect(result.current.errors).toHaveLength(1);

    // A newer edit withdraws the request still in flight.
    validate.mockResolvedValueOnce(answer());
    rerender({ document: doc('C'), isDraft: true, enabled: true });
    act(() => {
      vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(signal?.aborted).toBe(true);
    expect(result.current.errors).toEqual([]);
    expect(result.current.settledFor).toBe(documentHash(doc('C')));
  });

  it('says a check failed, keeps the last list, and never retries into a toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    validate.mockResolvedValueOnce(answer([ISSUE]));
    const { result, rerender } = renderValidation({
      document: doc('A'),
      isDraft: false,
      enabled: true,
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    validate.mockRejectedValue(new TypeError('Failed to fetch'));
    rerender({ document: doc('B'), isDraft: true, enabled: true });
    act(() => {
      vi.advanceTimersByTime(VALIDATION_DEBOUNCE_MS);
    });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.failure).toBeInstanceOf(TypeError);
    expect(result.current.errors).toHaveLength(1);
    // One attempt: a failed check is shown, not retried behind the reader.
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('answers a document already checked from the cache', async () => {
    validate.mockResolvedValue(answer());
    const { result, rerender } = renderValidation({
      document: doc('A'),
      isDraft: false,
      enabled: true,
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ document: doc('B'), isDraft: false, enabled: true });
    await waitFor(() =>
      expect(result.current.settledFor).toBe(documentHash(doc('B'))),
    );
    rerender({ document: doc('A'), isDraft: false, enabled: true });
    expect(result.current.status).toBe('ready');
    expect(validate).toHaveBeenCalledTimes(2);
  });
});

describe('documentHash', () => {
  it('names a document by its content, whatever order its keys are in', () => {
    const a = { name: 'x', version: 1, nodes: [] } as unknown as Automation;
    const b = { nodes: [], version: 1, name: 'x' } as unknown as Automation;
    expect(documentHash(a)).toBe(documentHash(b));
    expect(documentHash(a)).not.toBe(documentHash(doc('A')));
  });
});
