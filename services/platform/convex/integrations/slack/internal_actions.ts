import type { StreamId } from '@convex-dev/persistent-text-streaming';
import { v } from 'convex/values';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { internalAction } from '../../_generated/server';
import { buildExternalOwnerId } from '../../identities/external_identities';
import { persistentStreaming } from '../../streaming/helpers';

const MAX_POLL_MS = 540_000; // aligns with the generation hard limit (9 min)
const POLL_INTERVAL_MS = 100;
// Check thread generationStatus every Nth poll (~1s) to catch a generation that
// ended without terminalizing the stream (e.g. budget short-circuit).
const LIVENESS_POLL_EVERY = 10;
const IDENTITY_REFRESH_MS = 24 * 60 * 60 * 1000;
const SLACK_RATE_LIMIT_RETRY_MS = 1_500;

const FALLBACK_REPLY =
  'Sorry — I hit an error generating a response. Please try again.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip Slack mention tokens like `<@U123>` and trim. */
function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

/**
 * Best-effort fetch of a Slack user's display name via the connector `get_user`
 * op. Returns undefined (logged, never thrown) on failure — a name miss must
 * not block the reply.
 */
async function fetchSlackDisplayName(
  ctx: ActionCtx,
  organizationId: string,
  slackUserId: string,
): Promise<string | undefined> {
  try {
    const res = await ctx.runAction(
      internal.agent_tools.integrations.internal_actions.executeIntegration,
      {
        organizationId,
        integrationName: 'slack',
        operation: 'get_user',
        params: { user: slackUserId },
        skipApprovalCheck: true,
      },
    );
    const inner = isRecord(res) ? res.result : undefined;
    const user = isRecord(inner) ? inner.data : undefined;
    if (!isRecord(user)) return undefined;
    const profile = isRecord(user.profile) ? user.profile : undefined;
    return (
      (profile && getString(profile, 'display_name')) ||
      getString(user, 'real_name') ||
      getString(user, 'name') ||
      undefined
    );
  } catch (err) {
    console.warn(
      `[slack:process] get_user failed for ${slackUserId}:`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

async function postSlackReply(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    channel: string;
    threadTs: string;
    text: string;
  },
): Promise<void> {
  const send = () =>
    ctx.runAction(
      internal.agent_tools.integrations.internal_actions.executeIntegration,
      {
        organizationId: args.organizationId,
        integrationName: 'slack',
        operation: 'send_message',
        params: {
          channel: args.channel,
          text: args.text,
          thread_ts: args.threadTs,
        },
        skipApprovalCheck: true,
      },
    );

  try {
    await send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The connector throws a plain "Rate limited by Slack" error on 429 and
    // does not surface Retry-After, so back off a fixed interval and retry once.
    if (/rate.?limit|\b429\b/i.test(message)) {
      console.warn('[slack:process] send_message rate-limited; retrying once');
      await sleep(SLACK_RATE_LIMIT_RETRY_MS);
      try {
        await send();
        return;
      } catch (retryErr) {
        console.error(
          '[slack:process] send_message failed after 429 retry:',
          retryErr instanceof Error ? retryErr.message : retryErr,
        );
        return;
      }
    }
    console.error('[slack:process] send_message failed:', message);
  }
}

/**
 * Process one inbound Slack event end-to-end: dedup → route to org → run the
 * org's agent on the mapped Tale thread → post the reply back into the Slack
 * thread. Scheduled (fire-and-forget) from the events httpAction after it ACKs
 * Slack within 3s. Never throws to the scheduler — failures are logged and,
 * where a user is waiting, surfaced as a friendly reply.
 */
export const processSlackEvent = internalAction({
  args: {
    eventId: v.string(),
    teamId: v.string(),
    channel: v.string(),
    threadTs: v.optional(v.string()),
    messageTs: v.string(),
    text: v.string(),
    slackUserId: v.string(),
    eventType: v.union(v.literal('app_mention'), v.literal('message_im')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // 1. Dedup first — drop retries/duplicates before any work.
    const claim = await ctx.runMutation(
      internal.integrations.slack.internal_mutations.claimSlackEvent,
      { eventId: args.eventId },
    );
    if (!claim.claimed) {
      return null;
    }

    const conversationTs = args.threadTs ?? args.messageTs;
    // The dedup row is already committed and this action is at-most-once (Convex
    // does not retry it). So everything below runs under a guard: an unexpected
    // throw is logged and — once we know where to reply — surfaced as a friendly
    // fallback, never a silently dropped message.
    let organizationId: string | undefined;
    try {
      // 2. Route to the installing org.
      const route = await ctx.runQuery(
        internal.integrations.slack_installations.resolveOrgBySlackTeamId,
        { teamId: args.teamId },
      );
      if (!route) {
        console.warn(
          `[slack:process] no installation for team ${args.teamId} (event ${args.eventId})`,
        );
        return null;
      }
      organizationId = route.organizationId;

      // 3. Loop guard — never answer the bot's own messages.
      if (route.botUserId && args.slackUserId === route.botUserId) {
        return null;
      }

      // 4. Which agent answers Slack for this org?
      const agentSlug = await ctx.runQuery(
        internal.integrations.slack_config_queries.getSlackAgentSlug,
        { organizationId },
      );
      if (!agentSlug) {
        console.warn(
          `[slack:process] org ${organizationId} has no slackAgentSlug configured; dropping event ${args.eventId}`,
        );
        return null;
      }

      // 5. Clean the message (drop the bot mention token).
      const cleanedText = stripMentions(args.text);
      if (!cleanedText) {
        return null;
      }

      // 6. Resolve + record the Slack author identity (lazy refresh). The owner
      //    id is org-scoped, so a shared Slack user maps to a per-org row.
      const ownerId = buildExternalOwnerId(
        'slack',
        args.slackUserId,
        organizationId,
      );
      const existingIdentity = await ctx.runQuery(
        internal.identities.external_identities.getByOwnerId,
        { ownerId },
      );
      // Refresh when we have never resolved a name yet, or the name is stale.
      // (A still-missing name keeps retrying every message until we get one,
      // since a failed fetch never bumps the freshness window.)
      const stale =
        !existingIdentity ||
        !existingIdentity.displayName ||
        existingIdentity.updatedAt < Date.now() - IDENTITY_REFRESH_MS;
      let displayName = existingIdentity?.displayName ?? undefined;
      if (stale) {
        const fetched = await fetchSlackDisplayName(
          ctx,
          organizationId,
          args.slackUserId,
        );
        if (fetched) displayName = fetched;
        // Pass only the freshly fetched value; upsert preserves the existing
        // name and leaves `updatedAt` untouched when the fetch came back empty.
        await ctx.runMutation(
          internal.identities.external_identities.upsertExternalIdentity,
          {
            source: 'slack',
            organizationId,
            externalUserId: args.slackUserId,
            displayName: fetched,
          },
        );
      }

      // 7. Map to a stable Tale thread (a Slack thread === one Tale thread).
      const { threadId } = await ctx.runMutation(
        internal.integrations.slack.internal_mutations.getOrCreateSlackThread,
        {
          organizationId,
          channel: args.channel,
          conversationTs,
          slackUserId: args.slackUserId,
          slackUserName: displayName,
        },
      );

      // 8. Resolve the agent config + start generation.
      let replyText = FALLBACK_REPLY;
      try {
        const agentConfig = await ctx.runAction(
          internal.agents.file_actions.resolveAgentConfig,
          { agentSlug, organizationId },
        );
        const { streamId } = await ctx.runMutation(
          internal.integrations.slack.internal_mutations.startSlackChat,
          {
            organizationId,
            agentSlug,
            threadId,
            message: cleanedText,
            agentConfig,
          },
        );

        // 9. Poll the stream to completion.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamId is a branded string from the persistent-streaming SDK; runMutation returns plain string
        const typedStreamId = streamId as StreamId;
        const maxPolls = Math.ceil(MAX_POLL_MS / POLL_INTERVAL_MS);
        for (let i = 0; i < maxPolls; i++) {
          const body = await persistentStreaming.getStreamBody(
            ctx,
            typedStreamId,
          );
          if (body.status === 'done') {
            replyText = body.text || FALLBACK_REPLY;
            break;
          }
          if (body.status === 'error' || body.status === 'timeout') {
            break; // keep FALLBACK_REPLY; never leak raw error text to Slack
          }
          // Liveness: a short-circuited generation (e.g. budget block) saves a
          // message and flips generationStatus off 'generating' but never writes
          // the stream, which would otherwise leave us polling the full 9 min.
          // Detect it (cheaply, ~1/s) and bail to the fallback instead.
          if (i % LIVENESS_POLL_EVERY === 0) {
            const meta = await ctx.runQuery(
              internal.threads.internal_queries.getThreadMetadata,
              { threadId, callerOrgId: organizationId },
            );
            if (meta && meta.generationStatus !== 'generating') break;
          }
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.error(
          `[slack:process] generation failed (event ${args.eventId}):`,
          err instanceof Error ? err.message : err,
        );
      }

      // 10. Post the reply back into the Slack thread. postSlackReply guards its
      //     own errors, so it never throws into the outer catch.
      await postSlackReply(ctx, {
        organizationId,
        channel: args.channel,
        threadTs: conversationTs,
        text: replyText,
      });
    } catch (err) {
      console.error(
        `[slack:process] unhandled failure (event ${args.eventId}):`,
        err instanceof Error ? err.message : err,
      );
      // Best-effort friendly reply so a waiting user isn't left hanging when a
      // pre-generation step threw after we already claimed the event.
      if (organizationId) {
        await postSlackReply(ctx, {
          organizationId,
          channel: args.channel,
          threadTs: conversationTs,
          text: FALLBACK_REPLY,
        });
      }
    }

    return null;
  },
});
