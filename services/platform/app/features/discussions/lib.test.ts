import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISCUSSION_CATEGORIES,
  DISCUSSION_STATUSES,
} from '@/lib/shared/constants/discussions';

import {
  discussionCategoryLabel,
  DISCUSSION_STATUS_BADGE,
  isKnownDiscussionCategory,
  toDiscussionStatus,
} from './lib';

describe('toDiscussionStatus', () => {
  it('passes through each valid lifecycle status', () => {
    for (const status of DISCUSSION_STATUSES) {
      expect(toDiscussionStatus(status)).toBe(status);
    }
  });

  it('defaults undefined to open (no status persisted yet)', () => {
    expect(toDiscussionStatus(undefined)).toBe('open');
  });

  it('defaults an unexpected wire value to open instead of breaking', () => {
    expect(toDiscussionStatus('archived')).toBe('open');
    expect(toDiscussionStatus('')).toBe('open');
  });
});

describe('DISCUSSION_STATUS_BADGE', () => {
  it('maps every lifecycle status to a badge variant', () => {
    for (const status of DISCUSSION_STATUSES) {
      expect(DISCUSSION_STATUS_BADGE[status]).toBeDefined();
    }
  });
});

describe('isKnownDiscussionCategory', () => {
  it('recognises every built-in category', () => {
    for (const category of DEFAULT_DISCUSSION_CATEGORIES) {
      expect(isKnownDiscussionCategory(category)).toBe(true);
    }
  });

  it('rejects a custom/unknown category (rendered verbatim, not via i18n)', () => {
    expect(isKnownDiscussionCategory('custom-bucket')).toBe(false);
    expect(isKnownDiscussionCategory('')).toBe(false);
  });
});

describe('discussionCategoryLabel', () => {
  it('localizes every built-in category via its categories.<id> key', () => {
    const translate = (key: string) => `t:${key}`;
    for (const category of DEFAULT_DISCUSSION_CATEGORIES) {
      expect(discussionCategoryLabel(category, translate)).toBe(
        `t:categories.${category}`,
      );
    }
  });

  it('renders a custom/unknown category verbatim (no i18n lookup)', () => {
    let called = false;
    const translate = (key: string) => {
      called = true;
      return `t:${key}`;
    };
    expect(discussionCategoryLabel('custom-bucket', translate)).toBe(
      'custom-bucket',
    );
    expect(called).toBe(false);
  });
});
