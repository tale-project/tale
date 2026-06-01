import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import schema from '../../schema';
import { __test } from './http_actions';

const { parseEvent } = __test;

const TEST_DIR_FROM_CONVEX_ROOT = 'integrations/slack';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const SECRET = 'test-signing-secret';
const SLACK_EVENTS_PATH = '/api/integrations/slack/events';

function signedHeaders(body: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = `v0=${createHmac('sha256', SECRET)
    .update(`v0:${ts}:${body}`)
    .digest('hex')}`;
  return {
    'Content-Type': 'application/json',
    'X-Slack-Signature': sig,
    'X-Slack-Request-Timestamp': String(ts),
  };
}

describe('slackEventsHandler (httpAction)', () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.SLACK_SIGNING_SECRET;
  });

  it('returns 500 when the signing secret is unset', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const t = convexTest(schema, modules);
    const res = await t.fetch(SLACK_EVENTS_PATH, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(500);
  });

  // Note: the bad-signature (→ IP rate-limit) and signed-event_callback
  // (→ team rate-limit) branches reach the betterAuth/rateLimiter Convex
  // components, which convex-test does not register, so they can't be driven
  // here. They're covered by the verify_signature unit suite + the rate-limiter
  // config; below we exercise the handler branches that don't cross a component.

  it('answers the url_verification challenge', async () => {
    const t = convexTest(schema, modules);
    const body = '{"type":"url_verification","challenge":"abc123"}';
    const res = await t.fetch(SLACK_EVENTS_PATH, {
      method: 'POST',
      headers: signedHeaders(body),
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'abc123' });
  });

  it('rejects malformed JSON (valid signature) with 400', async () => {
    const t = convexTest(schema, modules);
    const body = 'not json';
    const res = await t.fetch(SLACK_EVENTS_PATH, {
      method: 'POST',
      headers: signedHeaders(body),
      body,
    });
    expect(res.status).toBe(400);
  });
});

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
