import { describe, expect, it } from 'vitest';

import {
  ACTIONABLE_NOTIFICATION_TYPES,
  isActionableNotificationType,
} from './attention';

describe('attention notification types', () => {
  it('classifies actionable types', () => {
    for (const type of ACTIONABLE_NOTIFICATION_TYPES) {
      expect(isActionableNotificationType(type)).toBe(true);
    }
    expect(isActionableNotificationType('task_status_changed')).toBe(false);
    expect(isActionableNotificationType('workforce_digest')).toBe(false);
  });
});
