/**
 * The fuzzer persona: a user (or a broken client) sending malformed and
 * hostile input on purpose — oversized titles, empty bodies, wrong enums,
 * bidi and NUL characters, markup and SQL-looking strings, ids that name
 * nothing, JSON that is not JSON.
 *
 * Every probe expects a clean 4xx (or an inert 2xx: storing `<script>` as
 * text is fine). A 4xx is counted (`fuzz.rejected`), never an error. A 5xx
 * is a real finding: recorded as the error kind `server_error_on_bad_input`
 * under the probe's name, which carries a `FUZZ ` prefix so this traffic
 * stays apart from the honest users' routes in the report.
 */

import { createThread } from '../../api/chat.ts';
import type { ApiResult, CallOptions } from '../../api/client.ts';
import {
  hostileId,
  hostileString,
  malformedBody,
  oversized,
  wellFormed,
  wrongEnum,
} from '../../data/hostile.ts';
import { intBetween, pick } from '../../data/random.ts';
import type { VirtualUser } from '../user.ts';
import type { Journey } from './journey.ts';

const SUCCESS = [200, 201, 202, 204, 304];
/** The refusals a hostile request may meet. */
const FUZZ_REFUSALS = [400, 401, 403, 404, 405, 409, 413, 414, 415, 422, 429];
const SERVER_ERRORS = Array.from({ length: 100 }, (_, i) => 500 + i);
const FUZZ_EXPECT = [...SUCCESS, ...FUZZ_REFUSALS, ...SERVER_ERRORS];

export const SERVER_ERROR_ON_BAD_INPUT = 'server_error_on_bad_input';

const enc = encodeURIComponent;

const EXCERPT_CHARS = 120;

/** What a probe sent, short: the JSON body, the raw body or the query. */
function inputExcerpt(
  options: Pick<CallOptions, 'json' | 'body' | 'query'>,
): string {
  let text: string;
  if (options.json !== undefined) {
    text = JSON.stringify(options.json, (_key, value: unknown) =>
      typeof value === 'string' && value.length > 60
        ? `${value.slice(0, 24)}…(${value.length} chars)`
        : value,
    );
  } else if (options.body !== undefined) {
    text = JSON.stringify(
      typeof options.body === 'string' ? options.body : '(binary)',
    );
  } else {
    text = JSON.stringify(options.query ?? {});
  }
  return text.length > EXCERPT_CHARS
    ? `${text.slice(0, EXCERPT_CHARS - 1)}…`
    : text;
}

/** Send one hostile request and classify the answer. */
export async function probe(
  vu: VirtualUser,
  options: Omit<CallOptions, 'expect' | 'refusals'>,
): Promise<ApiResult<unknown>> {
  const name = `FUZZ ${options.name}`;
  const result = await vu.api.call<unknown>({
    ...options,
    name,
    expect: FUZZ_EXPECT,
    timeoutMs: options.timeoutMs ?? 15_000,
  });
  if (result.aborted || result.status === 0) return result;
  if (result.status >= 500) {
    vu.metrics.counter('fuzz.server_errors');
    // The input leads the sample: a finding is only actionable when it
    // says what provoked it. JSON escapes control characters, so a NUL or
    // a lone surrogate stays visible in the report.
    vu.metrics.error(
      name,
      SERVER_ERROR_ON_BAD_INPUT,
      `${options.method} ${options.path} input=${inputExcerpt(options)} -> ${result.status}: ${result.response?.text.slice(0, 120) ?? ''}`,
    );
  } else if (result.status >= 400) {
    vu.metrics.counter('fuzz.rejected');
  } else {
    vu.metrics.counter('fuzz.accepted');
  }
  return result;
}

type Probe = (vu: VirtualUser) => Promise<unknown>;

