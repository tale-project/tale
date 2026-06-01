import type { StreamId } from '@convex-dev/persistent-text-streaming';
import { v } from 'convex/values';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { internalAction } from '../../_generated/server';
import { buildExternalOwnerId } from '../../identities/external_identities';
import { persistentStreaming } from '../../streaming/helpers';

// Slack reply-poll budget (9 min). The generation deadline is capped to this
// window (passed as maxDeadlineMs into startSlackChat), so the poll only
// exhausts on a genuine timeout — never on a still-running generation.
const MAX_POLL_MS = 540_000;
const POLL_INTERVAL_MS = 100;
// Check thread generationStatus every Nth poll (~1s) to catch a generation that
// ended without terminalizing the stream (e.g. budget short-circuit).
const LIVENESS_POLL_EVERY = 10;
// When liveness shows generation is no longer active, keep polling the stream
// this many times (~2s) for a terminal status before falling back — closes the
// race where 'idle' is observed a beat before the stream commits 'done'.
const LIVENESS_GRACE_POLLS = 20;
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

// Stable per-DM Tale-thread key. A DM is one continuous conversation per
// channel, and the channel id is already part of the slackThreads
// `by_conversation` index, so a constant in the conversationTs column is unique
// per DM channel. (Real Slack ts values are numeric strings, so 'im' can never
// collide with one.)
const DM_THREAD_KEY = 'im';

/**
 * Derive the stable Tale-thread key and the reply `thread_ts` for an inbound
 * event. A channel @mention is threaded under its triggering/root message, so
 * the key IS that thread_ts and the reply nests there. A DM (`message_im`) is
 * NOT auto-threaded — a top-level DM carries no `thread_ts`, so its per-message
 * `messageTs` must NOT be the key (that would mint a fresh Tale thread every
 * message and lose all conversation memory). Key DMs on `DM_THREAD_KEY` and
 * reply at the top level, preserving an explicit in-DM thread reply if present.
 */
function deriveThreadKeys(
  eventType: 'app_mention' | 'message_im',
  threadTs: string | undefined,
  messageTs: string,
): { threadKey: string; replyThreadTs?: string } {
  if (eventType === 'message_im') {
    return { threadKey: DM_THREAD_KEY, replyThreadTs: threadTs };
  }
  const root = threadTs ?? messageTs;
  return { threadKey: root, replyThreadTs: root };
}

/**
 * After the liveness check observes generation is no longer active, poll the
 * persistent stream a bounded grace window for a terminal status. Returns the
 * final text once the stream is `done`, or undefined if it errored/timed out or
 * never finalized within the window (the caller keeps the fallback reply).
 *
 * This closes a race: on the success path `clearGenerationStatus` (status
 * `idle`) and `completeStream` (stream `done`) commit independently, so `idle`
 * can be seen a beat before `done`. A genuinely short-circuited generation
 * (e.g. budget block) never finalizes the stream, so the window expires and we
 * fall back. `getBody`/`sleepFn` are injected so the logic is unit-testable.
 */
async function awaitStreamSettle(
  getBody: () => Promise<{ status: string; text: string }>,
  sleepFn: (ms: number) => Promise<void>,
  opts: { gracePolls: number; intervalMs: number },
): Promise<string | undefined> {
  for (let g = 0; g < opts.gracePolls; g++) {
    const body = await getBody();
    if (body.status === 'done') return body.text || undefined;
    if (body.status === 'error' || body.status === 'timeout') return undefined;
    await sleepFn(opts.intervalMs);
  }
  return undefined;
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
    // Omitted for a top-level DM reply; present to nest under a channel thread.
    threadTs?: string;
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
          ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
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

    const { threadKey, replyThreadTs } = deriveThreadKeys(
      args.eventType,
      args.threadTs,
      args.messageTs,
    );
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
          conversationTs: threadKey,
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
            // Cap the generation deadline to our poll window so the poll never
            // exhausts on a still-running generation (which would post the
            // fallback and drop the real, later-committed answer).
            maxDeadlineMs: Date.now() + MAX_POLL_MS,
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
            if (meta && meta.generationStatus !== 'generating') {
              // Don't fall back immediately: a just-finished generation may have
              // flipped status to 'idle' a beat before the stream commits
              // 'done'. Grace-poll the stream for a terminal state first.
              const settled = await awaitStreamSettle(
                () => persistentStreaming.getStreamBody(ctx, typedStreamId),
                sleep,
                {
                  gracePolls: LIVENESS_GRACE_POLLS,
                  intervalMs: POLL_INTERVAL_MS,
                },
              );
              if (settled !== undefined) replyText = settled;
              break;
            }
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
        threadTs: replyThreadTs,
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
          threadTs: replyThreadTs,
          text: FALLBACK_REPLY,
        });
      }
    }

    return null;
  },
});

// Exported for unit tests.
export const __test = { awaitStreamSettle, stripMentions, deriveThreadKeys };
