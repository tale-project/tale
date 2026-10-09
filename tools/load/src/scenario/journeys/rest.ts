/**
 * The API-client persona: an integration on the REST door. It creates a
 * personal API key once, through the same Better Auth door the settings
 * page uses (cookie + Origin), then calls `/api/v1` with `Authorization:
 * Bearer` and `X-Organization-Slug` only — no cookie.
 *
 * Creating a key takes an owner, admin or developer seat. A user without
 * one is an integration an admin set up for them: the organization's owner
 * (whose seeded session the harness can adopt) creates the key, and the
 * integration acts as the owner — what a real admin handing a key to a
 * colleague's script looks like. Without minted sessions there is no owner
 * to borrow and the user falls back to browsing.
 */

import { createApiKey } from '../../api/auth.ts';
import { ApiClient, type ApiObserver } from '../../api/client.ts';
import {
  type RestModel,
  restArchiveTask,
  restCommentTask,
  restCreateThread,
  restGetTask,
  restHeaders,
  restListMessages,
  restListTaskComments,
  restListThreads,
  restModels,
  restPollGeneration,
  restSearchKnowledge,
  restSendMessage,
  restUpsertTask,
} from '../../api/rest.ts';
import { HttpClient, UserSession } from '../../client/index.ts';
import { chatPrompt, threadTitle } from '../../data/chat.ts';
import { knowledgeQuery } from '../../data/documents.ts';
import { chance, pick } from '../../data/random.ts';
import { searchTerm, taskComment, taskDraft } from '../../data/work.ts';
import { sessionTokenFor, userEmail } from '../../plan.ts';
import { sleep } from '../think.ts';
import { type VirtualUser, remember } from '../user.ts';
import type { Journey } from './journey.ts';

interface RestState {
  keyId: string;
  /** The session that created the key, and so may revoke it. */
  holder: UserSession;
  client: ApiClient;
  projectId: string | null;
  models: RestModel[];
  model: RestModel | null;
  threads: string[];
  tasks: string[];
  taskSerial: number;
  /** The latest external id's task was archived: re-sending it would
   * reconcile an archived task, which refuses comments. */
  latestArchived: boolean;
  /**
   * Prefix of this integration's external ids. It carries the moment the
   * integration started, not just the user: the same person runs again in
   * the next run (and after a restart within one), and reusing yesterday's
   * ids would reconcile tasks that run archived.
   */
  externalPrefix: string;
  rejected: boolean;
}

const states = new WeakMap<VirtualUser, RestState>();
/** Users who could not get a key: they browse instead. */
const keyless = new WeakSet<VirtualUser>();

/** The session that may create a key for this user, if any. */
function keyHolder(
  vu: VirtualUser,
): { session: UserSession; borrowed: boolean } | null {
  if (vu.canCreateApiKeys) return { session: vu.session, borrowed: false };
  const secret = vu.ctx.authSecret;
  const org = vu.seat?.org;
  if (
    !vu.ctx.plan.users.sessionsMinted ||
    secret === null ||
    org === undefined
  ) {
    return null;
  }
  const owner = new UserSession({
    baseUrl: vu.ctx.baseUrl,
    agent: vu.ctx.agent,
    metrics: vu.metrics,
    email: userEmail(vu.ctx.plan, org.ownerIndex),
    password: vu.ctx.plan.users.password,
    timeoutMs: vu.options.requestTimeoutMs,
    ...(vu.ctx.forwardedFor === null
      ? {}
      : { forwardedFor: vu.ctx.forwardedFor }),
  });
  owner.adoptSessionToken(
    sessionTokenFor(secret, vu.ctx.plan.runId, org.ownerIndex),
    secret,
  );
  return { session: owner, borrowed: true };
}

