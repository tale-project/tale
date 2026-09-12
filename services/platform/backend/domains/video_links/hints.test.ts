// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { VIDEO_LINK_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { hintVideoJobs } from './hints.ts';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

/**
 * The chip reads used to have no realtime signal at all — an idle chat page
 * polled its route every two seconds forever. Every job write now hints the
 * uploader; these pin the hint's shape (user-targeted, the shared entity)
 * and its coalescing (one row per affected uploader, the job named only
 * when the write touched exactly one).
 */
describe('hintVideoJobs', () => {
  const db = {} as Sql;
  const emit = vi.mocked(emitHintInTx);

  it('targets the uploader under the entity the app keys its chip reads on', async () => {
    emit.mockClear();
    await hintVideoJobs(db, [
      { id: 'job-1', organizationId: 'org-1', uploadedBy: 'user-1' },
    ]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(db, {
      orgId: 'org-1',
      userId: 'user-1',
      entity: VIDEO_LINK_HINT_ENTITY,
      entityId: 'job-1',
    });
  });

  it('coalesces a batch to one hint per (organization, uploader)', async () => {
    emit.mockClear();
    await hintVideoJobs(db, [
      { id: 'job-1', organizationId: 'org-1', uploadedBy: 'user-1' },
      { id: 'job-2', organizationId: 'org-1', uploadedBy: 'user-1' },
      { id: 'job-3', organizationId: 'org-1', uploadedBy: 'user-2' },
      { id: 'job-4', organizationId: 'org-2', uploadedBy: 'user-1' },
    ]);
    expect(emit.mock.calls.map(([, hint]) => hint)).toEqual([
      {
        orgId: 'org-1',
        userId: 'user-1',
        entity: 'video_link',
        entityId: null,
      },
      {
        orgId: 'org-1',
        userId: 'user-2',
        entity: 'video_link',
        entityId: null,
      },
      {
        orgId: 'org-2',
        userId: 'user-1',
        entity: 'video_link',
        entityId: null,
      },
    ]);
  });

  it('writes nothing for a write that matched no row', async () => {
    emit.mockClear();
    await hintVideoJobs(db, []);
    expect(emit).not.toHaveBeenCalled();
  });

  it('pins the wire literal both ends share', () => {
    expect(VIDEO_LINK_HINT_ENTITY).toBe('video_link');
  });
});
