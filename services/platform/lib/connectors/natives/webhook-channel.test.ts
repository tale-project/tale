import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import {
  signWebhookPayload,
  verifyWebhookSignature,
  webhookChannelNatives,
  WEBHOOK_CHANNEL_SEND_IMPL,
  WEBHOOK_CHANNEL_STATUS_IMPL,
} from './webhook-channel';

/**
 * What matters about this action is that the receiver can trust what arrives:
 * the delivery is signed over its own id, timestamp and exact bytes, the id is
 * stable across retries so a redelivery is recognisable, and a credential
 * missing either half of what signing needs refuses before anything is sent.
 *
 * No test performs real IO — `ctx.http` is a double, so an assertion that it
 * was not called proves nothing left the process.
 */

const SECRET = 'whsec_a_very_random_value';
const ENDPOINT = 'https://desk.example.com';

const INPUT = {
  conversationId: 'conv_1',
  messageId: 'msg_1',
  to: ['user_42'],
  subject: 'Payment not reflecting',
  body: 'We have credited the payment.',
  contentType: 'Text' as const,
};

interface PostCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A native context with a recording `http.post`; `answer` shapes the reply. */
function context(
  overrides: {
    endpoint?: string | undefined;
    secret?: string;
    config?: Record<string, string | number | boolean>;
    answer?: { status: number; json?: unknown; text?: string };
  } = {},
) {
  const posts: PostCall[] = [];
  const answer = overrides.answer ?? { status: 200, json: {} };
  const refuse = () => Promise.reject(new Error('only POST is used here'));
  const ctx: NativeConnectorContext = {
    secrets: { get: () => overrides.secret ?? SECRET },
    idempotencyKey: 'whk_stable_1',
    ...('endpoint' in overrides
      ? overrides.endpoint !== undefined
        ? { endpoint: overrides.endpoint }
        : {}
      : { endpoint: ENDPOINT }),
    config: overrides.config ?? {},
    organizationId: 'org_1',
    credentialId: 'cred_1',
    authMethod: 'api-key',
    http: {
      get: refuse,
      post: (url, req) => {
        posts.push({
          url,
          headers: req?.headers ?? {},
          body: req?.body ?? '',
        });
        return Promise.resolve({
          status: answer.status,
          headers: {},
          json: () => answer.json,
          text: () => answer.text ?? JSON.stringify(answer.json ?? {}),
        });
      },
      put: refuse,
      patch: refuse,
      delete: refuse,
    },
    base64Encode: (value: string) => Buffer.from(value).toString('base64'),
    base64Decode: (value: string) =>
      Buffer.from(value, 'base64').toString('utf8'),
  };
  return { ctx, posts };
}

const send = () => webhookChannelNatives()[WEBHOOK_CHANNEL_SEND_IMPL]!;

