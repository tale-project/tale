import { describe, expect, it } from 'vitest';

import { RETENTION_POLICY_FIELD_BY_CATEGORY } from '../../core/governance/retention_floors.ts';
import { detectRetentionShortening } from './settings-tail.ts';

describe('detectRetentionShortening', () => {
  it('sees a shortening in every bounded category, agentRuns and notifications included', () => {
    for (const field of Object.values(RETENTION_POLICY_FIELD_BY_CATEGORY)) {
      const summary = detectRetentionShortening(
        { [field]: 30 },
        { [field]: 7 },
      );
      expect(summary, field).not.toBeNull();
      expect(summary).toContain('(30 → 7)');
    }
  });

  it('still counts the grace window and ignores a category the new config disabled', () => {
    expect(
      detectRetentionShortening(
        { deletionGraceDays: 14 },
        { deletionGraceDays: 2 },
      ),
    ).toBe('Reduced: deletion grace (14 → 2)');
    expect(
      detectRetentionShortening(
        { agentRunsRetentionDays: 30 },
        { agentRunsRetentionDays: 7, agentRunsEnabled: false },
      ),
    ).toBeNull();
    expect(
      detectRetentionShortening(
        { agentRunsRetentionDays: 7 },
        { agentRunsRetentionDays: 30 },
      ),
    ).toBeNull();
  });
});
