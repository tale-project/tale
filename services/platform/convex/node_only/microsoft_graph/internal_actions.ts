'use node';

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

type GraphRecipient = { emailAddress: { address: string } };

type SendResult = { graphMessageId: string; internetMessageId: string };

type Body = { contentType: 'HTML' | 'Text'; content: string };

const escapeOData = (s: string): string => s.replace(/'/g, "''");

const mapRecipients = (emails?: string[]): Array<GraphRecipient> =>
  (emails || []).map((address) => ({ emailAddress: { address } }));

async function trySendViaReplyFlow(params: {
  accessToken: string;
  inReplyTo: string;
  body: Body;
  to?: string[];
  cc?: string[];
  bcc?: string[];
}): Promise<SendResult> {
  const { accessToken, inReplyTo, body, to, cc, bcc } = params;

  // 1) Find the parent message by internetMessageId
  // Build $filter using URLSearchParams to correctly encode reserved characters in Message-ID
  const filter = `internetMessageId eq '${escapeOData(inReplyTo)}'`;
  const searchParams = new URLSearchParams({ $filter: filter, $select: 'id' });
  const findUrl = `https://graph.microsoft.com/v1.0/me/messages?${searchParams.toString()}`;
  const findResp = await fetch(findUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!findResp.ok) {
    const t = await findResp.text();
    throw new Error(
      `Microsoft Graph API error (lookup parent): ${findResp.status} ${findResp.statusText} - ${t}`,
    );
  }
  const findData = (await findResp.json()) as { value: Array<{ id: string }> };
  if (!findData.value || findData.value.length === 0) {
    throw new Error(
      `[Graph] Parent message not found for inReplyTo: ${inReplyTo}`,
    );
  }
  const parentId = findData.value[0].id;

  // 2) Create a reply draft
  const createReplyResp = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${parentId}/createReply`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  if (!createReplyResp.ok) {
    const t = await createReplyResp.text();
    throw new Error(
      `Microsoft Graph API error (createReply): ${createReplyResp.status} ${createReplyResp.statusText} - ${t}`,
    );
  }
  const replyDraft = (await createReplyResp.json()) as { id: string };

  // 3) Patch the draft with our body and recipients
  const patchBody: Record<string, unknown> = {
    body,
  };
  if (to && to.length > 0) patchBody.toRecipients = mapRecipients(to);
  if (cc && cc.length > 0) patchBody.ccRecipients = mapRecipients(cc);
  if (bcc && bcc.length > 0) patchBody.bccRecipients = mapRecipients(bcc);

  const patchResp = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${replyDraft.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    },
  );
  if (!patchResp.ok) {
    const t = await patchResp.text();
    throw new Error(
      `Microsoft Graph API error (patch reply draft): ${patchResp.status} ${patchResp.statusText} - ${t}`,
    );
  }

  // 4) Send the reply
  const sendReplyResp = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${replyDraft.id}/send`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!sendReplyResp.ok) {
    const t = await sendReplyResp.text();
    throw new Error(
      `Microsoft Graph API error (send reply): ${sendReplyResp.status} ${sendReplyResp.statusText} - ${t}`,
    );
  }

  // Try to fetch the sent message by the draft id to get internetMessageId
  let graphMessageId = replyDraft.id;
  let internetMessageId: string | undefined;
  const getResp = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${replyDraft.id}?$select=id,internetMessageId`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (getResp.ok) {
    const j = (await getResp.json()) as {
      id: string;
      internetMessageId?: string;
    };
    graphMessageId = j.id;
    internetMessageId = j.internetMessageId;
  }

  // 7) Fallback: pick the latest sent item if we still don't have it
  if (!internetMessageId) {
    const sentItemsResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$orderby=sentDateTime desc&$top=1&$select=id,internetMessageId`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (sentItemsResponse.ok) {
      const sentItemsData = (await sentItemsResponse.json()) as {
        value: Array<{ id: string; internetMessageId?: string }>;
      };
      if (sentItemsData.value.length > 0) {
        const sentMessage = sentItemsData.value[0];
        internetMessageId = sentMessage.internetMessageId;
        graphMessageId = sentMessage.id;
      }
    }
  }

  if (!internetMessageId) {
    internetMessageId = `<${graphMessageId}@graph.microsoft.com>`;
  }

  return { graphMessageId, internetMessageId };
}

/**
 * Internal action to send an email via Microsoft Graph API
 * Returns the Internet Message ID for email threading
 */