describe('webhook-channel.send_message', () => {
  it('posts to the credential origin with the configured path', async () => {
    const { ctx, posts } = context({ config: { path: 'webhooks/inbox' } });
    await send()(INPUT, ctx);
    expect(posts).toHaveLength(1);
    // A path without its leading slash is still a path on the origin, never a
    // sibling of it.
    expect(posts[0]?.url).toBe('https://desk.example.com/webhooks/inbox');
  });

  it('defaults to the origin root when no path is configured', async () => {
    const { ctx, posts } = context();
    await send()(INPUT, ctx);
    expect(posts[0]?.url).toBe('https://desk.example.com/');
  });

  it('signs the id, the timestamp and the exact bytes it sent', async () => {
    const { ctx, posts } = context();
    await send()(INPUT, ctx);
    const sent = posts[0]!;
    const id = sent.headers['webhook-id']!;
    const timestamp = Number(sent.headers['webhook-timestamp']);
    expect(id).toBe('whk_stable_1');
    expect(Number.isInteger(timestamp)).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        webhookId: id,
        timestamp,
        body: sent.body,
        signature: sent.headers['webhook-signature']!,
      }),
    ).toBe(true);
  });

  it('produces a signature a receiver can check with a stock HMAC', () => {
    const signature = signWebhookPayload({
      secret: SECRET,
      webhookId: 'whk_1',
      timestamp: 1_700_000_000,
      body: '{"a":1}',
    });
    const expected = createHmac('sha256', SECRET)
      .update('whk_1.1700000000.{"a":1}')
      .digest('base64');
    expect(signature).toBe(`v1,${expected}`);
  });

  it('refuses a signature over different bytes', async () => {
    const { ctx, posts } = context();
    await send()(INPUT, ctx);
    const sent = posts[0]!;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        webhookId: sent.headers['webhook-id']!,
        timestamp: Number(sent.headers['webhook-timestamp']),
        body: `${sent.body} tampered`,
        signature: sent.headers['webhook-signature']!,
      }),
    ).toBe(false);
  });

  it('refuses a signature made with another secret', async () => {
    const { ctx, posts } = context();
    await send()(INPUT, ctx);
    const sent = posts[0]!;
    expect(
      verifyWebhookSignature({
        secret: 'whsec_not_ours',
        webhookId: sent.headers['webhook-id']!,
        timestamp: Number(sent.headers['webhook-timestamp']),
        body: sent.body,
        signature: sent.headers['webhook-signature']!,
      }),
    ).toBe(false);
  });

  it('carries the conversation, the message and the reply in the body', async () => {
    const { ctx, posts } = context();
    await send()(INPUT, ctx);
    expect(JSON.parse(posts[0]!.body)).toMatchObject({
      type: 'conversation.message.sent',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      to: ['user_42'],
      subject: 'Payment not reflecting',
      body: 'We have credited the payment.',
      contentType: 'Text',
      attachments: [],
    });
  });

  it('passes the receiver its own id back when it answers with one', async () => {
    const { ctx } = context({
      answer: { status: 200, json: { messageId: 'remote_9' } },
    });
    await expect(send()(INPUT, ctx)).resolves.toMatchObject({
      status: 200,
      deliveryId: 'whk_stable_1',
      messageId: 'remote_9',
    });
  });

  it('accepts a 204 with no body', async () => {
    const { ctx } = context({ answer: { status: 204 } });
    await expect(send()(INPUT, ctx)).resolves.toEqual({
      status: 204,
      deliveryId: 'whk_stable_1',
    });
  });

  it("fails with the receiver's own words so the retry surface shows them", async () => {
    const { ctx } = context({
      answer: { status: 422, text: 'unknown conversation' },
    });
    await expect(send()(INPUT, ctx)).rejects.toThrow(
      /rejected \(422\): unknown conversation/,
    );
  });

  it('refuses before sending when the credential has no endpoint', async () => {
    const { ctx, posts } = context({ endpoint: undefined });
    await expect(send()(INPUT, ctx)).rejects.toThrow(/no endpoint/);
    expect(posts).toHaveLength(0);
  });

  it('refuses before sending when the credential has no secret', async () => {
    const { ctx, posts } = context({ secret: '' });
    await expect(send()(INPUT, ctx)).rejects.toThrow(/no signing secret/);
    expect(posts).toHaveLength(0);
  });

  it('refuses an input it cannot send', async () => {
    const { ctx, posts } = context();
    await expect(send()({ body: 'orphan' }, ctx)).rejects.toThrow(
      /cannot send/,
    );
    expect(posts).toHaveLength(0);
  });

  it('refuses a reply past the body cap instead of truncating it', async () => {
    const { ctx, posts } = context();
    await expect(
      send()({ ...INPUT, body: 'x'.repeat(300 * 1024) }, ctx),
    ).rejects.toThrow(/too long to deliver/);
    expect(posts).toHaveLength(0);
  });

  it('reuses one delivery id across retries of the same step', async () => {
    const first = context();
    const second = context();
    await send()(INPUT, first.ctx);
    await send()(INPUT, second.ctx);
    expect(first.posts[0]?.headers['webhook-id']).toBe(
      second.posts[0]?.headers['webhook-id'],
    );
  });

  it('registers under the impl ids the catalog declares', () => {
    expect(Object.keys(webhookChannelNatives()).sort()).toEqual([
      'webhook-channel.send_message',
      'webhook-channel.send_status',
    ]);
  });
});

