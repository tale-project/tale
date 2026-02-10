'use node';

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

/**
 * Internal action to send an email via Gmail API
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
    gmailMessageId: v.string(), // Gmail's internal message ID
  }),
  handler: async (_ctx, args) => {
    // Build RFC 2822 formatted email
    const emailLines: string[] = [];

    // Add headers
    emailLines.push(`From: ${args.from}`);
    emailLines.push(`To: ${args.to.join(', ')}`);
    if (args.cc && args.cc.length > 0) {
      emailLines.push(`Cc: ${args.cc.join(', ')}`);
    }
    if (args.bcc && args.bcc.length > 0) {
      emailLines.push(`Bcc: ${args.bcc.join(', ')}`);
    }
    emailLines.push(`Subject: ${args.subject}`);

    // Add threading headers
    if (args.replyTo) {
      emailLines.push(`Reply-To: ${args.replyTo}`);
    }
    if (args.inReplyTo) {
      emailLines.push(`In-Reply-To: ${args.inReplyTo}`);
    }
    if (args.references && args.references.length > 0) {
      emailLines.push(`References: ${args.references.join(' ')}`);
    }

    // Add custom headers
    if (args.headers) {
      for (const [key, value] of Object.entries(args.headers)) {
        emailLines.push(`${key}: ${value}`);
      }
    }

    // Add MIME headers
    emailLines.push('MIME-Version: 1.0');

    if (args.html && args.text) {
      // Multipart: both HTML and plain text
      const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(7)}`;
      emailLines.push(
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      );
      emailLines.push('');
      emailLines.push(`--${boundary}`);
      emailLines.push('Content-Type: text/plain; charset="UTF-8"');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(args.text);
      emailLines.push('');
      emailLines.push(`--${boundary}`);
      emailLines.push('Content-Type: text/html; charset="UTF-8"');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(args.html);
      emailLines.push('');
      emailLines.push(`--${boundary}--`);
    } else if (args.html) {
      // HTML only
      emailLines.push('Content-Type: text/html; charset="UTF-8"');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(args.html);
    } else if (args.text) {
      // Plain text only
      emailLines.push('Content-Type: text/plain; charset="UTF-8"');
      emailLines.push('Content-Transfer-Encoding: 7bit');
      emailLines.push('');
      emailLines.push(args.text);
    } else {
      throw new Error('Either html or text content is required');
    }

    // Join lines with CRLF
    const rawEmail = emailLines.join('\r\n');

    // Base64url encode (Gmail API requirement)
    const base64Email = Buffer.from(rawEmail)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send via Gmail API
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: base64Email,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gmail API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const result = (await response.json()) as {
      id: string;
      threadId: string;
      labelIds: string[];
    };

    // Get the full message details to retrieve the Internet Message ID
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${result.id}?format=metadata&metadataHeaders=Message-ID`,
      {
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
        },
      },
    );

    if (!messageResponse.ok) {
      const errorText = await messageResponse.text();
      throw new Error(
        `Gmail API error fetching message: ${messageResponse.status} ${messageResponse.statusText} - ${errorText}`,
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const messageDetails = (await messageResponse.json()) as {
      id: string;
      payload: {
        headers: Array<{ name: string; value: string }>;
      };
    };

    // Extract Internet Message ID from headers
    const messageIdHeader = messageDetails.payload.headers.find(
      (h) => h.name.toLowerCase() === 'message-id',
    );
    const internetMessageId =
      messageIdHeader?.value || `<${result.id}@gmail.googleapis.com>`;

    debugLog('✓ Email sent successfully via Gmail API', {
      gmailMessageId: result.id,
      internetMessageId,
      from: args.from,
      to: args.to,
      subject: args.subject,
    });

    return {
      success: true,
      messageId: internetMessageId,
      gmailMessageId: result.id,
    };
  },
});