const PROBES: readonly Probe[] = [
  // Titles past the cap, and hostile ones within it.
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/chat/threads',
      query: { orgId: vu.orgId },
      json: { title: oversized(vu.random, intBetween(vu.random, 201, 20_000)) },
      name: 'POST /api/app/chat/threads',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/chat/threads',
      query: { orgId: vu.orgId },
      json: {
        title: hostileString(vu.random),
        reasoningEffort: wrongEnum(vu.random),
      },
      name: 'POST /api/app/chat/threads',
    }),
  async (vu) => {
    const created = await createThread(vu.api, vu.orgId, { title: 'fuzz' });
    if (created.body === undefined) return;
    await probe(vu, {
      method: 'POST',
      path: `/api/app/chat/threads/${enc(created.body)}/rename`,
      query: { orgId: vu.orgId },
      json: { title: hostileString(vu.random) },
      name: 'POST /api/app/chat/threads/:id/rename',
    });
    await probe(vu, {
      method: 'POST',
      path: `/api/app/chat/threads/${enc(created.body)}/messages`,
      query: { orgId: vu.orgId },
      json: { text: hostileString(vu.random), modelId: hostileId(vu.random) },
      name: 'POST /api/app/chat/threads/:id/messages',
    });
  },
  // Tasks: wrong enums, empty and hostile titles, malformed JSON.
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/tasks',
      query: { orgId: vu.orgId },
      json: {
        projectId: vu.seat?.org.projectId ?? hostileId(vu.random),
        title: 'Fuzz task',
        priority: wrongEnum(vu.random),
        status: wrongEnum(vu.random),
      },
      name: 'POST /api/app/tasks',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/tasks',
      query: { orgId: vu.orgId },
      json: {
        projectId: vu.seat?.org.projectId ?? hostileId(vu.random),
        title: pick(vu.random, ['', '   ', hostileString(vu.random)]) ?? '',
        dueDate: pick(vu.random, [-1, 9e15, 'tomorrow', 0]) ?? -1,
      },
      name: 'POST /api/app/tasks',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/tasks',
      query: { orgId: vu.orgId },
      body: malformedBody(vu.random),
      headers: { 'content-type': 'application/json' },
      name: 'POST /api/app/tasks',
    }),
  // Ids that name nothing, in paths and queries.
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: `/api/app/tasks/${enc(hostileId(vu.random))}`,
      query: { orgId: vu.orgId },
      name: 'GET /api/app/tasks/:taskId',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: `/api/app/tasks/${enc(hostileId(vu.random))}/move`,
      query: { orgId: vu.orgId },
      json: { status: wrongEnum(vu.random) },
      name: 'POST /api/app/tasks/:taskId/move',
    }),
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: `/api/app/chat/threads/${enc(hostileId(vu.random))}/messages`,
      query: { orgId: vu.orgId },
      name: 'GET /api/app/chat/threads/:id/messages',
    }),
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: '/api/app/members/me',
      query: { orgId: hostileId(vu.random) },
      name: 'GET /api/app/members/me',
    }),
  // Query parameters that are not what they claim.
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: '/api/app/contacts',
      query: {
        orgId: vu.orgId,
        limit: pick(vu.random, ['abc', '-5', '1e9', '0', '999999']) ?? 'abc',
        cursorUpdatedAt: pick(vu.random, ['NaN', '-1', "1' OR 1=1"]) ?? 'NaN',
        cursorId: hostileId(vu.random),
      },
      name: 'GET /api/app/contacts',
    }),
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: '/api/app/notifications',
      query: {
        orgId: vu.orgId,
        limit: pick(vu.random, ['-5', 'NaN', '1000']) ?? '-5',
        cursorCreatedAt: pick(vu.random, ['x', '-1', '1e400']) ?? 'x',
        cursorId: hostileId(vu.random),
      },
      name: 'GET /api/app/notifications',
    }),
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: '/api/app/tasks',
      query: {
        orgId: vu.orgId,
        statuses: "todo';--",
        assigneeId: "' OR 1=1 --",
        q: wellFormed(hostileString(vu.random).slice(0, 500)),
      },
      name: 'GET /api/app/tasks',
    }),
  (vu) =>
    probe(vu, {
      method: 'GET',
      path: '/api/app/chat/threads/search',
      query: {
        orgId: vu.orgId,
        q: wellFormed(hostileString(vu.random).slice(0, 2_000)),
      },
      name: 'GET /api/app/chat/threads/search',
    }),
  // Writes with bodies the schema must refuse.
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/contacts',
      query: { orgId: vu.orgId },
      json: {
        name: hostileString(vu.random),
        email: pick(vu.random, [
          'not-an-email',
          '@@',
          'a@b',
          hostileString(vu.random),
        ]),
        phone: pick(vu.random, ['call me', '+41 <script>', '1'.repeat(80)]),
        source: wrongEnum(vu.random),
        tags: Array.from({ length: 80 }, () => 't'),
      },
      name: 'POST /api/app/contacts',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/knowledge/search',
      query: { orgId: vu.orgId },
      json: pick(vu.random, [
        { query: '' },
        { query: oversized(vu.random, 3_000) },
        { query: hostileString(vu.random), limit: 10_000 },
        { query: 'x', corpus: wrongEnum(vu.random) },
      ]),
      name: 'POST /api/app/knowledge/search',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/users/update-name',
      json: {
        name: pick(vu.random, [
          '',
          oversized(vu.random, 300),
          hostileString(vu.random),
        ]),
      },
      name: 'POST /api/app/users/update-name',
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/user-preferences/custom-instructions',
      query: { orgId: vu.orgId },
      json: {
        customInstructions: oversized(
          vu.random,
          intBetween(vu.random, 20_001, 2_000_000),
        ),
      },
      name: 'POST /api/app/user-preferences/custom-instructions',
      timeoutMs: 30_000,
    }),
  (vu) =>
    probe(vu, {
      method: 'POST',
      path: '/api/app/projects',
      query: { orgId: vu.orgId },
      json: {
        name: pick(vu.random, [
          '',
          oversized(vu.random, 81),
          hostileString(vu.random),
        ]),
      },
      name: 'POST /api/app/projects',
    }),
];

/** A burst of two to four hostile requests, with pauses between them. */
export const fuzz: Journey = {
  name: 'fuzz.hostile-input',
  run: async (vu) => {
    vu.screen = 'other';
    const count = intBetween(vu.random, 2, 4);
    for (let i = 0; i < count; i += 1) {
      const run = pick(vu.random, PROBES);
      if (run === undefined) return;
      await run(vu);
      await vu.pause('click');
    }
  },
};
