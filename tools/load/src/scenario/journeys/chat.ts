/**
 * Chat journeys: a new conversation of several turns, picking an old one
 * back up, and the housekeeping people do on their thread list.
 *
 * A turn is measured the way the person experiences it, from the tab:
 * `chat.ttft` is send → the first `progress` event on the thread's stream
 * that carries text, `chat.turn` is send → `settled`. Turns carrying a
 * mock-provider fault directive record under `chat.ttft.faulted` and
 * `chat.turn.faulted` instead, so a deliberately slow or failing provider
 * never skews the service-level numbers.
 */

import {
  type ReasoningEffort,
  cancelTurn,
  createThread,
  listMessages,
  listThreads,
  markThreadRead,
  pinThread,
  renameThread,
  reportPerceivedWait,
  sendMessage,
  setThreadReasoningEffort,
  trashThread,
} from '../../api/chat.ts';
import { setChatModelPreference } from '../../api/workspace.ts';
import { chatPrompt, threadTitle } from '../../data/chat.ts';
import { chance, intBetween, pick } from '../../data/random.ts';
import { readingMs, sleep, typingMs } from '../think.ts';
import { TurnWatch } from '../turn.ts';
import { type VirtualUser, forget, remember } from '../user.ts';
import type { Journey } from './journey.ts';

/** Mock-provider directives a fault-injected message carries. */
export const FAULT_DIRECTIVES = [
  '[[mock:429]]',
  '[[mock:500]]',
  '[[mock:midstream-error]]',
  '[[mock:ttft=4000]]',
] as const;

export type TurnOutcome =
  | 'completed'
  | 'refused'
  | 'cancelled'
  | 'busy'
  | 'failed'
  | 'skipped';

export interface TurnResult {
  outcome: TurnOutcome;
  /** The reply as streamed (empty without a thread stream). */
  reply: string;
}

const PROVIDER_REFUSAL = /model provider|provider answered|rate limit/i;

/**
 * Send one message on `threadId` and follow the turn to its end. Never
 * throws for a failed turn; returns how it went.
 */
