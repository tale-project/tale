/**
 * `automation.read_position` and `automation.save_position`: what a step can
 * ask of its automation's places. The store's own rules — a place per
 * automation, project and key, a save that lands only at the revision its run
 * read, the places deleted with the automation — are proven against real
 * Postgres by the integration lane (`checkAutomationPositions`); these hold
 * the step's side: who may ask, what a step may hand over, and what it reads
 * back.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  platformAutomationNatives,
  POSITION_MAX_BYTES,
  type WorkflowAutomationPositions,
} from './platform-automation';

const STEP = {
  organizationId: 'org-1',
  caller: { kind: 'workflow', runId: 'run-42', nodeId: 'place' },
} as never;

function natives(store: Partial<WorkflowAutomationPositions> = {}) {
  const read = vi.fn(
    store.read ?? (() => Promise.resolve({ value: null, revision: '0' })),
  );
  const save = vi.fn(
    store.save ??
      (() => Promise.resolve({ saved: true, conflict: false, revision: '8' })),
  );
  const impls = platformAutomationNatives({ read, save });
  return {
    read,
    save,
    readPosition: impls['automation.read_position'],
    savePosition: impls['automation.save_position'],
  };
}

describe('a step keeps its own automation’s place between runs [AUTO-R71]', () => {
  it('reads the place of the run it is a step of, under its key', async () => {
    const { read, readPosition } = natives({
      read: () =>
        Promise.resolve({ value: { until: 1_791_000_000_000 }, revision: '7' }),
    });
    await expect(readPosition({ key: 'window' }, STEP)).resolves.toEqual({
      value: { until: 1_791_000_000_000 },
      revision: '7',
    });
    expect(read).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runId: 'run-42',
      key: 'window',
    });
  });

  it('saves a value at the revision its run read, and answers where the place stands', async () => {
    const { save, savePosition } = natives({
      save: () =>
        Promise.resolve({ saved: false, conflict: true, revision: '9' }),
    });
    await expect(
      savePosition(
        { key: 'tale/tale', value: { at: 'x' }, revision: '7' },
        STEP,
      ),
    ).resolves.toEqual({ saved: false, conflict: true, revision: '9' });
    expect(save).toHaveBeenCalledWith({
      organizationId: 'org-1',
      runId: 'run-42',
      key: 'tale/tale',
      value: { at: 'x' },
      revision: '7',
    });
  });

  it.each([
    [{ key: '', value: 1, revision: '0' }],
    [{ key: 'window', value: null, revision: '0' }],
    [{ key: 'window', value: 1, revision: 'seven' }],
    [
      {
        key: 'window',
        value: 'x'.repeat(POSITION_MAX_BYTES + 1),
        revision: '0',
      },
    ],
    [{ key: 'window', value: 1, revision: '0', runId: 'run-7' }],
  ])('refuses %j before the store is asked', async (input) => {
    const { save, savePosition } = natives();
    await expect(savePosition(input, STEP)).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not a step of an automation run', async () => {
    const { read, readPosition, save, savePosition } = natives();
    const person = {
      organizationId: 'org-1',
      caller: { kind: 'user', userId: 'usr-1' },
    } as never;
    await expect(readPosition({ key: 'window' }, person)).rejects.toMatchObject(
      { code: 'CALLER_UNKNOWN' },
    );
    await expect(
      savePosition({ key: 'window', value: 1, revision: '0' }, person),
    ).rejects.toMatchObject({ code: 'CALLER_UNKNOWN' });
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('fails a save whose run is gone, rather than answering a place', async () => {
    const { savePosition } = natives({ save: () => Promise.resolve(null) });
    await expect(
      savePosition({ key: 'window', value: 1, revision: '0' }, STEP),
    ).rejects.toMatchObject({ code: 'LIVE_BODY_FAILED' });
  });
});
