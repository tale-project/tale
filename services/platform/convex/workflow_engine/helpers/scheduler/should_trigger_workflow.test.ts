import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { shouldTriggerWorkflow } from './should_trigger_workflow';

describe('shouldTriggerWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false for empty schedule', async () => {
    expect(await shouldTriggerWorkflow('', 'UTC', null)).toBe(false);
  });

  it('should trigger when no previous execution exists', async () => {
    // Set current time to shortly after a scheduled minute boundary
    vi.setSystemTime(new Date('2026-02-12T10:05:10Z'));
    const result = await shouldTriggerWorkflow('*/5 * * * *', 'UTC', null);
    expect(result).toBe(true);
  });

  it('should not trigger when last execution is after scheduled time', async () => {
    vi.setSystemTime(new Date('2026-02-12T10:05:30Z'));
    // Last execution was at 10:05:10, scheduled time was 10:05:00
    const lastExec = new Date('2026-02-12T10:05:10Z').getTime();
    const result = await shouldTriggerWorkflow('*/5 * * * *', 'UTC', lastExec);
    expect(result).toBe(false);
  });

  it('should trigger when last execution is before scheduled time', async () => {
    vi.setSystemTime(new Date('2026-02-12T10:05:30Z'));
    // Last execution was at 10:00:30, scheduled time is 10:05:00
    const lastExec = new Date('2026-02-12T10:00:30Z').getTime();
    const result = await shouldTriggerWorkflow('*/5 * * * *', 'UTC', lastExec);
    expect(result).toBe(true);
  });

  it('should not trigger when outside the 60-second window', async () => {
    // 61 seconds after the scheduled minute
    vi.setSystemTime(new Date('2026-02-12T10:06:01Z'));
    const result = await shouldTriggerWorkflow('*/5 * * * *', 'UTC', null);
    // prev scheduled time is 10:05:00, delta = 61s >= 60s
    expect(result).toBe(false);
  });

  it('should return false for invalid schedule', async () => {
    vi.setSystemTime(new Date('2026-02-12T10:05:00Z'));
    const result = await shouldTriggerWorkflow('not-a-cron', 'UTC', null);
    expect(result).toBe(false);
  });

  it('does not check execution status - only timestamp (regression baseline)', async () => {
    vi.setSystemTime(new Date('2026-02-12T10:10:30Z'));
    // A "running" execution started at 10:05:10 - shouldTriggerWorkflow
    // only sees the timestamp, not the status. This is the bug we are fixing
    // at the caller level (scan_and_trigger), not here.
    const runningExecStartedAt = new Date('2026-02-12T10:05:10Z').getTime();
    const result = await shouldTriggerWorkflow(
      '*/5 * * * *',
      'UTC',
      runningExecStartedAt,
    );
    // Returns true because lastExec (10:05:10) < prevScheduled (10:10:00)
    expect(result).toBe(true);
  });
});