export const sendEmail = internalAction({
  args: {
    accessToken: v.string(),
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.string(), // Internet Message ID
    graphMessageId: v.string(), // Microsoft Graph's internal message ID
  }),
  handler: async (_ctx, args) => {
    const contentType = args.html ? 'HTML' : 'Text';
    const content = args.html || args.text || '';

    // If inReplyTo is provided, always use the official reply flow; let errors throw
    if (args.inReplyTo) {
      const result = await trySendViaReplyFlow({
        accessToken: args.accessToken,
        inReplyTo: args.inReplyTo,
        body: { contentType, content },
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
      });
      debugLog('✓ Email reply sent successfully via Microsoft Graph API', {
        graphMessageId: result.graphMessageId,
        internetMessageId: result.internetMessageId,
        inReplyTo: args.inReplyTo,
      });
      return {
        success: true,
        messageId: result.internetMessageId,
        graphMessageId: result.graphMessageId,
      };
    }

    // Fallback / non-reply path: create a new message and send
    const message: {
      subject: string;
      body: { contentType: string; content: string };
      toRecipients: Array<{ emailAddress: { address: string } }>;
      ccRecipients?: Array<{ emailAddress: { address: string } }>;
      bccRecipients?: Array<{ emailAddress: { address: string } }>;
      replyTo?: Array<{ emailAddress: { address: string } }>;
      from?: { emailAddress: { address: string } };
      internetMessageHeaders?: Array<{ name: string; value: string }>;
    } = {
      subject: args.subject,
      body: { contentType, content },
      toRecipients: mapRecipients(args.to),
    };

    if (args.cc && args.cc.length > 0)
      message.ccRecipients = mapRecipients(args.cc);
    if (args.bcc && args.bcc.length > 0)
      message.bccRecipients = mapRecipients(args.bcc);
    if (args.replyTo)
      message.replyTo = [{ emailAddress: { address: args.replyTo } }];

    // Add From (if different from authenticated user) — requires permissions
    const fromMatch = args.from.match(/<?([^<>@\s]+@[^<>@\s]+)>?/);
    const fromEmail = fromMatch ? fromMatch[1] : args.from;
    message.from = { emailAddress: { address: fromEmail } };

    // Only allow custom 'x-' headers on Graph
    if (args.headers) {
      const customHeaders = Object.entries(args.headers).filter(([key]) =>
        key.toLowerCase().startsWith('x-'),
      );
      if (customHeaders.length > 0) {
        message.internetMessageHeaders = customHeaders.map(([name, value]) => ({
          name,
          value,
        }));
      }
    }

    // Create draft message
    const createResponse = await fetch(
      'https://graph.microsoft.com/v1.0/me/messages',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(
        `Microsoft Graph API error (create): ${createResponse.status} ${createResponse.statusText} - ${errorText}`,
      );
    }

    const draftMessage = (await createResponse.json()) as {
      id: string;
      internetMessageId?: string;
    };

    // Send the draft message
    const sendResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draftMessage.id}/send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${args.accessToken}` },
      },
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      throw new Error(
        `Microsoft Graph API error (send): ${sendResponse.status} ${sendResponse.statusText} - ${errorText}`,
      );
    }

    // Wait briefly, then query Sent Items for the message and its Internet Message ID
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const sentItemsResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$orderby=sentDateTime desc&$top=1&$select=id,internetMessageId`,
      { headers: { Authorization: `Bearer ${args.accessToken}` } },
    );

    let internetMessageId = draftMessage.internetMessageId;
    let graphMessageId = draftMessage.id;

    if (sentItemsResponse.ok) {
      const sentItemsData = (await sentItemsResponse.json()) as {
        value: Array<{ id: string; internetMessageId?: string }>;
      };
      if (sentItemsData.value.length > 0) {
        const sentMessage = sentItemsData.value[0];
        internetMessageId = sentMessage.internetMessageId || internetMessageId;
        graphMessageId = sentMessage.id;
      }
    }

    if (!internetMessageId) {
      internetMessageId = `<${graphMessageId}@graph.microsoft.com>`;
    }

    debugLog('✓ Email sent successfully via Microsoft Graph API', {
      graphMessageId,
      internetMessageId,
      from: args.from,
      to: args.to,
      subject: args.subject,
    });

    return {
      success: true,
      messageId: internetMessageId,
      graphMessageId,
    };
  },
});