describe('acknowledgement shapes', () => {
  /**
   * A receiver that answers `200 OK` in plain text has accepted the delivery.
   * Reading that as a failure would retry a message that already landed, and
   * the customer would see the same reply twice.
   */
  it('accepts a plain-text 200 without a JSON body', async () => {
    const { ctx } = context({
      answer: { status: 200, text: 'OK' },
    });
    // The double's json() mirrors the real host: it throws on a non-JSON body.
    ctx.http.post = (() => {
      return Promise.resolve({
        status: 200,
        headers: {},
        json: () => {
          throw new Error('response body is not JSON');
        },
        text: () => 'OK',
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow double
    }) as typeof ctx.http.post;
    await expect(send()(INPUT, ctx)).resolves.toMatchObject({
      status: 200,
      deliveryId: 'whk_stable_1',
    });
  });

  it('still fails a non-2xx whatever its body type', async () => {
    const { ctx } = context({ answer: { status: 503, text: 'upstream down' } });
    await expect(send()(INPUT, ctx)).rejects.toThrow(/rejected \(503\)/);
  });
});

/**
 * Closing a conversation in the Inbox used to reach automation triggers and
 * nothing else, so a product owning the customer's view showed "we're on it"
 * forever. This action is what carries the transition across.
 */
describe('webhook-channel.send_status', () => {
  const sendStatus = () =>
    webhookChannelNatives()[WEBHOOK_CHANNEL_STATUS_IMPL]!;

  it('tells the receiver a case ended', async () => {
    const { ctx, posts } = context();
    await sendStatus()({ conversationId: 'conv_1', status: 'closed' }, ctx);
    expect(JSON.parse(posts[0]!.body)).toMatchObject({
      type: 'conversation.closed',
      conversationId: 'conv_1',
      status: 'closed',
    });
  });

  it('tells it when one comes back', async () => {
    const { ctx, posts } = context();
    await sendStatus()({ conversationId: 'conv_1', status: 'open' }, ctx);
    expect(JSON.parse(posts[0]!.body)).toMatchObject({
      type: 'conversation.reopened',
      status: 'open',
    });
  });

  it('reads spam and archived as ended, not as Tale triage states', async () => {
    // The receiver cares that it stopped waiting for an answer; leaking the
    // Inbox's housekeeping vocabulary into another product would make it
    // model states it has no use for.
    for (const status of ['spam', 'archived'] as const) {
      const { ctx, posts } = context();
      await sendStatus()({ conversationId: 'conv_1', status }, ctx);
      expect(JSON.parse(posts[0]!.body).type).toBe('conversation.closed');
    }
  });

  it('signs exactly as send_message does, so one verifier covers both', async () => {
    const { ctx, posts } = context();
    await sendStatus()({ conversationId: 'conv_1', status: 'closed' }, ctx);
    const sent = posts[0]!;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        webhookId: sent.headers['webhook-id']!,
        timestamp: Number(sent.headers['webhook-timestamp']),
        body: sent.body,
        signature: sent.headers['webhook-signature']!,
      }),
    ).toBe(true);
  });

  it('refuses a status it does not recognise', async () => {
    const { ctx, posts } = context();
    await expect(
      sendStatus()({ conversationId: 'conv_1', status: 'pending' }, ctx),
    ).rejects.toThrow(/cannot send/);
    expect(posts).toHaveLength(0);
  });

  it('fails on a rejected delivery', async () => {
    const { ctx } = context({ answer: { status: 500, text: 'boom' } });
    await expect(
      sendStatus()({ conversationId: 'conv_1', status: 'closed' }, ctx),
    ).rejects.toThrow(/rejected \(500\)/);
  });
});
