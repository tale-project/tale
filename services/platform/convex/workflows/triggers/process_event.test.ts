import { describe, expect, it } from 'vitest';

import { isSubscriptionAllowedForTask } from './process_event';

// The ownership-arbitration guard: a task created by an app is driven by that
// app's OWN workflow, so a generic subscription (or another app's) must not
// also fire on it. Non-app tasks are open to every subscription.
describe('isSubscriptionAllowedForTask', () => {
  it('allows ANY subscription on a non-app task (user/agent/undefined creator)', () => {
    for (const createdByType of ['user', 'agent', undefined]) {
      // generic subscription (no owning app)
      expect(isSubscriptionAllowedForTask(createdByType, 'someone', null)).toBe(
        true,
      );
      // an app's subscription
      expect(
        isSubscriptionAllowedForTask(createdByType, 'someone', 'issue-desk'),
      ).toBe(true);
    }
  });

  it('allows ONLY the owning app on an app-created task', () => {
    // same app → allowed
    expect(
      isSubscriptionAllowedForTask('app', 'issue-desk', 'issue-desk'),
    ).toBe(true);
    // a DIFFERENT app → blocked
    expect(isSubscriptionAllowedForTask('app', 'issue-desk', 'other-app')).toBe(
      false,
    );
    // a GENERIC workflow (no owning app) → blocked
    expect(isSubscriptionAllowedForTask('app', 'issue-desk', null)).toBe(false);
    expect(isSubscriptionAllowedForTask('app', 'issue-desk', undefined)).toBe(
      false,
    );
  });
});