async function restState(vu: VirtualUser): Promise<RestState | null> {
  const existing = states.get(vu);
  if (existing !== undefined && !existing.rejected) return existing;
  if (keyless.has(vu) || vu.seat === null) return null;
  const holder = keyHolder(vu);
  if (holder === null) {
    keyless.add(vu);
    vu.metrics.counter('rest.no_key_holder');
    return null;
  }
  const created = await createApiKey(
    holder.borrowed
      ? new ApiClient({ requester: holder.session, signal: vu.signal })
      : vu.api,
    `load ${vu.ctx.plan.runId} integration u${vu.index}`,
  );
  if (created.body === undefined) {
    if (created.status === 403) {
      keyless.add(vu);
      vu.metrics.counter('rest.key_forbidden');
    }
    return null;
  }
  vu.metrics.counter(
    holder.borrowed ? 'apikeys.provisioned_by_owner' : 'apikeys.created',
  );
  const state: RestState = {
    keyId: created.body.id,
    holder: holder.session,
    client: vu.api,
    projectId: vu.seat.org.projectId,
    models: [],
    model: null,
    threads: [],
    tasks: [],
    taskSerial: 0,
    latestArchived: false,
    externalPrefix: `${vu.ctx.plan.runId}-u${vu.index}-${Date.now().toString(36)}`,
    rejected: false,
  };
  // A rejected key is dropped and re-created; everything else (429, 5xx)
  // backs the user off like any other request.
  const observer: ApiObserver = {
    onResponse: (name, response) => {
      if (response.status === 401) {
        state.rejected = true;
        vu.metrics.counter('rest.key_rejected');
        return;
      }
      vu.onResponse(name, response);
    },
  };
  state.client = new ApiClient({
    requester: new HttpClient({
      baseUrl: vu.ctx.baseUrl,
      agent: vu.ctx.agent,
      metrics: vu.metrics,
      timeoutMs: vu.options.requestTimeoutMs,
      defaultHeaders: restHeaders(created.body.key, vu.seat.org.slug),
      ...(vu.ctx.forwardedFor === null
        ? {}
        : { forwardedFor: vu.ctx.forwardedFor }),
    }),
    signal: vu.signal,
    observer,
  });
  states.set(vu, state);
  const models = await restModels(state.client);
  state.models = models.body ?? [];
  const org = vu.seat.org;
  state.model =
    state.models.find((model) => model.id === org.modelId) ??
    state.models[0] ??
    null;
  return state;
}

/**
 * Revoke this user's integration key, best effort, when the user stops.
 * Runs after the user's signal aborted, so the revoke goes through a client
 * without it, under a short deadline of its own.
 */
export async function releaseRestKey(vu: VirtualUser): Promise<void> {
  const state = states.get(vu);
  if (state === undefined) return;
  states.delete(vu);
  await new ApiClient({ requester: state.holder }).call({
    method: 'POST',
    path: '/api/auth/api-key/delete',
    json: { keyId: state.keyId },
    name: 'POST /api/auth/api-key/delete',
    refusals: [401, 404],
    timeoutMs: 3_000,
  });
}

/** The integration's own fallback when it has no key: an app user's look. */
async function withState(
  vu: VirtualUser,
  run: (state: RestState) => Promise<void>,
): Promise<void> {
  const state = await restState(vu);
  if (state === null) {
    vu.metrics.counter('rest.fallback_to_browser');
    await vu.homeReads();
    return;
  }
  await run(state);
}

