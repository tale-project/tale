import { describe, expect, it } from 'vitest';

import {
  CASE_ORGANIZATION_ID as ORG,
  isGenericLanding,
  notificationTargetPath,
  ORG_LINK_CASES,
  PERSONAL_LINK_CASES,
} from '@/backend/core/notifications/notification_link_cases';
import { buildPersonalNotificationUrl } from '@/backend/core/notifications/personal_notification_url';

import {
  orgNotificationTarget,
  personalNotificationTarget,
} from './notification-target';

/**
 * Every notification type opens the thing it names.
 *
 * The table is the contract and `Record<NotificationType, …>` is the gate: a
 * new type cannot ship without declaring where it goes, or saying in writing
 * why it has nowhere specific to go.
 *
 * The third assertion is the one that would have caught the original defect
 * from either side alone. The bell builder and the email builder are hand-
 * mirrored twins in different runtimes, and a branch added to one and missed
 * in the other is invisible until someone opens an email.
 */

const ORIGIN = 'https://app.example.com';

describe.each(Object.entries(PERSONAL_LINK_CASES))(
  'personal notification: %s',
  (type, linkCase) => {
    const target = personalNotificationTarget({
      organizationId: ORG,
      taskId: linkCase.row.taskId,
      params: linkCase.row.params,
    });

    it('does not land on a generic page without a written reason', () => {
      if (!isGenericLanding(target.to)) return;
      expect(
        linkCase.genericLanding,
        `${type} landed on ${target.to} with no declared reason`,
      ).toBeTruthy();
    });

    it('the bell opens the declared path', () => {
      expect(notificationTargetPath(target)).toBe(linkCase.path);
    });

    it('the email opens the same path', () => {
      expect(
        buildPersonalNotificationUrl({
          organizationId: ORG,
          ...(linkCase.row.taskId !== undefined
            ? { taskId: linkCase.row.taskId }
            : {}),
          ...(linkCase.row.params !== undefined
            ? { params: linkCase.row.params }
            : {}),
          siteUrl: ORIGIN,
        }),
      ).toBe(`${ORIGIN}${linkCase.path}`);
    });
  },
);

describe.each(Object.entries(ORG_LINK_CASES))(
  'org notification link: %s',
  (kind, linkCase) => {
    // Category only decides the landing for a linkless row, and every row
    // here carries a link; `security` is the stricter of the two.
    const target = orgNotificationTarget(ORG, linkCase.link, 'security');

    it('does not land on a generic page without a written reason', () => {
      if (!isGenericLanding(target.to)) return;
      expect(
        linkCase.genericLanding,
        `${kind} landed on ${target.to} with no declared reason`,
      ).toBeTruthy();
    });

    it('opens the declared path', () => {
      expect(notificationTargetPath(target)).toBe(linkCase.path);
    });
  },
);
