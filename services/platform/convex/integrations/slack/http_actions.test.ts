import { describe, expect, it } from 'vitest';

import { __test } from './http_actions';

const { parseEvent } = __test;

describe('parseEvent', () => {
  it('accepts an app_mention', () => {
    expect(
      parseEvent({
        type: 'app_mention',
        user: 'U1',
        channel: 'C1',
        ts: '1.2',
        text: '<@UBOT> hi',
      }),
    ).toEqual({
      eventType: 'app_mention',
      channel: 'C1',
      messageTs: '1.2',
      threadTs: undefined,
      text: '<@UBOT> hi',
      slackUserId: 'U1',
    });
  });

  it('accepts a DM (message with channel_type im) and keeps thread_ts', () => {
    const parsed = parseEvent({
      type: 'message',
      channel_type: 'im',
      user: 'U2',
      channel: 'D1',
      ts: '3.4',
      thread_ts: '3.0',
      text: 'hello',
    });
    expect(parsed?.eventType).toBe('message_im');
    expect(parsed?.threadTs).toBe('3.0');
  });

  it('drops the bot’s own messages (bot_id present)', () => {
    expect(
      parseEvent({
        type: 'app_mention',
        user: 'U1',
        channel: 'C1',
        ts: '1',
        bot_id: 'B1',
      }),
    ).toBeNull();
  });

  it('drops edits/joins/etc. (subtype present)', () => {
    expect(
      parseEvent({
        type: 'message',
        channel_type: 'im',
        user: 'U1',
        channel: 'D1',
        ts: '1',
        subtype: 'message_changed',
      }),
    ).toBeNull();
  });

  it('drops non-DM channel messages without a mention', () => {
    expect(
      parseEvent({
        type: 'message',
        channel_type: 'channel',
        user: 'U1',
        channel: 'C1',
        ts: '1',
      }),
    ).toBeNull();
  });

  it('drops events missing the author', () => {
    expect(
      parseEvent({ type: 'app_mention', channel: 'C1', ts: '1' }),
    ).toBeNull();
  });
});
