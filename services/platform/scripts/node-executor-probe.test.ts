import { describe, expect, it, vi } from 'vitest';

import { describeProbeFailure, probeNodeExecutor } from './node-executor-probe';

describe('describeProbeFailure', () => {
  it('names the module-resolution signature explicitly (#2631)', () => {
    const message = describeProbeFailure(
      new Error(
        "Cannot find module '/tmp/.tmpX/source/abc/modules/branding/file_actions.js' imported from /",
      ),
    );
    expect(message).toContain('node executor unhealthy');
    expect(message).toContain('its extracted action source is missing');
    expect(message).toContain('Cannot find module');
  });

  it('still produces a distinctive error for any other probe failure', () => {
    const message = describeProbeFailure(new Error('Server Error'));
    expect(message).toBe(
      'node executor unhealthy: the probe action failed (Server Error)',
    );
  });

  it('stringifies a non-Error throw instead of losing it', () => {
    expect(describeProbeFailure('boom')).toBe(
      'node executor unhealthy: the probe action failed (boom)',
    );
  });
});

describe('probeNodeExecutor', () => {
  it('resolves silently on the first successful call (no retry needed)', async () => {
    const callAction = vi.fn().mockResolvedValue(undefined);
    await expect(
      probeNodeExecutor({
        convexUrl: 'http://127.0.0.1:3210',
        timeoutMs: 1_000,
        intervalMs: 1,
        callAction,
      }),
    ).resolves.toBeUndefined();
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction).toHaveBeenCalledWith('http://127.0.0.1:3210');
  });

  it('retries a transiently-warming backend and resolves once it succeeds', async () => {
    const callAction = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);

    await expect(
      probeNodeExecutor({
        convexUrl: 'http://127.0.0.1:3210',
        timeoutMs: 5_000,
        intervalMs: 1,
        callAction,
      }),
    ).resolves.toBeUndefined();
    expect(callAction).toHaveBeenCalledTimes(3);
  });

  it('throws the classified error once the deadline elapses on a persistently broken executor', async () => {
    const callAction = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Cannot find module '/tmp/.tmpX/source/abc/modules/organizations/actions.js' imported from /",
        ),
      );

    await expect(
      probeNodeExecutor({
        convexUrl: 'http://127.0.0.1:3210',
        timeoutMs: 20,
        intervalMs: 5,
        callAction,
      }),
    ).rejects.toThrow(
      /node executor unhealthy.*extracted action source is missing/s,
    );
    expect(callAction.mock.calls.length).toBeGreaterThan(0);
  });
});
