import { createHmac } from 'node:crypto';

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encryptString } from '../../lib/crypto/encrypt_string';
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
// A valid 32-byte key so `encryptString`/`decryptString` resolve a secret key.
const ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString('base64url');

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

/** Seed a slug='slack' credential carrying an encrypted signing secret. */
async function seedSlackCredential(
  t: ReturnType<typeof convexTest>,
): Promise<void> {
  const signingSecretEncrypted = await encryptString(SECRET);
  await t.run(async (ctx) => {
    await ctx.db.insert('integrationCredentials', {
      organizationId: 'org_test',
      slug: 'slack',
      status: 'active',
      isActive: true,
      authMethod: 'oauth2',
      oauth2Config: {
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        signingSecretEncrypted,
      },
    });
  });
}

// Whole-tree module map (needed for t.fetch routing) makes this suite
// boot-heavy; under a loaded CI worker the default 5s budget is not enough.
describe('slackEventsHandler (httpAction)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = ENCRYPTION_SECRET;
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  // Note: the no-match / bad-signature (→ IP rate-limit) and signed-event_callback
  // (→ team rate-limit) branches reach the betterAuth/rateLimiter Convex
  // components, which convex-test does not register, so they can't be driven
  // here. They're covered by the verify_signature unit suite + the rate-limiter
  // config; below we exercise the url_verification happy path, which verifies the
  // request against the per-org signing secret resolved from the credential row.

  it('answers the url_verification challenge against a stored signing secret', async () => {
    const t = convexTest(schema, modules);
    await seedSlackCredential(t);
    const body = '{"type":"url_verification","challenge":"abc123"}';
    const res = await t.fetch(SLACK_EVENTS_PATH, {
      method: 'POST',
      headers: signedHeaders(body),
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'abc123' });
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

  it('accepts a top-level DM with no thread_ts (the common case)', () => {
    const parsed = parseEvent({
      type: 'message',
      channel_type: 'im',
      user: 'U2',
      channel: 'D1',
      ts: '3.4',
      text: 'hello',
    });
    expect(parsed?.eventType).toBe('message_im');
    expect(parsed?.threadTs).toBeUndefined();
    expect(parsed?.messageTs).toBe('3.4');
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
