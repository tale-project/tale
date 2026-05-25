import { describe, it, expect } from 'vitest';

import { shouldDeferProjectSharedExpiry } from './retention_project_shared';

const GRACE_CUTOFF = 1_700_000_000_000;

describe('shouldDeferProjectSharedExpiry', () => {
  describe('non-shared threads', () => {
    it('returns false when sharedWithProject is undefined', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: undefined,
            projectExists: false,
            projectArchivedAt: null,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(false);
    });

    it('returns false when sharedWithProject is false', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: false,
            projectExists: true,
            projectArchivedAt: null,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(false);
    });
  });

  describe('shared-with-project threads', () => {
    it('does not defer when the project no longer exists (orphaned)', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: false,
            projectArchivedAt: null,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(false);
    });

    it('defers when the project is still active (no archivedAt)', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            projectArchivedAt: null,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(true);
    });

    it('defers when projectArchivedAt is undefined (treated like null)', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            projectArchivedAt: undefined,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(true);
    });

    it("defers when the project was archived after the grace cutoff (grace hasn't elapsed)", () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            // Archived AT the cutoff or later → defer.
            projectArchivedAt: GRACE_CUTOFF + 1,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(true);

      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            projectArchivedAt: GRACE_CUTOFF,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(true);
    });

    it('does not defer when projectArchivedAt is before the grace cutoff', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            projectArchivedAt: GRACE_CUTOFF - 1,
          },
          GRACE_CUTOFF,
        ),
      ).toBe(false);

      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            projectArchivedAt: 0, // very old
          },
          GRACE_CUTOFF,
        ),
      ).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles graceCutoffMs of 0', () => {
      expect(
        shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: true,
            projectExists: true,
            projectArchivedAt: 0,
          },
          0,
        ),
      ).toBe(true);
    });
  });
});