/** One asynchronous REST turn: send, poll the generation until idle. */
export const restChat: Journey = {
  name: 'rest.chat',
  eligible: (vu) => vu.options.chat,
  run: (vu) =>
    withState(vu, async (state) => {
      const model = state.model;
      if (model === null) {
        vu.metrics.counter('rest.no_model');
        return;
      }
      let threadId = chance(vu.random, 0.6)
        ? pick(vu.random, state.threads)
        : undefined;
      if (threadId === undefined) {
        const created = await restCreateThread(
          state.client,
          threadTitle(vu.data, vu.random),
        );
        threadId = created.body;
        if (threadId === undefined) return;
        remember(state.threads, threadId);
      }
      const prompt = chatPrompt(vu.data, vu.random);
      const started = performance.now();
      const sent = await restSendMessage(state.client, threadId, {
        content: prompt.text,
        model: model.id,
        providerSlug: model.providerSlug,
      });
      if (sent.status === 409) {
        vu.metrics.counter('rest.chat_busy');
        return;
      }
      if (sent.body === undefined) return;
      vu.metrics.counter('rest.turns');
      let since = 0;
      let firstText: number | null = null;
      const deadline = started + vu.options.turnTimeoutMs;
      for (;;) {
        // An integration polls about once a second.
        await sleep(700 + vu.random() * 600, vu.signal);
        await vu.guard();
        const poll = await restPollGeneration(state.client, threadId, since);
        if (poll.body === undefined) return;
        if (poll.body.textLength > since) {
          since = poll.body.textLength;
          firstText ??= performance.now();
        }
        if (poll.body.status === 'idle') {
          vu.metrics.timing('rest.turn', performance.now() - started);
          if (firstText !== null)
            vu.metrics.timing('rest.first_text', firstText - started);
          if (
            poll.body.lastStatus !== undefined &&
            poll.body.lastStatus !== 'complete'
          ) {
            vu.metrics.counter(`rest.turn_${poll.body.lastStatus}`);
          }
          break;
        }
        if (performance.now() > deadline) {
          vu.metrics.error(
            'rest.turn',
            'turn_timeout',
            `thread ${threadId} still ${poll.body.status}`,
          );
          return;
        }
      }
      await restListMessages(state.client, threadId);
    }),
};

/** Mirror an external issue into a task, then work it over REST. */
export const restTasks: Journey = {
  name: 'rest.tasks',
  run: (vu) =>
    withState(vu, async (state) => {
      const projectId = state.projectId;
      if (projectId === null) return;
      const draft = taskDraft(vu.data, vu.random);
      // Re-sending a known external id is the intake's update path.
      const reuse =
        state.taskSerial > 0 && !state.latestArchived && chance(vu.random, 0.2);
      if (!reuse) {
        state.taskSerial += 1;
        state.latestArchived = false;
      }
      const upserted = await restUpsertTask(state.client, projectId, {
        externalSystem: 'tale-load',
        externalId: `${state.externalPrefix}-${state.taskSerial}`,
        title: draft.title,
        ...(draft.description === undefined
          ? {}
          : { description: draft.description }),
        ...(draft.labels.length > 0 ? { labels: draft.labels } : {}),
      });
      const task = upserted.body;
      if (task === undefined) return;
      remember(state.tasks, task.id);
      await restGetTask(state.client, projectId, task.id);
      if (chance(vu.random, 0.6)) {
        await restCommentTask(
          state.client,
          projectId,
          task.id,
          taskComment(vu.data, vu.random),
        );
        await restListTaskComments(state.client, projectId, task.id);
      }
      if (chance(vu.random, 0.15)) {
        const archived = await restArchiveTask(
          state.client,
          projectId,
          task.id,
          true,
        );
        if (archived.ok) state.latestArchived = true;
      }
    }),
};

/** Retrieval from a script: the knowledge search door. */
export const restKnowledge: Journey = {
  name: 'rest.knowledge-search',
  eligible: (vu) => vu.options.knowledgeSearch,
  run: (vu) =>
    withState(vu, async (state) => {
      const query = knowledgeQuery(
        vu.random,
        vu.memory().keywords,
        searchTerm(vu.data, vu.random),
      );
      const result = await restSearchKnowledge(state.client, query);
      if (result.status === 409) vu.metrics.counter('knowledge.unavailable');
    }),
};

/** List the integration's threads and read one back. */
export const restThreads: Journey = {
  name: 'rest.threads',
  run: (vu) =>
    withState(vu, async (state) => {
      const listed = await restListThreads(state.client);
      const threadId = pick(vu.random, listed.body ?? []);
      if (threadId !== undefined)
        await restListMessages(state.client, threadId);
    }),
};
