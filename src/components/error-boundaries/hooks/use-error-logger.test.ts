import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useErrorLogger } from './use-error-logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useErrorLogger', () => {
  it('logs the Error itself, so a console-promoting monitor keeps its type and stack', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useErrorLogger());
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'rows')",
    );

    result.current(error, {
      organizationId: 'org_1',
      componentName: 'ErrorDisplayCompact',
    });

    expect(logged).toHaveBeenCalledTimes(1);
    const [message, reported, context] = logged.mock.calls[0] ?? [];
    expect(message).toBe('Error caught by boundary:');
    expect(reported).toBe(error);
    expect(context).toEqual({
      organizationId: 'org_1',
      componentName: 'ErrorDisplayCompact',
    });
  });
});
