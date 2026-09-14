/**
 * The `webhook-channel` connector's native backend — outbound delivery for a
 * conversation that does not live in a mailbox.
 *
 * The Inbox could only ever answer over email: a reply resolved a mail
 * connector, built RFC threading headers, and needed a contact address. A
 * product that owns its own customer-facing surface (an in-app support widget,
 * a portal, a kiosk) has none of those and still wants one shared inbox, one
 * assignment model, and one set of agents. This connector is the other half of
 * that: the org's staff reply in the Inbox, and the reply is POSTed to the
 * deployment the credential names.
 *
 * It is `native` rather than a `yaml-js` body for one reason: signing. A
 * sandboxed body reaches `secrets`, `endpoint`, `config`, `http` and `files`
 * and no crypto, so it can carry a shared token but cannot prove the body was
 * not altered in transit. A native runs in Node and signs.
 *
 * Security posture, all of it inherited rather than invented:
 *
 *  - **Where it can reach** is the credential's own origin and nothing else —
 *    the connector declares `endpoint.hostPolicy: credential-origin`, so the
 *    host derives its allowlist from the endpoint an org admin entered. The
 *    action's input never names a host, so no caller can redirect a delivery.
 *  - **What it sends with** is `ctx.http`, the platform's mediated client:
 *    https only, private and cloud-metadata space refused, redirects re-checked
 *    against the same one host, response size and timeout capped.
 *  - **How the receiver knows it is us** is Standard Webhooks — the same
 *    `webhook-id` / `webhook-timestamp` / `webhook-signature` triple Tale's own
 *    inbound door already recognises, so an embedder verifies this delivery
 *    with whatever library it already verifies Stripe or Resend with.
 *
 * The signature covers the id, the timestamp and the exact bytes, so a replay
 * carries its original timestamp and a receiver enforcing a freshness window
 * rejects it. `webhook-id` is `ctx.idempotencyKey`, which is stable across
 * retries of one step: a receiver that stores it answers a redelivery with the
 * message it already has instead of a duplicate reply in the customer's thread.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod/v4';

import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError } from '../errors';

const CONNECTOR = 'webhook-channel';

/** The impl ids the catalog entry declares. */
export const WEBHOOK_CHANNEL_SEND_IMPL = 'webhook-channel.send_message';
export const WEBHOOK_CHANNEL_STATUS_IMPL = 'webhook-channel.send_status';

/**
 * The canonical spelling of an `api-key` secret. The credentials domain
 * publishes one stored token under several vendor vocabularies; `token` is the
 * one every connector can count on.
 */
const SECRET_NAME = 'token';

/** Cap on one delivery body. A reply is a message, not an upload — attachments
 * travel as presigned URLs the receiver fetches, never as inline bytes. */
const MAX_BODY_BYTES = 256 * 1024;

const attachmentSchema = z
  .object({
    name: z.string().min(1).max(1024),
    contentType: z.string().max(255).default('application/octet-stream'),
    size: z.number().int().nonnegative(),
    /** A presigned GET the receiver pulls the bytes from. */
    url: z.string().min(1),
  })
  .strict();

const sendInputSchema = z
  .object({
    /** The Inbox conversation this reply belongs to — what the receiver
     * threads on. */
    conversationId: z.string().min(1).max(64),
    /** The Tale message row, so a receiver can reconcile what it stored. */
    messageId: z.string().min(1).max(64),
    /** The recipient reference in the RECEIVER's vocabulary — whatever it put
     * on the conversation when it opened the thread. Opaque here. */
    to: z.array(z.string().min(1).max(512)).default([]),
    subject: z.string().max(2000).optional(),
    body: z.string(),
    contentType: z.enum(['HTML', 'Text']).default('Text'),
    attachments: z.array(attachmentSchema).default([]),
  })
  .strict();

export type WebhookChannelSendInput = z.infer<typeof sendInputSchema>;

const statusInputSchema = z
  .object({
    conversationId: z.string().min(1).max(64),
    status: z.enum(['open', 'closed', 'spam', 'archived']),
    to: z.array(z.string().min(1).max(512)).default([]),
  })
  .strict();

export type WebhookChannelStatusInput = z.infer<typeof statusInputSchema>;

/**
 * What a status change is called on the wire.
 *
 * The receiver cares about the TRANSITION, not the vocabulary: `closed` ends a
 * case, anything else revives it. Spam and archived are Inbox housekeeping that
 * still mean "stop waiting for an answer", so they read as closed rather than
 * leaking Tale's triage states into somebody else's product.
 */
function statusEventType(status: string): string {
  return status === 'open' ? 'conversation.reopened' : 'conversation.closed';
}

/** The delivery path on the credential's origin. The stored endpoint is an
 * ORIGIN — any path an admin typed was dropped when it was normalized — so the
 * route is a per-credential setting instead. */