export async function runTurn(
  vu: VirtualUser,
  threadId: string,
  text: string,
  options: { cancel?: boolean; reasoningEffort?: ReasoningEffort } = {},
): Promise<TurnResult> {
  const model = vu.model;
  if (model === null || !vu.options.chat) {
    vu.metrics.counter(model === null ? 'chat.no_model' : 'chat.disabled');
    return { outcome: 'skipped', reply: '' };
  }
  const orgId = vu.orgId;
  vu.openThread(threadId);
  const streamed =
    vu.options.threadStreams && (await vu.waitThreadReady(5_000));
  if (vu.options.threadStreams && !streamed) {
    vu.metrics.counter('chat.stream_not_ready');
  }
  const fault =
    vu.options.providerFaultRate > 0 &&
    chance(vu.random, vu.options.providerFaultRate)
      ? (pick(vu.random, FAULT_DIRECTIVES) ?? null)
      : null;
  const watch = new TurnWatch();
  if (streamed) vu.listenThread((event) => watch.onEvent(event));
  const sending = sendMessage(
    vu.heldApi,
    orgId,
    threadId,
    {
      text: fault === null ? text : `${text}\n\n${fault}`,
      modelId: model.id,
      providerSlug: model.providerSlug,
      locale: vu.data.locale,
      ...(options.reasoningEffort === undefined || !model.reasoning
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
    },
    vu.options.turnTimeoutMs,
  );
  // The SPA refetches the transcript when the turn opens (the user row
  // landed); a person may also hit Stop once the answer starts.
  const sideEffects = (async (): Promise<void> => {
    if (!streamed) return;
    if (!(await watch.firstText(vu.options.turnTimeoutMs, vu.signal))) return;
    await listMessages(vu.api, orgId, threadId);
    if (options.cancel === true) {
      await sleep(400 + vu.random() * 1_600, vu.signal);
      if (watch.timeline.settledAt === null && !vu.signal.aborted) {
        const cancelled = await cancelTurn(vu.api, orgId, threadId);
        vu.metrics.counter(
          cancelled.body === true
            ? 'chat.cancel_requested'
            : 'chat.cancel_too_late',
        );
      }
    }
  })();
  const result = await sending;
  const postEndedAt = performance.now();
  if (result.aborted) {
    vu.listenThread(null);
    return { outcome: 'skipped', reply: '' };
  }
  vu.metrics.counter('chat.turns');
  if (fault !== null) vu.metrics.counter('chat.faults_injected');
  const turn = result.body;
  let outcome: TurnOutcome = 'failed';
  if (turn?.status === 'completed') {
    outcome = 'completed';
  } else if (turn?.status === 'refused') {
    if (result.status === 409) {
      outcome = 'busy';
      vu.metrics.counter('chat.busy');
    } else {
      outcome = 'refused';
      vu.metrics.counter(
        result.status === 429
          ? 'chat.refused.budget'
          : result.status === 503
            ? 'chat.refused.draining'
            : fault !== null
              ? 'chat.refused.fault'
              : 'chat.refused.provider',
      );
      if (
        fault === null &&
        result.status === 200 &&
        !PROVIDER_REFUSAL.test(turn.reason ?? '')
      ) {
        vu.metrics.error(
          'chat.turn',
          'unexpected_refusal',
          `${turn.code ?? ''} ${turn.reason ?? '(no reason)'}`,
        );
      }
    }
  }
  if (streamed && (outcome === 'completed' || outcome === 'refused')) {
    // `settled` lands within a poll tick of the POST's answer; a turn the
    // lane saw run gets longer, a refusal before any token a short grace.
    const grace =
      outcome === 'completed' || watch.timeline.progressEvents > 0
        ? 15_000
        : 3_000;
    const settled = await watch.settled(grace, vu.signal);
    if (!settled && outcome === 'completed' && !vu.signal.aborted) {
      vu.metrics.error(
        'sse.thread',
        'settle_missing',
        `no settled event ${grace} ms after the turn on ${threadId} completed`,
      );
    }
  }
  await sideEffects;
  vu.listenThread(null);
  const timeline = watch.timeline;
  if (timeline.settledStatus === 'cancelled') {
    outcome = 'cancelled';
    vu.metrics.counter('chat.cancelled');
  } else if (outcome === 'completed') {
    vu.metrics.counter('chat.completed');
  }
  if (
    outcome === 'completed' ||
    outcome === 'refused' ||
    outcome === 'cancelled'
  ) {
    const suffix = fault === null ? '' : '.faulted';
    const endedAt = timeline.settledAt ?? postEndedAt;
    vu.metrics.timing(`chat.turn${suffix}`, endedAt - timeline.startedAt);
    if (timeline.firstTextAt !== null) {
      const ttft = timeline.firstTextAt - timeline.startedAt;
      vu.metrics.timing(`chat.ttft${suffix}`, ttft);
      if (timeline.messageId !== null) {
        await reportPerceivedWait(vu.api, orgId, timeline.messageId, ttft);
      }
    }
    // The settled turn swaps the transcript to its durable rows.
    await listMessages(vu.api, orgId, threadId);
  }
  return { outcome, reply: timeline.lastText };
}

/** A reasoning depth people pick now and then. */
function maybeEffort(vu: VirtualUser): ReasoningEffort | undefined {
  return chance(vu.random, 0.2)
    ? pick(vu.random, ['low', 'medium', 'high'] as const)
    : undefined;
}

/** A conversation of `turns` messages on `threadId`. */
async function converse(
  vu: VirtualUser,
  threadId: string,
  turns: number,
  firstReply?: string,
): Promise<void> {
  let reply = firstReply;
  for (let turn = 0; turn < turns; turn += 1) {
    const prompt = chatPrompt(vu.data, vu.random, reply);
    await vu.wait(
      typingMs(vu.random, prompt.text.length, vu.options.thinkTimeScale),
    );
    const result = await runTurn(vu, threadId, prompt.text, {
      cancel: chance(vu.random, 0.05),
      reasoningEffort: maybeEffort(vu),
    });
    await vu.guard();
    if (result.outcome === 'busy' || result.outcome === 'skipped') return;
    reply = result.reply === '' ? reply : result.reply;
    await vu.wait(
      readingMs(vu.random, result.reply.length, vu.options.thinkTimeScale),
    );
  }
}

/** New chat: create a thread, talk for a few turns, sometimes rename/pin. */
export const newConversation: Journey = {
  name: 'chat.new-conversation',
  eligible: (vu) => vu.options.chat && vu.model !== null,
  run: async (vu) => {
    const orgId = vu.orgId;
    vu.screen = 'chat';
    const effort = maybeEffort(vu);
    const created = await createThread(
      vu.api,
      orgId,
      effort === undefined ? {} : { reasoningEffort: effort },
    );
    const threadId = created.body;
    if (threadId === undefined) return;
    remember(vu.memory().threads, threadId);
    vu.openThread(threadId);
    await vu.pause('click');
    const turns =
      vu.persona === 'chatter'
        ? intBetween(vu.random, 2, 6)
        : intBetween(vu.random, 1, 2);
    await converse(vu, threadId, turns);
    if (chance(vu.random, 0.3)) {
      await renameThread(
        vu.api,
        orgId,
        threadId,
        threadTitle(vu.data, vu.random),
      );
    }
    if (chance(vu.random, 0.1)) {
      await pinThread(vu.api, orgId, threadId, true);
    }
    vu.closeThread();
  },
};

/** Open an older thread from the list, read it, add a turn or three. */
export const continueConversation: Journey = {
  name: 'chat.continue-conversation',
  eligible: (vu) => vu.options.chat && vu.model !== null,
  run: async (vu) => {
    const orgId = vu.orgId;
    vu.screen = 'chat';
    const listed = await listThreads(vu.api, orgId);
    const rows = listed.body ?? [];
    const memory = vu.memory();
    memory.threads = rows.slice(0, 40).map((row) => row.id);
    const target = pick(vu.random, rows.slice(0, 10));
    if (target === undefined) {
      await newConversation.run(vu);
      return;
    }
    vu.openThread(target.id);
    const transcript = await listMessages(vu.api, orgId, target.id);
    if (transcript.status === 404) {
      forget(memory.threads, target.id);
      return;
    }
    await markThreadRead(vu.api, orgId, target.id);
    const last = transcript.body?.findLast((row) => row.role === 'assistant');
    await vu.wait(
      readingMs(vu.random, last?.text.length ?? 400, vu.options.thinkTimeScale),
    );
    if (target.generating) {
      vu.closeThread();
      return;
    }
    await converse(vu, target.id, intBetween(vu.random, 1, 3), last?.text);
    vu.closeThread();
  },
};

/** Read a thread without writing to it (the browser's chat use). */
export const readConversation: Journey = {
  name: 'chat.read-conversation',
  run: async (vu) => {
    const orgId = vu.orgId;
    vu.screen = 'chat';
    const listed = await listThreads(vu.api, orgId);
    const target = pick(vu.random, (listed.body ?? []).slice(0, 10));
    if (target === undefined) return;
    vu.openThread(target.id);
    const transcript = await listMessages(vu.api, orgId, target.id);
    await markThreadRead(vu.api, orgId, target.id);
    const chars = (transcript.body ?? []).reduce(
      (sum, row) => sum + row.text.length,
      0,
    );
    await vu.wait(
      readingMs(vu.random, Math.min(chars, 6_000), vu.options.thinkTimeScale),
    );
    vu.closeThread();
  },
};

/** Tidy the thread list: pin/unpin, rename, trash an old one. */
export const tidyThreads: Journey = {
  name: 'chat.tidy-threads',
  run: async (vu) => {
    const orgId = vu.orgId;
    vu.screen = 'chat';
    const listed = await listThreads(vu.api, orgId);
    const rows = listed.body ?? [];
    if (rows.length === 0) return;
    await vu.pause('read');
    const pinned = rows.find((row) => row.pinned);
    const someone = pick(vu.random, rows);
    if (pinned !== undefined && chance(vu.random, 0.5)) {
      await pinThread(vu.api, orgId, pinned.id, false);
    } else if (someone !== undefined) {
      await pinThread(vu.api, orgId, someone.id, true);
    }
    await vu.pause('click');
    if (someone !== undefined && chance(vu.random, 0.5)) {
      await renameThread(
        vu.api,
        orgId,
        someone.id,
        threadTitle(vu.data, vu.random),
      );
      await vu.pause('click');
    }
    if (chance(vu.random, 0.25)) {
      await setThreadReasoningEffort(
        vu.api,
        orgId,
        someone?.id ?? rows[0]?.id ?? '',
        pick(vu.random, ['low', 'medium', 'high'] as const) ?? 'medium',
      );
    }
    // Trash the oldest idle thread once the list grows long.
    const oldest = rows.findLast((row) => !row.generating && !row.pinned);
    if (rows.length > 8 && oldest !== undefined) {
      const trashed = await trashThread(vu.api, orgId, oldest.id);
      if (trashed.body === true) forget(vu.memory().threads, oldest.id);
    }
  },
};

/** Change the default chat model in settings. */
export const chooseModel: Journey = {
  name: 'settings.chat-model',
  eligible: (vu) => vu.models.length > 0,
  run: async (vu) => {
    vu.screen = 'other';
    const model = pick(vu.random, vu.models);
    if (model === undefined) return;
    await vu.pause('click');
    const saved = await setChatModelPreference(
      vu.api,
      vu.orgId,
      model.id,
      model.providerSlug,
    );
    if (saved.ok) vu.model = model;
  },
};
