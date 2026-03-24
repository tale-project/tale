import { describe, expect, it } from 'vitest';

import {
  SYSTEM_MSG_TAG,
  getSystemMessageDisplay,
  parseSystemMessageTag,
} from '../system-message-tags';

describe('parseSystemMessageTag', () => {
  it('parses known tags from content start', () => {
    const result = parseSystemMessageTag(
      '[WORKFLOW_COMPLETED]\nWorkflow done.',
    );
    expect(result.tag).toBe(SYSTEM_MSG_TAG.WORKFLOW_COMPLETED);
    expect(result.body).toBe('Workflow done.');
  });

  it('trims leading whitespace from body', () => {
    const result = parseSystemMessageTag('[WORKFLOW_FAILED]   Error occurred.');
    expect(result.tag).toBe(SYSTEM_MSG_TAG.WORKFLOW_FAILED);
    expect(result.body).toBe('Error occurred.');
  });

  it('returns null tag for content without tag prefix', () => {
    const result = parseSystemMessageTag('Just a plain message');
    expect(result.tag).toBeNull();
    expect(result.body).toBe('Just a plain message');
  });

  it('returns null tag for empty content', () => {
    const result = parseSystemMessageTag('');
    expect(result.tag).toBeNull();
    expect(result.body).toBe('');
  });

  it('returns null tag for unknown bracket tags', () => {
    const result = parseSystemMessageTag('[UNKNOWN_TAG] Some content');
    expect(result.tag).toBeNull();
    expect(result.body).toBe('[UNKNOWN_TAG] Some content');
  });

  it('ignores tags not at the start of content', () => {
    const result = parseSystemMessageTag(
      'Some text [WORKFLOW_COMPLETED] more text',
    );
    expect(result.tag).toBeNull();
    expect(result.body).toBe('Some text [WORKFLOW_COMPLETED] more text');
  });

  it('parses all known tags', () => {
    for (const tag of Object.values(SYSTEM_MSG_TAG)) {
      const result = parseSystemMessageTag(`${tag} body`);
      expect(result.tag).toBe(tag);
      expect(result.body).toBe('body');
    }
  });

  it('handles tag with no body', () => {
    const result = parseSystemMessageTag('[TIMEOUT_RECOVERY]');
    expect(result.tag).toBe(SYSTEM_MSG_TAG.TIMEOUT_RECOVERY);
    expect(result.body).toBe('');
  });
});

describe('getSystemMessageDisplay', () => {
  it('returns pill for HUMAN_INPUT_RESPONSE', () => {
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.HUMAN_INPUT_RESPONSE)).toBe(
      'pill',
    );
  });

  it('returns info for workflow completion tags', () => {
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.WORKFLOW_COMPLETED)).toBe(
      'info',
    );
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.WORKFLOW_CREATED)).toBe(
      'info',
    );
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.WORKFLOW_UPDATED)).toBe(
      'info',
    );
  });

  it('returns warning for interruption tags', () => {
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.RESPONSE_INTERRUPTED)).toBe(
      'warning',
    );
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.TIMEOUT_RECOVERY)).toBe(
      'warning',
    );
  });

  it('returns error for WORKFLOW_FAILED', () => {
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.WORKFLOW_FAILED)).toBe(
      'error',
    );
  });

  it('returns info for user-initiated actions', () => {
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.APPROVAL_REJECTED)).toBe(
      'info',
    );
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.WORKFLOW_CANCELLED)).toBe(
      'info',
    );
    expect(getSystemMessageDisplay(SYSTEM_MSG_TAG.WORKFLOW_STARTED)).toBe(
      'info',
    );
  });

  it('returns info for null tag', () => {
    expect(getSystemMessageDisplay(null)).toBe('info');
  });
});