function deliveryPath(ctx: NativeConnectorContext): string {
  const raw = ctx.config.path;
  const path = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '/';
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * The Standard Webhooks signature over one delivery: base64 HMAC-SHA256 of
 * `<id>.<timestamp>.<body>`, prefixed with the scheme version.
 */
export function signWebhookPayload(args: {
  secret: string;
  webhookId: string;
  timestamp: number;
  body: string;
}): string {
  const mac = createHmac('sha256', args.secret);
  mac.update(`${args.webhookId}.${args.timestamp}.${args.body}`);
  return `v1,${mac.digest('base64')}`;
}

/**
 * Verify a signature this module produced. Exported for the receiver side of a
 * round-trip test, and so an embedder reading this file has the exact
 * construction in front of it rather than a prose description of one.
 */
export function verifyWebhookSignature(args: {
  secret: string;
  webhookId: string;
  timestamp: number;
  body: string;
  signature: string;
}): boolean {
  const expected = Buffer.from(signWebhookPayload(args));
  const given = Buffer.from(args.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** One signed POST, shared by every action so a receiver verifies them all the
 * same way and no lane can drift into its own header shape. */
async function postSigned(
  ctx: NativeConnectorContext,
  args: { endpoint: string; secret: string; timestamp: number; body: string },
) {
  return ctx.http.post(`${args.endpoint}${deliveryPath(ctx)}`, {
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': ctx.idempotencyKey,
      'webhook-timestamp': String(args.timestamp),
      'webhook-signature': signWebhookPayload({
        secret: args.secret,
        webhookId: ctx.idempotencyKey,
        timestamp: args.timestamp,
        body: args.body,
      }),
    },
    body: args.body,
  });
}

function requireEndpoint(ctx: NativeConnectorContext): string {
  if (ctx.endpoint === undefined || ctx.endpoint === '') {
    throw new ConnectorError(
      'CREDENTIAL_UNRESOLVED',
      `connector "${CONNECTOR}" has no endpoint on its credential — enter the URL of the deployment that receives the replies`,
      { connector: CONNECTOR },
    );
  }
  return ctx.endpoint;
}

function requireSecret(ctx: NativeConnectorContext): string {
  const secret = ctx.secrets.get(SECRET_NAME);
  if (secret === '') {
    throw new ConnectorError(
      'CREDENTIAL_UNRESOLVED',
      `connector "${CONNECTOR}" has no signing secret on its credential — the receiver cannot tell this delivery from a forged one`,
      { connector: CONNECTOR },
    );
  }
  return secret;
}

/**
 * The `webhook-channel` native backends, keyed by the impl id the connector
 * declares. Takes no platform dependency: everything this action needs is on
 * the credential and in the mediated context.
 */
export function webhookChannelNatives(): Readonly<
  Record<string, NativeConnectorImpl>
> {
  const sendMessage: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = sendInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ConnectorError(
        'INPUT_INVALID',
        `${CONNECTOR}.send_message got an input it cannot send: ${z.prettifyError(parsed.error)}`,
        { connector: CONNECTOR },
      );
    }
    const endpoint = requireEndpoint(ctx);
    const secret = requireSecret(ctx);

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type: 'conversation.message.sent',
      conversationId: parsed.data.conversationId,
      messageId: parsed.data.messageId,
      to: parsed.data.to,
      ...(parsed.data.subject !== undefined && {
        subject: parsed.data.subject,
      }),
      body: parsed.data.body,
      contentType: parsed.data.contentType,
      attachments: parsed.data.attachments,
      sentAt: timestamp,
    });
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new ConnectorError(
        'REQUEST_TOO_LARGE',
        `${CONNECTOR}.send_message body is over ${MAX_BODY_BYTES} bytes — the reply is too long to deliver`,
        { connector: CONNECTOR },
      );
    }

    const response = await postSigned(ctx, {
      endpoint,
      secret,
      timestamp,
      body,
    });

    // Non-2xx is data to this layer, so the refusal carries the receiver's own
    // words — that text is what lands on the failed message row and what the
    // person retrying the send reads.
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorError(
        'LIVE_BODY_FAILED',
        `${CONNECTOR}.send_message was rejected (${response.status}): ${response.text().slice(0, 500)}`,
        { connector: CONNECTOR },
      );
    }

    // A receiver that answers with its own id for the message lets the reply be
    // reconciled from either side. Everything about that is OPTIONAL, including
    // the body being JSON at all: a plain `200 OK` is a perfectly ordinary way
    // to acknowledge a webhook, and reading it as a failure would retry a
    // delivery that already landed — posting the customer the same reply twice.
    // The status decided success above; this only mines the body for an id.
    let remoteId: string | undefined;
    try {
      const answered: unknown =
        response.status === 204 ? null : response.json();
      if (
        answered !== null &&
        typeof answered === 'object' &&
        'messageId' in answered &&
        typeof answered.messageId === 'string'
      ) {
        remoteId = answered.messageId;
      }
    } catch {
      // Not JSON, or not an object. The delivery still succeeded.
    }
    return {
      status: response.status,
      deliveryId: ctx.idempotencyKey,
      ...(remoteId !== undefined && { messageId: remoteId }),
    };
  };

  /**
   * Tell the product its conversation was closed or reopened.
   *
   * Without this a customer's copy says "we're on it" forever: closing in the
   * Inbox raises `conversation.closed`, but that event only fans out to
   * automation triggers — nothing carried it to the product that owns the
   * customer's view of the thread.
   */
  const sendStatus: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = statusInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ConnectorError(
        'INPUT_INVALID',
        `${CONNECTOR}.send_status got an input it cannot send: ${z.prettifyError(parsed.error)}`,
        { connector: CONNECTOR },
      );
    }
    const endpoint = requireEndpoint(ctx);
    const secret = requireSecret(ctx);

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type: statusEventType(parsed.data.status),
      conversationId: parsed.data.conversationId,
      status: parsed.data.status,
      to: parsed.data.to,
      changedAt: timestamp,
    });

    const response = await postSigned(ctx, {
      endpoint,
      secret,
      timestamp,
      body,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorError(
        'LIVE_BODY_FAILED',
        `${CONNECTOR}.send_status was rejected (${response.status}): ${response.text().slice(0, 500)}`,
        { connector: CONNECTOR },
      );
    }
    return { status: response.status, deliveryId: ctx.idempotencyKey };
  };

  return Object.freeze({
    [WEBHOOK_CHANNEL_SEND_IMPL]: sendMessage,
    [WEBHOOK_CHANNEL_STATUS_IMPL]: sendStatus,
  });
}
