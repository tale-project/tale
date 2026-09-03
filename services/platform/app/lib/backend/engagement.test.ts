// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_HINT_ENTITY } from '@/lib/shared/hint-entities';

import {
  engagementPaginatedAdapters,
  engagementReadAdapters,
} from './engagement';

const ctx = { organizationId: 'org1' };

describe('the bell query keys', () => {
  it('key both bells under the entity the backend emits', () => {
    // `use-backend-hints.ts` invalidates `['backend', orgId, hint.entity]`;
    // the collab and org-notification writers emit NOTIFICATION_HINT_ENTITY.
    // Every bell read keys under that same name, or the bell goes silent.
    for (const name of [
      'collab/notifications:myUnreadCount',
      'notifications/queries:unreadCount',
    ]) {
      const read = engagementReadAdapters[name]?.({}, ctx);
      expect(read?.queryKey.slice(0, 3), name).toEqual([
        'backend',
        'org1',
        NOTIFICATION_HINT_ENTITY,
      ]);
    }
    for (const name of [
      'collab/notifications:listMyNotifications',
      'notifications/queries:list',
    ]) {
      const page = engagementPaginatedAdapters[name]?.({}, ctx);
      expect(page?.queryKey.slice(0, 3), name).toEqual([
        'backend',
        'org1',
        NOTIFICATION_HINT_ENTITY,
      ]);
    }
  });

  it('pins the wire literal both ends share', () => {
    expect(NOTIFICATION_HINT_ENTITY).toBe('notification');
  });
});
