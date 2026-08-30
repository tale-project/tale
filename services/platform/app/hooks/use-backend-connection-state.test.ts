import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
  reportBackendReachable,
  reportBackendUnreachable,
} from '@/app/lib/backend/connection-state';

import { useBackendConnectionState } from './use-backend-connection-state';

describe('useBackendConnectionState', () => {
  it('tracks the hint stream: optimistic until something actually fails', () => {
    const { result } = renderHook(() => useBackendConnectionState());
    // Nothing has failed yet — a request that was never tried is not
    // evidence of an outage.
    expect(result.current.isWebSocketConnected).toBe(true);

    act(() => {
      reportBackendUnreachable();
    });
    expect(result.current.isWebSocketConnected).toBe(false);

    act(() => {
      reportBackendReachable();
    });
    expect(result.current.isWebSocketConnected).toBe(true);
  });
});
