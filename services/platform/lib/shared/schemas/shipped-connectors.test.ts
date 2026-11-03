/**
 * The shipped connector catalog is valid, complete, and executable.
 *
 * This walks every `configs/platform/system/connectors/<slug>/connector.yml`
 * and proves the properties the engine and the settings UI rely on: each file
 * parses and satisfies the connector schema, its `name` matches its directory,
 * every action's mock RUNS and is deterministic (the authoring loop's whole
 * premise), and every live body compiles. A connector that only type-checks but
 * whose mock throws would fail an author on their first test run.
 *
 * It holds the scenarios a test can pick in a mock run to the same bar: each
 * fits its action, and a connector on the scenario list ships the kinds every
 * action needs and has each scenario proven against its live body, so a
 * scenario answers what a live call in that case does.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  connectorLiveBody,
  connectorSchema,
  MINIMUM_SCENARIO_KINDS,
  type Connector,
  type ConnectorAction,
} from '@tale/shared/schemas/connectors';
import { describe, expect, it } from 'vitest';

import { inProcessLiveRunner } from '../../connectors/in-process-live';
import {
  base64Decode,
  base64Encode,
  toConnectorResponse,
} from '../../connectors/live-host';
import { connectorFailureOf } from '../../engine/core/record/failure';
import type {
  ConnectorContext,
  ConnectorHttpResponse,
} from '../../engine/core/slots';
import { assignable, shapeOfValue } from '../../engine/core/typing/shape';
import { parseSignature } from '../../engine/core/typing/signature';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import { isRecord } from '../../utils/type-utils';
import { parseYamlOrThrow } from '../config/yaml';

const CONNECTORS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../../configs/platform/system/connectors',
);

/** The connectors the image ships. Pinned so that deleting one — or landing a
 * directory without its connector.yml — fails loudly instead of silently
 * shrinking the catalog. */
const EXPECTED_SLUGS = [
  'automation',
  'confluence',
  'conversation',
  'discord',
  'document',
  'forgejo',
  'github',
  'glitchtip',
  'gmail',
  'google-drive',
  'http',
  'imap-smtp',
  'jev',
  'knowledge',
  'notify',
  'outlook',
  'sandbox',
  'shopify',
  'slack',
  'task',
  'tavily',
  'teams',
  'twilio',
  'webdav',
] as const;

/** The connectors whose every action ships at least the scenario kinds its
 * effect needs (`MINIMUM_SCENARIO_KINDS`), each scenario with its proof in
 * `SCENARIO_PROOFS`. A connector is added once all its actions do and is
 * never removed: tests pick its scenarios by name, so the list only grows. */
const SCENARIO_CONNECTORS = [
  'gmail',
  'jev',
  'slack',
  'tavily',
  'teams',
  'twilio',
] as const;
type ScenarioConnector = (typeof SCENARIO_CONNECTORS)[number];

const runner = nodeVmRunner();
const LIMITS = { timeoutMs: 2000 };

function loadConnector(slug: string): Connector {
  const file = path.join(CONNECTORS_DIR, slug, 'connector.yml');
  const data = parseYamlOrThrow(readFileSync(file, 'utf8'), {
    maxBytes: 1024 * 1024,
  });
  return connectorSchema.parse(data);
}

const presentSlugs = readdirSync(CONNECTORS_DIR)
  .filter((entry) => statSync(path.join(CONNECTORS_DIR, entry)).isDirectory())
  .sort();

describe('shipped connector catalog', () => {
  it('ships exactly the expected connector set', () => {
    expect(presentSlugs).toEqual([...EXPECTED_SLUGS]);
  });

  it.each([...EXPECTED_SLUGS])('%s: name matches its directory', (slug) => {
    expect(loadConnector(slug).name).toBe(slug);
  });

  it.each([...EXPECTED_SLUGS])(
    '%s: every oauth2 and client-credentials method carries https endpoints',
    (slug) => {
      for (const method of loadConnector(slug).auth) {
        if (method.method === 'client-credentials') {
          expect(method.tokenUrl.startsWith('https://')).toBe(true);
          continue;
        }
        if (method.method !== 'oauth2') continue;
        expect(method.authorizeUrl.startsWith('https://')).toBe(true);
        expect(method.tokenUrl.startsWith('https://')).toBe(true);
      }
    },
  );

  it.each([...EXPECTED_SLUGS])(
    '%s: a per-credential connector reads ctx.endpoint, a fixed one does not',
    (slug) => {
      const connector = loadConnector(slug);
      const bodies = connector.actions
        .map((a) => (a.backend?.kind === 'yaml-js' ? a.backend.live : ''))
        .join('\n');
      if (bodies.trim() === '') return;
      if (connector.endpointMode === 'per-credential') {
        expect(bodies).toContain('ctx.endpoint');
      } else {
        expect(bodies).not.toContain('ctx.endpoint');
      }
    },
  );

  // Live bodies call the network, so they are compiled as async — `await
  // ctx.http.get(...)` is their normal shape.
  it.each([...EXPECTED_SLUGS])('%s: every live body compiles', async (slug) => {
    const connector = loadConnector(slug);
    for (const action of connector.actions) {
      if (action.backend?.kind !== 'yaml-js') continue;
      // With its connector's prelude, as every runner runs it: a name the
      // body declares again would only fail here.
      const error = await runner.checkBody(
        connectorLiveBody(connector, action.backend.live),
        { async: true },
      );
      expect(error, `${slug}.${action.name} live body: ${error}`).toBeNull();
    }
  });

  it.each([...EXPECTED_SLUGS])(
    '%s: every mock runs and is deterministic',
    async (slug) => {
      for (const action of loadConnector(slug).actions) {
        const input = action.exampleInput ?? {};
        const first = await runner.runBody(action.mock, { input }, LIMITS);
        const second = await runner.runBody(action.mock, { input }, LIMITS);
        expect(
          first,
          `${slug}.${action.name} mock returned nothing`,
        ).toBeDefined();
        expect(
          JSON.stringify(second),
          `${slug}.${action.name} mock is not deterministic`,
        ).toBe(JSON.stringify(first));
      }
    },
  );

  it('imap-smtp: smtp port and security defaults agree on the TLS mode', () => {
    // normalizeConfig applies every declared default when the form leaves a
    // field blank. tls+587 (or starttls+465) is OpenSSL's wrong version number
    // on the live send path — keep the pair coherent.
    const fields = Object.fromEntries(
      loadConnector('imap-smtp').configFields.map((field) => [
        field.key,
        field,
      ]),
    );
    expect(fields.security?.default).toBe('tls');
    expect(fields.smtpPort?.default).toBe(465);
    expect(fields.imapPort?.default).toBe(993);
    expect(fields.smtpPort).toMatchObject({
      integer: true,
      min: 1,
      max: 65535,
    });
    expect(fields.imapPort).toMatchObject({
      integer: true,
      min: 1,
      max: 65535,
    });
  });

  // ctx.http carries at most 5 MiB of response and Gmail sends attachment
  // bytes base64url inside JSON: fetching a bigger part throws and fails the
  // whole action — after the parts before it were already stored.
  it.each(['get_message', 'get_attachments'])(
    'gmail: %s lists a part too large to carry as truncated instead of fetching it',
    async (actionName) => {
      const action = loadConnector('gmail').actions.find(
        (a) => a.name === actionName,
      );
      if (action?.backend?.kind !== 'yaml-js') {
        throw new Error(`gmail.${actionName} has no yaml-js live body`);
      }
      const big = 4 * 1024 * 1024;
      const fetched: string[] = [];
      const ctx = {
        http: {
          get: async (url: string) => {
            fetched.push(url);
            const body = url.includes('/attachments/')
              ? { data: Buffer.from('pdf').toString('base64url') }
              : {
                  id: 'm1',
                  payload: {
                    parts: [
                      {
                        mimeType: 'application/pdf',
                        filename: 'small.pdf',
                        body: { attachmentId: 'small', size: 3 },
                      },
                      {
                        mimeType: 'application/pdf',
                        filename: 'big.pdf',
                        body: { attachmentId: 'big', size: big },
                      },
                    ],
                  },
                };
            return {
              status: 200,
              json: () => body,
              text: () => JSON.stringify(body),
            };
          },
        },
        files: {
          store: async (_data: string, opts: { fileName: string }) => ({
            id: `s3:org/${opts.fileName}`,
          }),
        },
      };

      const out = (await inProcessLiveRunner().runBody(
        action.backend.live,
        { input: { messageId: 'm1', includeAttachments: true }, ctx },
        LIMITS,
        { async: true },
      )) as { attachments: unknown[] };

      expect(out.attachments).toEqual([
        {
          id: 'small',
          filename: 'small.pdf',
          contentType: 'application/pdf',
          size: 3,
          fileId: 's3:org/small.pdf',
        },
        {
          id: 'big',
          filename: 'big.pdf',
          contentType: 'application/pdf',
          size: big,
          truncated: true,
        },
      ]);
      expect(fetched.some((url) => url.endsWith('/attachments/big'))).toBe(
        false,
      );
    },
  );
});

/** The kinds `action`'s effect needs that it does not ship yet. */
function missingScenarioKinds(action: ConnectorAction): string[] {
  const shipped = new Set((action.scenarios ?? []).map((s) => s.kind));
  return MINIMUM_SCENARIO_KINDS[action.effects].filter(
    (kind) => !shipped.has(kind),
  );
}

/** One answer a service gives a request: the HTTP status, the headers
 * (lower-cased, as the live host hands them on), and the body — JSON, or the
 * plain text a service answers with, as Slack's upload URL does. */
interface ServiceAnswer {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

/** The answers one proof gives, keyed `<METHOD> <url>` in the order the live
 * body makes its requests. */
type ProofAnswers = Record<string, ServiceAnswer>;

const SLACK_API = 'https://slack.com/api';
const UPLOAD_URL = 'https://files.slack.com/upload/v1/EXAMPLE0000000001';
const SECOND_UPLOAD_URL = 'https://files.slack.com/upload/v1/EXAMPLE0000000002';

/** A call Slack carried out: HTTP 200 and `ok: true`. */
function slackOk(body: Record<string, unknown>): ServiceAnswer {
  return { status: 200, body: { ok: true, ...body } };
}

/** A call Slack refused: HTTP 200 as well, with `ok: false` and the error's
 * code — which is why every body checks `ok`, not only the status. */
function slackError(error: string): ServiceAnswer {
  return { status: 200, body: { ok: false, error } };
}

/** A rate limit is the refusal with a status of its own: 429, and the
 * seconds to wait in Retry-After. */
const SLACK_RATE_LIMITED: ServiceAnswer = {
  status: 429,
  headers: { 'retry-after': '30' },
  body: { ok: false, error: 'ratelimited' },
};

/** What an upload URL answers once it holds the bytes: their count, as text
 * (the example input's content is 48 characters). */
const SLACK_UPLOADED: ServiceAnswer = { status: 200, body: 'OK - 48' };

/**
 * The proof of every Slack scenario, keyed `<action>/<scenario>`: the answer
 * Slack gives each POST the live body makes, in the order the body makes
 * them, when its input is the action's example input with the scenario's
 * `when` laid over it. An answer carries the members the action's output
 * names; the bodies hand Slack's records on as they come, so the further
 * members a real answer holds would ride along.
 */
const SLACK_PROOFS: Record<string, ProofAnswers> = {
  'list_channels/two_channels': {
    [`POST ${SLACK_API}/conversations.list`]: slackOk({
      channels: [
        { id: 'C0000000001', name: 'general', is_private: false },
        { id: 'C0000000002', name: 'deploys', is_private: false },
      ],
      // The last page carries an empty cursor; the body answers null.
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_channels/no_channels': {
    [`POST ${SLACK_API}/conversations.list`]: slackOk({
      channels: [],
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_channels/invalid_auth': {
    [`POST ${SLACK_API}/conversations.list`]: slackError('invalid_auth'),
  },
  'get_channel/one_channel': {
    [`POST ${SLACK_API}/conversations.info`]: slackOk({
      channel: {
        id: 'C0000000001',
        name: 'general',
        is_private: false,
        topic: { value: 'Company-wide announcements.' },
      },
    }),
  },
  'get_channel/no_topic': {
    [`POST ${SLACK_API}/conversations.info`]: slackOk({
      channel: {
        id: 'C0000000002',
        name: 'random',
        is_private: false,
        topic: { value: '' },
      },
    }),
  },
  'get_channel/channel_not_found': {
    [`POST ${SLACK_API}/conversations.info`]: slackError('channel_not_found'),
  },
  'get_channel/invalid_auth': {
    [`POST ${SLACK_API}/conversations.info`]: slackError('invalid_auth'),
  },
  'list_messages/two_messages': {
    [`POST ${SLACK_API}/conversations.history`]: slackOk({
      messages: [
        {
          ts: '1700000000.000200',
          text: 'Deploy finished.',
          user: 'U0000000002',
        },
        {
          ts: '1700000000.000100',
          text: 'Starting the deploy.',
          user: 'U0000000001',
        },
      ],
      has_more: false,
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_messages/no_messages': {
    [`POST ${SLACK_API}/conversations.history`]: slackOk({
      messages: [],
      has_more: false,
    }),
  },
  'list_messages/not_in_channel': {
    [`POST ${SLACK_API}/conversations.history`]: slackError('not_in_channel'),
  },
  'send_message/posted': {
    [`POST ${SLACK_API}/chat.postMessage`]: slackOk({
      channel: 'C0000000001',
      ts: '1700000000.000100',
    }),
  },
  'send_message/posted_again': {
    [`POST ${SLACK_API}/chat.postMessage`]: slackOk({
      channel: 'C0000000001',
      ts: '1700000000.000200',
    }),
  },
  'send_message/not_in_channel': {
    [`POST ${SLACK_API}/chat.postMessage`]: slackError('not_in_channel'),
  },
  'send_message/channel_not_found': {
    [`POST ${SLACK_API}/chat.postMessage`]: slackError('channel_not_found'),
  },
  'send_message/rate_limited': {
    [`POST ${SLACK_API}/chat.postMessage`]: SLACK_RATE_LIMITED,
  },
  'list_users/two_members': {
    [`POST ${SLACK_API}/users.list`]: slackOk({
      members: [
        {
          id: 'U0000000001',
          name: 'alex.example',
          real_name: 'Alex Example',
          is_bot: false,
        },
        {
          id: 'U0000000002',
          name: 'deploy-bot',
          real_name: 'Deploy Bot',
          is_bot: true,
        },
      ],
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_users/no_members': {
    [`POST ${SLACK_API}/users.list`]: slackOk({
      members: [],
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_users/rate_limited': {
    [`POST ${SLACK_API}/users.list`]: SLACK_RATE_LIMITED,
  },
  'get_user/one_user': {
    [`POST ${SLACK_API}/users.info`]: slackOk({
      user: {
        id: 'U0000000001',
        name: 'alex.example',
        real_name: 'Alex Example',
        is_bot: false,
      },
    }),
  },
  'get_user/no_real_name': {
    [`POST ${SLACK_API}/users.info`]: slackOk({
      user: {
        id: 'U0000000003',
        name: 'sam.example',
        real_name: '',
        is_bot: false,
      },
    }),
  },
  'get_user/user_not_found': {
    [`POST ${SLACK_API}/users.info`]: slackError('user_not_found'),
  },
  'get_user/invalid_auth': {
    [`POST ${SLACK_API}/users.info`]: slackError('invalid_auth'),
  },
  // Slack's three-step upload: reserve an upload URL and a file id, send the
  // bytes there, then complete the upload, which shares the file.
  'upload_file/uploaded': {
    [`POST ${SLACK_API}/files.getUploadURLExternal`]: slackOk({
      upload_url: UPLOAD_URL,
      file_id: 'F0000000001',
    }),
    [`POST ${UPLOAD_URL}`]: SLACK_UPLOADED,
    [`POST ${SLACK_API}/files.completeUploadExternal`]: slackOk({
      files: [{ id: 'F0000000001', title: 'report.txt' }],
    }),
  },
  'upload_file/uploaded_again': {
    [`POST ${SLACK_API}/files.getUploadURLExternal`]: slackOk({
      upload_url: SECOND_UPLOAD_URL,
      file_id: 'F0000000002',
    }),
    [`POST ${SECOND_UPLOAD_URL}`]: SLACK_UPLOADED,
    [`POST ${SLACK_API}/files.completeUploadExternal`]: slackOk({
      files: [{ id: 'F0000000002', title: 'report.txt' }],
    }),
  },
  'upload_file/not_in_channel': {
    [`POST ${SLACK_API}/files.getUploadURLExternal`]: slackOk({
      upload_url: UPLOAD_URL,
      file_id: 'F0000000001',
    }),
    [`POST ${UPLOAD_URL}`]: SLACK_UPLOADED,
    [`POST ${SLACK_API}/files.completeUploadExternal`]:
      slackError('not_in_channel'),
  },
};

/** The one request jev.decide makes: a POST to OpenRouter's decisions
 * endpoint. */
const JEV_DECIDE = 'POST https://openrouter.ai/api/alpha/decisions';

/** OpenRouter's answers to the example input's two questions: a choice and a
 * score, each with its distribution. */
const JEV_ANSWERS = {
  handling: {
    type: 'choice',
    choice: 'escalate',
    probabilities: { auto_reply: 0.06, escalate: 0.94 },
    confidence: 0.94,
  },
  urgency: {
    type: 'score',
    score: 1,
    probabilities: { '0': 0.18, '1': 0.71, '2': 0.11 },
    confidence: 0.71,
  },
};

/** A call OpenRouter refused: the status, and the error body it answers with,
 * which the live body reads only for a status it does not name. */
function openRouterError(code: number, message: string): ServiceAnswer {
  return { status: code, body: { error: { code, message } } };
}

/**
 * The proof of every Jev scenario, keyed as Slack's are: OpenRouter's answer
 * to the one request `decide` makes. The body hands the answers on as they
 * come, and throws a refusal with its status.
 */
const JEV_PROOFS: Record<string, ProofAnswers> = {
  'decide/two_answers': {
    [JEV_DECIDE]: {
      status: 200,
      body: {
        answers: JEV_ANSWERS,
        usage: { input_tokens: 128, output_tokens: 0 },
      },
    },
  },
  'decide/no_usage': {
    [JEV_DECIDE]: { status: 200, body: { answers: JEV_ANSWERS } },
  },
  'decide/invalid_key': {
    [JEV_DECIDE]: openRouterError(401, 'Invalid API key'),
  },
  'decide/no_credit': {
    [JEV_DECIDE]: openRouterError(402, 'Insufficient credits'),
  },
  'decide/rate_limited': {
    [JEV_DECIDE]: openRouterError(429, 'Rate limit exceeded'),
  },
};

/** The one request each Tavily action makes: a POST that carries the API key
 * in its JSON body. */
const TAVILY_SEARCH = 'POST https://api.tavily.com/search';
const TAVILY_EXTRACT = 'POST https://api.tavily.com/extract';

/** The two results Tavily finds for the example query. */
const TAVILY_RESULTS = [
  {
    title: 'A practical guide to retrieval-augmented generation',
    url: 'https://example.com/rag-guide',
    content:
      'Retrieval-augmented generation grounds an answer in documents retrieved when the question is asked.',
    score: 0.97,
  },
  {
    title: 'Hybrid retrieval for RAG pipelines',
    url: 'https://example.com/hybrid-retrieval',
    content:
      'Combining dense and keyword retrieval finds rare terms that either one alone misses.',
    score: 0.91,
  },
];

/** Tavily's answer to a search: the results, and an `answer` that is null
 * unless the call asked for one. */
function tavilySearched(
  results: unknown[],
  answer: string | null = null,
): ServiceAnswer {
  return {
    status: 200,
    body: {
      query: 'latest advances in retrieval-augmented generation',
      answer,
      images: [],
      results,
      response_time: 1.42,
    },
  };
}

/** The page the example input asks Tavily to extract. */
const TAVILY_PAGE = {
  url: 'https://example.com/article',
  raw_content:
    'Retrieval-augmented generation pairs a retriever with a language model, which grounds its answer in the passages the retriever finds.',
};

/** Tavily's answer to an extraction: HTTP 200 whether or not it read every
 * page, with the pages it read and, in `failed_results`, the URLs it could
 * not read and why. */
function tavilyExtracted(
  results: unknown[],
  failedResults: unknown[],
): ServiceAnswer {
  return {
    status: 200,
    body: { results, failed_results: failedResults, response_time: 0.5 },
  };
}

/** A call Tavily refused: the status, and the `detail` that says why, which
 * the live bodies put in their error's message as Tavily sent it. */
function tavilyRefusal(
  status: number,
  detail: Record<string, unknown>,
): ServiceAnswer {
  return { status, body: { detail } };
}

const TAVILY_INVALID_KEY = tavilyRefusal(401, {
  error: 'Unauthorized: missing or invalid API key.',
});

/** A rate limit, with the seconds to wait in Retry-After. */
const TAVILY_RATE_LIMITED: ServiceAnswer = {
  status: 429,
  headers: { 'retry-after': '60' },
  body: {
    detail: {
      error:
        'Your request has been blocked due to excessive requests. Please reduce the rate of requests.',
    },
  },
};

/** Tavily's own status for a plan that has reached its usage limit. */
const TAVILY_USAGE_LIMIT = tavilyRefusal(432, {
  error:
    "This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com",
});

/**
 * The proof of every Tavily scenario, keyed as Slack's are: Tavily's answer
 * to the one request each action makes. The bodies hand Tavily's records on
 * as they come and throw a refusal with its status, so an answer carries the
 * members the action's output names, and the further members a real record
 * holds would ride along.
 */
const TAVILY_PROOFS: Record<string, ProofAnswers> = {
  'search/two_results': { [TAVILY_SEARCH]: tavilySearched(TAVILY_RESULTS) },
  'search/answered': {
    [TAVILY_SEARCH]: tavilySearched(
      TAVILY_RESULTS,
      'Recent systems combine dense and keyword retrieval and re-rank the passages before the model answers.',
    ),
  },
  'search/no_results': { [TAVILY_SEARCH]: tavilySearched([]) },
  'search/invalid_key': { [TAVILY_SEARCH]: TAVILY_INVALID_KEY },
  'search/rate_limited': { [TAVILY_SEARCH]: TAVILY_RATE_LIMITED },
  'search/usage_limit': { [TAVILY_SEARCH]: TAVILY_USAGE_LIMIT },
  'extract/one_page': { [TAVILY_EXTRACT]: tavilyExtracted([TAVILY_PAGE], []) },
  'extract/partly_failed': {
    [TAVILY_EXTRACT]: tavilyExtracted(
      [TAVILY_PAGE],
      [
        {
          url: 'https://example.com/unavailable',
          error: 'Failed to retrieve content',
        },
      ],
    ),
  },
  'extract/nothing_extracted': {
    [TAVILY_EXTRACT]: tavilyExtracted(
      [],
      [
        {
          url: 'https://example.com/article',
          error: 'Failed to retrieve content',
        },
      ],
    ),
  },
  'extract/invalid_urls': {
    [TAVILY_EXTRACT]: tavilyRefusal(400, {
      error: 'All URLs failed validation.',
      failed_results: [
        { url: 'not-a-url', error: 'Validation Error: Invalid URL format' },
      ],
    }),
  },
  'extract/invalid_key': { [TAVILY_EXTRACT]: TAVILY_INVALID_KEY },
  'extract/rate_limited': { [TAVILY_EXTRACT]: TAVILY_RATE_LIMITED },
  'extract/usage_limit': { [TAVILY_EXTRACT]: TAVILY_USAGE_LIMIT },
};

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** The team and the channel of the Teams actions' example input, as the live
 * bodies encode them into a URL. */
const GRAPH_TEAM = `${GRAPH}/teams/19%3Ateam-demo%40thread.tacv2`;
const GRAPH_CHANNEL = `${GRAPH_TEAM}/channels/19%3Achannel-general%40thread.tacv2`;

/** The team and the channel the `when` of a not-found scenario names. */
const GRAPH_MISSING_TEAM = `${GRAPH}/teams/00000000-0000-0000-0000-000000000009`;
const GRAPH_MISSING_CHANNEL = `${GRAPH_TEAM}/channels/19%3Achannel-missing%40thread.tacv2`;

/** A read Graph carried out: HTTP 200 and the record, or a page of records
 * under `value`. A last page carries no `@odata.nextLink`; the bodies answer
 * null. */
function graphOk(body: Record<string, unknown>): ServiceAnswer {
  return { status: 200, body };
}

/** A message Graph posted: HTTP 201 and the message. Its id is the time it
 * was created, in milliseconds since the epoch. */
function graphCreated(body: Record<string, unknown>): ServiceAnswer {
  return { status: 201, body };
}

/** A call Graph refused: the status, and Graph's error body, which the live
 * bodies read only for a status they do not name. */
function graphError(
  status: number,
  code: string,
  message: string,
): ServiceAnswer {
  return { status, body: { error: { code, message } } };
}

/** Graph's answer for a team, a channel or a chat that does not exist. */
const GRAPH_NOT_FOUND = graphError(
  404,
  'NotFound',
  'The requested resource does not exist.',
);

/** Graph's answer to an access token that lacks the scope a call needs. */
const GRAPH_MISSING_SCOPE = graphError(
  403,
  'Forbidden',
  'Missing scope permissions on the request.',
);

/** Graph's throttling: 429, the seconds to wait in Retry-After, and the error
 * body Graph's throttling guidance shows. */
const GRAPH_RATE_LIMITED: ServiceAnswer = {
  status: 429,
  headers: { 'retry-after': '10' },
  body: {
    error: { code: 'TooManyRequests', message: 'Please retry again later.' },
  },
};

/** A Teams link to a channel message of the example team, as Graph builds it
 * from the channel, the message's id, the team's group and its tenant. */
function teamsMessageUrl(id: string): string {
  return (
    `https://teams.microsoft.com/l/message/19%3Achannel-general%40thread.tacv2/${id}` +
    `?groupId=00000000-0000-0000-0000-000000000001` +
    `&tenantId=00000000-0000-0000-0000-0000000000f1` +
    `&createdTime=${id}&parentMessageId=${id}`
  );
}

/**
 * The proof of every Teams scenario, keyed as Slack's are: Graph's answer to
 * the one request each action makes. An answer carries the members the
 * action's output names, as Slack's do; the bodies hand Graph's records on as
 * they come, and throw a refusal with its status.
 */
const TEAMS_PROOFS: Record<string, ProofAnswers> = {
  'list_teams/two_teams': {
    [`GET ${GRAPH}/me/joinedTeams`]: graphOk({
      value: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          displayName: 'Engineering',
          description: 'Builds and runs the product.',
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          displayName: 'Support',
          description: 'Answers customer questions.',
        },
      ],
    }),
  },
  'list_teams/no_teams': {
    [`GET ${GRAPH}/me/joinedTeams`]: graphOk({ value: [] }),
  },
  'list_teams/token_expired': {
    [`GET ${GRAPH}/me/joinedTeams`]: graphError(
      401,
      'InvalidAuthenticationToken',
      'Access token has expired or is not yet valid.',
    ),
  },
  'get_team/one_team': {
    [`GET ${GRAPH_TEAM}`]: graphOk({
      id: '00000000-0000-0000-0000-000000000001',
      displayName: 'Engineering',
      description: 'Builds and runs the product.',
      visibility: 'private',
    }),
  },
  'get_team/no_description': {
    [`GET ${GRAPH_TEAM}`]: graphOk({
      id: '00000000-0000-0000-0000-000000000003',
      displayName: 'Sandbox',
      description: null,
      visibility: 'public',
    }),
  },
  'get_team/team_not_found': {
    [`GET ${GRAPH_MISSING_TEAM}`]: GRAPH_NOT_FOUND,
  },
  'list_channels/two_channels': {
    [`GET ${GRAPH_TEAM}/channels`]: graphOk({
      value: [
        {
          id: '19:channel-general@thread.tacv2',
          displayName: 'General',
          description: 'Announcements for the whole team.',
          membershipType: 'standard',
        },
        {
          id: '19:channel-deploys@thread.tacv2',
          displayName: 'Deploys',
          description: 'Release and deploy notices.',
          membershipType: 'private',
        },
      ],
    }),
  },
  'list_channels/general_only': {
    [`GET ${GRAPH_TEAM}/channels`]: graphOk({
      value: [
        {
          id: '19:channel-general@thread.tacv2',
          displayName: 'General',
          description: null,
          membershipType: 'standard',
        },
      ],
    }),
  },
  'list_channels/team_not_found': {
    [`GET ${GRAPH_MISSING_TEAM}/channels`]: GRAPH_NOT_FOUND,
  },
  'get_channel/one_channel': {
    [`GET ${GRAPH_CHANNEL}`]: graphOk({
      id: '19:channel-general@thread.tacv2',
      displayName: 'General',
      description: 'Announcements for the whole team.',
      membershipType: 'standard',
    }),
  },
  'get_channel/no_description': {
    [`GET ${GRAPH_CHANNEL}`]: graphOk({
      id: '19:channel-general@thread.tacv2',
      displayName: 'General',
      description: null,
      membershipType: 'standard',
    }),
  },
  'get_channel/channel_not_found': {
    [`GET ${GRAPH_MISSING_CHANNEL}`]: GRAPH_NOT_FOUND,
  },
  'list_messages/two_messages': {
    [`GET ${GRAPH_CHANNEL}/messages?$top=20`]: graphOk({
      value: [
        {
          id: '1700000600000',
          body: { content: 'Deploy finished.', contentType: 'text' },
          from: {
            user: {
              id: '00000000-0000-0000-0000-0000000000a2',
              displayName: 'Sam Example',
            },
          },
          createdDateTime: '2023-11-14T22:23:20.000Z',
        },
        {
          id: '1700000000000',
          body: { content: '<p>Starting the deploy.</p>', contentType: 'html' },
          from: {
            user: {
              id: '00000000-0000-0000-0000-0000000000a1',
              displayName: 'Alex Example',
            },
          },
          createdDateTime: '2023-11-14T22:13:20.000Z',
        },
      ],
    }),
  },
  'list_messages/no_messages': {
    [`GET ${GRAPH_CHANNEL}/messages?$top=20`]: graphOk({ value: [] }),
  },
  'list_messages/channel_not_found': {
    [`GET ${GRAPH_MISSING_CHANNEL}/messages?$top=20`]: GRAPH_NOT_FOUND,
  },
  'list_messages/rate_limited': {
    [`GET ${GRAPH_CHANNEL}/messages?$top=20`]: GRAPH_RATE_LIMITED,
  },
  'send_message/sent': {
    [`POST ${GRAPH_CHANNEL}/messages`]: graphCreated({
      id: '1700001200000',
      webUrl: teamsMessageUrl('1700001200000'),
    }),
  },
  'send_message/sent_again': {
    [`POST ${GRAPH_CHANNEL}/messages`]: graphCreated({
      id: '1700001260000',
      webUrl: teamsMessageUrl('1700001260000'),
    }),
  },
  'send_message/missing_scope': {
    [`POST ${GRAPH_CHANNEL}/messages`]: GRAPH_MISSING_SCOPE,
  },
  'send_message/channel_not_found': {
    [`POST ${GRAPH_MISSING_CHANNEL}/messages`]: GRAPH_NOT_FOUND,
  },
  'send_message/rate_limited': {
    [`POST ${GRAPH_CHANNEL}/messages`]: GRAPH_RATE_LIMITED,
  },
  'list_members/two_members': {
    [`GET ${GRAPH_TEAM}/members?$top=100`]: graphOk({
      value: [
        {
          // A member's id is the team's and the user's id, joined by `##`,
          // in base64.
          id: 'MDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIyMwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwYTE=',
          displayName: 'Alex Example',
          email: 'alex@example.com',
          roles: ['owner'],
        },
        {
          id: 'MDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIyMwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwYTI=',
          displayName: 'Sam Example',
          email: 'sam@example.com',
          roles: [],
        },
      ],
    }),
  },
  'list_members/no_members': {
    [`GET ${GRAPH_TEAM}/members?$top=100`]: graphOk({ value: [] }),
  },
  'list_members/team_not_found': {
    [`GET ${GRAPH_MISSING_TEAM}/members?$top=100`]: GRAPH_NOT_FOUND,
  },
  'list_chats/two_chats': {
    [`GET ${GRAPH}/me/chats?$top=20`]: graphOk({
      value: [
        {
          id: '19:chat-release-planning@thread.v2',
          topic: 'Release planning',
          chatType: 'group',
        },
        {
          id: '19:00000000-0000-0000-0000-0000000000a1_00000000-0000-0000-0000-0000000000a2@unq.gbl.spaces',
          topic: null,
          chatType: 'oneOnOne',
        },
      ],
    }),
  },
  'list_chats/no_chats': {
    [`GET ${GRAPH}/me/chats?$top=20`]: graphOk({ value: [] }),
  },
  'list_chats/missing_scope': {
    [`GET ${GRAPH}/me/chats?$top=20`]: GRAPH_MISSING_SCOPE,
  },
  'send_chat_message/sent': {
    [`POST ${GRAPH}/chats/19%3Achat-demo%40thread.v2/messages`]: graphCreated({
      id: '1700001800000',
      chatId: '19:chat-demo@thread.v2',
    }),
  },
  'send_chat_message/sent_again': {
    [`POST ${GRAPH}/chats/19%3Achat-demo%40thread.v2/messages`]: graphCreated({
      id: '1700001860000',
      chatId: '19:chat-demo@thread.v2',
    }),
  },
  'send_chat_message/missing_scope': {
    [`POST ${GRAPH}/chats/19%3Achat-demo%40thread.v2/messages`]:
      GRAPH_MISSING_SCOPE,
  },
  'send_chat_message/chat_not_found': {
    [`POST ${GRAPH}/chats/19%3Achat-missing%40thread.v2/messages`]:
      GRAPH_NOT_FOUND,
  },
  'send_chat_message/rate_limited': {
    [`POST ${GRAPH}/chats/19%3Achat-demo%40thread.v2/messages`]:
      GRAPH_RATE_LIMITED,
  },
};

/** The account a synthetic credential names: Twilio's own placeholder SID,
 * as GitHub's push protection takes a hex-shaped one for a real SID. */
const TWILIO_ACCOUNT = 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const TWILIO_API = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT}`;

/** The one request each Twilio action makes with its example input: the
 * credential's Account SID names the path, and a list's filters and page
 * size ride in the query. */
const TWILIO_REQUEST = {
  send_sms: `POST ${TWILIO_API}/Messages.json`,
  list_messages: `GET ${TWILIO_API}/Messages.json?To=%2B15551234567&PageSize=20`,
  get_message: `GET ${TWILIO_API}/Messages/SM1234567890abcdef1234567890abcdef.json`,
  list_calls: `GET ${TWILIO_API}/Calls.json?Status=completed&PageSize=20`,
  make_call: `POST ${TWILIO_API}/Calls.json`,
  get_account: `GET ${TWILIO_API}.json`,
  list_phone_numbers: `GET ${TWILIO_API}/IncomingPhoneNumbers.json?PageSize=20`,
};

/** A call Twilio refused: the status, and the error body it answers with —
 * its code, message, documentation link and the status again — which the
 * live bodies hand on as text only for a status they do not name. */
function twilioError(
  status: number,
  code: number,
  message: string,
): ServiceAnswer {
  return {
    status,
    body: {
      code,
      message,
      more_info: `https://www.twilio.com/docs/errors/${code}`,
      status,
    },
  };
}

/** Twilio's answer to an Account SID and Auth Token it does not accept. */
const TWILIO_UNAUTHORIZED = twilioError(
  401,
  20003,
  'Authentication Error - invalid username',
);

/** Twilio's answer when the account has more requests in flight than its
 * concurrency limit allows. */
const TWILIO_RATE_LIMITED = twilioError(429, 20429, 'Too Many Requests');

/**
 * The proof of every Twilio scenario, keyed as Slack's are: Twilio's answer
 * to the one request each action makes. A write answers HTTP 201, and a
 * refusal comes as its HTTP status with Twilio's error body. An answer
 * carries the members the action's output names; `list_messages`,
 * `get_message` and `list_calls` hand Twilio's records on as they come, so
 * the further members a real answer holds would ride along.
 */
const TWILIO_PROOFS: Record<string, ProofAnswers> = {
  'send_sms/queued': {
    [TWILIO_REQUEST.send_sms]: {
      status: 201,
      body: {
        sid: 'SM00000000000000000000000000000001',
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
      },
    },
  },
  'send_sms/queued_again': {
    [TWILIO_REQUEST.send_sms]: {
      status: 201,
      body: {
        sid: 'SM00000000000000000000000000000002',
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
      },
    },
  },
  'send_sms/unsubscribed_recipient': {
    [TWILIO_REQUEST.send_sms]: twilioError(
      400,
      21610,
      'Attempt to send to unsubscribed recipient',
    ),
  },
  'send_sms/rate_limited': {
    [TWILIO_REQUEST.send_sms]: TWILIO_RATE_LIMITED,
  },
  'list_messages/two_messages': {
    [TWILIO_REQUEST.list_messages]: {
      status: 200,
      body: {
        messages: [
          {
            sid: 'SM00000000000000000000000000000002',
            body: 'Your order is out for delivery.',
            status: 'queued',
            to: '+15551234567',
            from: '+15559876543',
            // A message Twilio has not sent yet has no date sent.
            date_sent: null,
          },
          {
            sid: 'SM00000000000000000000000000000001',
            body: 'Your order has shipped.',
            status: 'delivered',
            to: '+15551234567',
            from: '+15559876543',
            date_sent: 'Mon, 06 Jan 2025 09:30:05 +0000',
          },
        ],
        next_page_uri: null,
      },
    },
  },
  'list_messages/no_messages': {
    [TWILIO_REQUEST.list_messages]: {
      status: 200,
      body: { messages: [], next_page_uri: null },
    },
  },
  'list_messages/invalid_credentials': {
    [TWILIO_REQUEST.list_messages]: TWILIO_UNAUTHORIZED,
  },
  'list_messages/rate_limited': {
    [TWILIO_REQUEST.list_messages]: TWILIO_RATE_LIMITED,
  },
  'get_message/one_message': {
    [TWILIO_REQUEST.get_message]: {
      status: 200,
      body: {
        sid: 'SM1234567890abcdef1234567890abcdef',
        body: 'Your order has shipped.',
        status: 'delivered',
        to: '+15551234567',
        from: '+15559876543',
        date_sent: 'Mon, 06 Jan 2025 09:30:05 +0000',
      },
    },
  },
  'get_message/not_sent_yet': {
    [TWILIO_REQUEST.get_message]: {
      status: 200,
      body: {
        sid: 'SM1234567890abcdef1234567890abcdef',
        body: 'Your order has shipped.',
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
        date_sent: null,
      },
    },
  },
  'get_message/message_not_found': {
    [`GET ${TWILIO_API}/Messages/SM00000000000000000000000000000009.json`]:
      twilioError(
        404,
        20404,
        `The requested resource /2010-04-01/Accounts/${TWILIO_ACCOUNT}/Messages/SM00000000000000000000000000000009.json was not found`,
      ),
  },
  'get_message/invalid_credentials': {
    [TWILIO_REQUEST.get_message]: TWILIO_UNAUTHORIZED,
  },
  'list_calls/two_calls': {
    [TWILIO_REQUEST.list_calls]: {
      status: 200,
      body: {
        calls: [
          {
            sid: 'CA00000000000000000000000000000002',
            status: 'completed',
            to: '+15551234567',
            from: '+15559876543',
            duration: '17',
          },
          {
            sid: 'CA00000000000000000000000000000001',
            status: 'completed',
            to: '+15551234568',
            from: '+15559876543',
            duration: '42',
          },
        ],
        next_page_uri: null,
      },
    },
  },
  'list_calls/no_calls': {
    [TWILIO_REQUEST.list_calls]: {
      status: 200,
      body: { calls: [], next_page_uri: null },
    },
  },
  'list_calls/invalid_credentials': {
    [TWILIO_REQUEST.list_calls]: TWILIO_UNAUTHORIZED,
  },
  'list_calls/rate_limited': {
    [TWILIO_REQUEST.list_calls]: TWILIO_RATE_LIMITED,
  },
  'make_call/queued': {
    [TWILIO_REQUEST.make_call]: {
      status: 201,
      body: {
        sid: 'CA00000000000000000000000000000001',
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
      },
    },
  },
  'make_call/queued_again': {
    [TWILIO_REQUEST.make_call]: {
      status: 201,
      body: {
        sid: 'CA00000000000000000000000000000002',
        status: 'queued',
        to: '+15551234567',
        from: '+15559876543',
      },
    },
  },
  'make_call/invalid_credentials': {
    [TWILIO_REQUEST.make_call]: TWILIO_UNAUTHORIZED,
  },
  'make_call/rate_limited': {
    [TWILIO_REQUEST.make_call]: TWILIO_RATE_LIMITED,
  },
  'get_account/active_account': {
    [TWILIO_REQUEST.get_account]: {
      status: 200,
      body: {
        sid: TWILIO_ACCOUNT,
        friendly_name: 'Example Shop',
        status: 'active',
        type: 'Full',
      },
    },
  },
  'get_account/no_friendly_name': {
    [TWILIO_REQUEST.get_account]: {
      status: 200,
      body: {
        sid: TWILIO_ACCOUNT,
        friendly_name: '',
        status: 'active',
        type: 'Full',
      },
    },
  },
  'get_account/invalid_credentials': {
    [TWILIO_REQUEST.get_account]: TWILIO_UNAUTHORIZED,
  },
  'list_phone_numbers/two_numbers': {
    [TWILIO_REQUEST.list_phone_numbers]: {
      status: 200,
      body: {
        incoming_phone_numbers: [
          {
            sid: 'PN00000000000000000000000000000001',
            phone_number: '+15559876543',
            friendly_name: 'Main line',
          },
          {
            sid: 'PN00000000000000000000000000000002',
            phone_number: '+15559876544',
            friendly_name: 'Support line',
          },
        ],
        next_page_uri: null,
      },
    },
  },
  'list_phone_numbers/no_numbers': {
    [TWILIO_REQUEST.list_phone_numbers]: {
      status: 200,
      body: { incoming_phone_numbers: [], next_page_uri: null },
    },
  },
  'list_phone_numbers/invalid_credentials': {
    [TWILIO_REQUEST.list_phone_numbers]: TWILIO_UNAUTHORIZED,
  },
  'list_phone_numbers/rate_limited': {
    [TWILIO_REQUEST.list_phone_numbers]: TWILIO_RATE_LIMITED,
  },
};

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The message of the Gmail actions' example input, which starts its own
 * thread; a reply in that thread; a message with a scan too large to carry;
 * and the id the `when` of a not-found scenario names. */
const GMAIL_INVOICE = '18c1a2b3c4d5e6f7';
const GMAIL_REPLY = '18c1a2b3c4d5e6f9';
const GMAIL_SCANNED = '18c1a2b3c4d5e6fe';
const GMAIL_MISSING = '18c0000000000009';

/** The request each Gmail action makes for its example input, as the live
 * bodies build it. A draft is always left out of a list of messages. */
const GMAIL_REQUEST = {
  list_messages: `GET ${GMAIL}/messages?maxResults=25&q=is%3Aunread%20-is%3Adraft`,
  search_messages: `GET ${GMAIL}/messages?q=subject%3Ainvoice%20has%3Aattachment&maxResults=25`,
  send_message: `POST ${GMAIL}/messages/send`,
  get_profile: `GET ${GMAIL}/profile`,
  list_labels: `GET ${GMAIL}/labels`,
  list_drafts: `GET ${GMAIL}/drafts?maxResults=25`,
};

function gmailMessage(id: string): string {
  return `GET ${GMAIL}/messages/${id}?format=full`;
}

function gmailThread(id: string): string {
  return `GET ${GMAIL}/threads/${id}?format=full`;
}

function gmailAttachment(messageId: string, attachmentId: string): string {
  return `GET ${GMAIL}/messages/${messageId}/attachments/${attachmentId}`;
}

/** A call Gmail carried out: HTTP 200 and the resource. A list with nothing
 * in it carries no list at all, only its estimate. */
function gmailOk(body: Record<string, unknown>): ServiceAnswer {
  return { status: 200, body };
}

/** A call Gmail refused: the status, and Google's error body as Gmail sends
 * it, pretty-printed and ending in a line break — the live bodies put the
 * whole text into their message. */
function gmailError(
  code: number,
  status: string,
  message: string,
  error: Record<string, string>,
  headers: Record<string, string> = {},
): ServiceAnswer {
  const body = { error: { code, message, errors: [error], status } };
  return {
    status: code,
    headers,
    body: `${JSON.stringify(body, null, 2)}\n`,
  };
}

/** Gmail's answer to an access token it no longer accepts. */
const GMAIL_TOKEN_EXPIRED = gmailError(
  401,
  'UNAUTHENTICATED',
  'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.',
  {
    message: 'Invalid Credentials',
    domain: 'global',
    reason: 'authError',
    location: 'Authorization',
    locationType: 'header',
  },
);

/** Gmail's answer for a message or a thread that does not exist. */
const GMAIL_NOT_FOUND = gmailError(
  404,
  'NOT_FOUND',
  'Requested entity was not found.',
  {
    message: 'Requested entity was not found.',
    domain: 'global',
    reason: 'notFound',
  },
);

/** Gmail's rate limit: 429, and the seconds to wait in Retry-After. */
const GMAIL_RATE_LIMITED = gmailError(
  429,
  'RESOURCE_EXHAUSTED',
  'Rate Limit Exceeded',
  {
    message: 'Rate Limit Exceeded',
    domain: 'usageLimits',
    reason: 'rateLimitExceeded',
  },
  { 'retry-after': '30' },
);

/** The bytes of the synthetic attachments. Gmail carries them base64url
 * without padding, and a body hands the store padded base64: each needs
 * padding and holds a character the two alphabets spell differently, so
 * the stored files prove the conversion. */
const INVOICE_PDF =
  '%PDF-1.7\n% Synthetic invoice INV-2026-0042 >> 42.00 EUR\n%%EOF\n';
const PAYMENTS_CSV = 'date;amount;note\n2026-10-01;42.00;paid?\n';

/** Gmail's answer to a request for an attachment's bytes. */
function gmailBytes(content: string): ServiceAnswer {
  return gmailOk({
    size: Buffer.byteLength(content),
    data: Buffer.from(content).toString('base64url'),
  });
}

/** A file as a Gmail body hands it to the store. */
function gmailStored(
  fileName: string,
  contentType: string,
  content: string,
): StoredFile {
  return {
    fileName,
    contentType,
    encoding: 'base64',
    data: Buffer.from(content).toString('base64'),
  };
}

/** The body of a message part that carries its own text, base64url. */
function gmailText(text: string): { size: number; data: string } {
  return {
    size: Buffer.byteLength(text),
    data: Buffer.from(text).toString('base64url'),
  };
}

const INVOICE_MESSAGE = {
  id: GMAIL_INVOICE,
  threadId: GMAIL_INVOICE,
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'Your invoice INV-2026-0042 for October is attached.',
};

const REPLY_MESSAGE = {
  id: GMAIL_REPLY,
  threadId: GMAIL_INVOICE,
  labelIds: ['INBOX'],
  snippet: 'Thanks, the payment arrived.',
  payload: {
    mimeType: 'text/plain',
    filename: '',
    body: gmailText('Thanks, the payment arrived.'),
  },
};

const TEXT_PART = {
  partId: '0',
  mimeType: 'text/plain',
  filename: '',
  body: gmailText('See the attached invoice.'),
};

const INVOICE_PART = {
  partId: '1',
  mimeType: 'application/pdf',
  filename: 'invoice-2026-10.pdf',
  body: { attachmentId: 'ANGjdJ8AbC', size: Buffer.byteLength(INVOICE_PDF) },
};

const PAYMENTS_PART = {
  partId: '2',
  mimeType: 'text/csv',
  filename: 'payments-2026-10.csv',
  body: { attachmentId: 'ANGjdJ9XyZ', size: Buffer.byteLength(PAYMENTS_CSV) },
};

/** A part of 4 MiB, more than ctx.http can carry base64url inside JSON. */
const SCAN_PART = {
  partId: '1',
  mimeType: 'application/pdf',
  filename: 'scan-2026-10.pdf',
  body: { attachmentId: 'ANGjdJ7BiG', size: 4 * 1024 * 1024 },
};

/**
 * The proof of every Gmail scenario, keyed as Slack's are: Gmail's answer to
 * each request the action makes. An answer carries the members the action's
 * output names, as Slack's do, and what the body reads besides — a message's
 * parts, where it walks them for attachments. The bodies hand a message or
 * a thread on whole, and throw a refusal with its status and Gmail's text.
 */
const GMAIL_PROOFS: Record<string, ProofAnswers> = {
  'list_messages/two_messages': {
    [GMAIL_REQUEST.list_messages]: gmailOk({
      messages: [
        { id: GMAIL_INVOICE, threadId: GMAIL_INVOICE },
        { id: '18c1a2b3c4d5e6f8', threadId: '18c1a2b3c4d5e6f0' },
      ],
      resultSizeEstimate: 2,
    }),
  },
  'list_messages/no_messages': {
    [GMAIL_REQUEST.list_messages]: gmailOk({ resultSizeEstimate: 0 }),
  },
  'list_messages/token_expired': {
    [GMAIL_REQUEST.list_messages]: GMAIL_TOKEN_EXPIRED,
  },
  'list_messages/rate_limited': {
    [GMAIL_REQUEST.list_messages]: GMAIL_RATE_LIMITED,
  },
  'get_message/one_message': {
    [gmailMessage(GMAIL_INVOICE)]: gmailOk(INVOICE_MESSAGE),
  },
  'get_message/with_attachment': {
    [gmailMessage(GMAIL_INVOICE)]: gmailOk({
      ...INVOICE_MESSAGE,
      payload: {
        mimeType: 'multipart/mixed',
        filename: '',
        parts: [TEXT_PART, INVOICE_PART],
      },
    }),
    [gmailAttachment(GMAIL_INVOICE, 'ANGjdJ8AbC')]: gmailBytes(INVOICE_PDF),
  },
  'get_message/no_attachments': {
    [gmailMessage(GMAIL_REPLY)]: gmailOk(REPLY_MESSAGE),
  },
  'get_message/message_not_found': {
    [gmailMessage(GMAIL_MISSING)]: GMAIL_NOT_FOUND,
  },
  'get_message/rate_limited': {
    [gmailMessage(GMAIL_INVOICE)]: GMAIL_RATE_LIMITED,
  },
  'get_attachments/two_attachments': {
    [gmailMessage(GMAIL_INVOICE)]: gmailOk({
      ...INVOICE_MESSAGE,
      payload: {
        mimeType: 'multipart/mixed',
        filename: '',
        parts: [TEXT_PART, INVOICE_PART, PAYMENTS_PART],
      },
    }),
    [gmailAttachment(GMAIL_INVOICE, 'ANGjdJ8AbC')]: gmailBytes(INVOICE_PDF),
    [gmailAttachment(GMAIL_INVOICE, 'ANGjdJ9XyZ')]: gmailBytes(PAYMENTS_CSV),
  },
  'get_attachments/too_large': {
    [gmailMessage(GMAIL_SCANNED)]: gmailOk({
      id: GMAIL_SCANNED,
      threadId: GMAIL_SCANNED,
      labelIds: ['INBOX'],
      snippet: 'The scan and the payments of October.',
      payload: {
        mimeType: 'multipart/mixed',
        filename: '',
        parts: [SCAN_PART, PAYMENTS_PART],
      },
    }),
    [gmailAttachment(GMAIL_SCANNED, 'ANGjdJ9XyZ')]: gmailBytes(PAYMENTS_CSV),
  },
  'get_attachments/no_attachments': {
    [gmailMessage(GMAIL_REPLY)]: gmailOk(REPLY_MESSAGE),
  },
  'get_attachments/message_not_found': {
    [gmailMessage(GMAIL_MISSING)]: GMAIL_NOT_FOUND,
  },
  'search_messages/two_matches': {
    [GMAIL_REQUEST.search_messages]: gmailOk({
      messages: [
        { id: GMAIL_INVOICE, threadId: GMAIL_INVOICE },
        { id: GMAIL_SCANNED, threadId: GMAIL_SCANNED },
      ],
      resultSizeEstimate: 2,
    }),
  },
  'search_messages/no_matches': {
    [GMAIL_REQUEST.search_messages]: gmailOk({ resultSizeEstimate: 0 }),
  },
  'search_messages/token_expired': {
    [GMAIL_REQUEST.search_messages]: GMAIL_TOKEN_EXPIRED,
  },
  'send_message/sent': {
    [GMAIL_REQUEST.send_message]: gmailOk({
      id: '18c1a2b3c4d5e6fa',
      threadId: '18c1a2b3c4d5e6fa',
      labelIds: ['SENT'],
    }),
  },
  'send_message/sent_again': {
    [GMAIL_REQUEST.send_message]: gmailOk({
      id: '18c1a2b3c4d5e6fb',
      threadId: '18c1a2b3c4d5e6fb',
      labelIds: ['SENT'],
    }),
  },
  'send_message/invalid_recipient': {
    [GMAIL_REQUEST.send_message]: gmailError(
      400,
      'INVALID_ARGUMENT',
      'Invalid To header',
      {
        message: 'Invalid To header',
        domain: 'global',
        reason: 'invalidArgument',
      },
    ),
  },
  'send_message/missing_scope': {
    [GMAIL_REQUEST.send_message]: gmailError(
      403,
      'PERMISSION_DENIED',
      'Request had insufficient authentication scopes.',
      {
        message: 'Insufficient Permission',
        domain: 'global',
        reason: 'insufficientPermissions',
      },
    ),
  },
  'get_profile/mailbox': {
    [GMAIL_REQUEST.get_profile]: gmailOk({
      emailAddress: 'mailbox@example.com',
      messagesTotal: 1284,
      threadsTotal: 977,
      historyId: '4836519',
    }),
  },
  'get_profile/empty_mailbox': {
    [GMAIL_REQUEST.get_profile]: gmailOk({
      emailAddress: 'new-mailbox@example.com',
      messagesTotal: 0,
      threadsTotal: 0,
      historyId: '1',
    }),
  },
  'get_profile/token_expired': {
    [GMAIL_REQUEST.get_profile]: GMAIL_TOKEN_EXPIRED,
  },
  'list_labels/system_and_user_labels': {
    [GMAIL_REQUEST.list_labels]: gmailOk({
      labels: [
        { id: 'INBOX', name: 'INBOX', type: 'system' },
        { id: 'SENT', name: 'SENT', type: 'system' },
        { id: 'TRASH', name: 'TRASH', type: 'system' },
        { id: 'Label_1', name: 'Invoices', type: 'user' },
      ],
    }),
  },
  'list_labels/system_only': {
    [GMAIL_REQUEST.list_labels]: gmailOk({
      labels: [
        { id: 'INBOX', name: 'INBOX', type: 'system' },
        { id: 'SENT', name: 'SENT', type: 'system' },
        { id: 'TRASH', name: 'TRASH', type: 'system' },
      ],
    }),
  },
  'list_labels/token_expired': {
    [GMAIL_REQUEST.list_labels]: GMAIL_TOKEN_EXPIRED,
  },
  'get_thread/two_messages': {
    [gmailThread(GMAIL_INVOICE)]: gmailOk({
      id: GMAIL_INVOICE,
      messages: [
        {
          id: GMAIL_INVOICE,
          threadId: GMAIL_INVOICE,
          snippet: INVOICE_MESSAGE.snippet,
        },
        {
          id: GMAIL_REPLY,
          threadId: GMAIL_INVOICE,
          snippet: REPLY_MESSAGE.snippet,
        },
      ],
    }),
  },
  'get_thread/no_replies': {
    [gmailThread(GMAIL_INVOICE)]: gmailOk({
      id: GMAIL_INVOICE,
      messages: [
        {
          id: GMAIL_INVOICE,
          threadId: GMAIL_INVOICE,
          snippet: INVOICE_MESSAGE.snippet,
        },
      ],
    }),
  },
  'get_thread/thread_not_found': {
    [gmailThread(GMAIL_MISSING)]: GMAIL_NOT_FOUND,
  },
  'list_drafts/two_drafts': {
    [GMAIL_REQUEST.list_drafts]: gmailOk({
      drafts: [
        {
          id: 'r-1000000000000000001',
          message: { id: '18c1a2b3c4d5e6fc', threadId: '18c1a2b3c4d5e6fc' },
        },
        {
          id: 'r-1000000000000000002',
          message: { id: '18c1a2b3c4d5e6fd', threadId: GMAIL_INVOICE },
        },
      ],
      resultSizeEstimate: 2,
    }),
  },
  'list_drafts/no_drafts': {
    [GMAIL_REQUEST.list_drafts]: gmailOk({ resultSizeEstimate: 0 }),
  },
  'list_drafts/token_expired': {
    [GMAIL_REQUEST.list_drafts]: GMAIL_TOKEN_EXPIRED,
  },
  'get_attachment/stored': {
    [gmailAttachment(GMAIL_INVOICE, 'ANGjdJ8AbC')]: gmailBytes(INVOICE_PDF),
  },
  'get_attachment/no_link': {
    [gmailAttachment(GMAIL_INVOICE, 'ANGjdJ8AbC')]: gmailBytes(INVOICE_PDF),
  },
  'get_attachment/message_not_found': {
    [gmailAttachment(GMAIL_MISSING, 'ANGjdJ8AbC')]: GMAIL_NOT_FOUND,
  },
};

/** The files each Gmail proof stores. `get_attachment` names its file for
 * the attachment's id and stores it untyped. */
const GMAIL_STORED: Record<string, StoredFile[]> = {
  'get_message/with_attachment': [
    gmailStored('invoice-2026-10.pdf', 'application/pdf', INVOICE_PDF),
  ],
  'get_attachments/two_attachments': [
    gmailStored('invoice-2026-10.pdf', 'application/pdf', INVOICE_PDF),
    gmailStored('payments-2026-10.csv', 'text/csv', PAYMENTS_CSV),
  ],
  'get_attachments/too_large': [
    gmailStored('payments-2026-10.csv', 'text/csv', PAYMENTS_CSV),
  ],
  'get_attachment/stored': [
    gmailStored(
      'attachment-ANGjdJ8AbC',
      'application/octet-stream',
      INVOICE_PDF,
    ),
  ],
  'get_attachment/no_link': [
    gmailStored(
      'attachment-ANGjdJ8AbC',
      'application/octet-stream',
      INVOICE_PDF,
    ),
  ],
};

/**
 * Every listed connector's proofs, with the secrets its credential holds —
 * synthetic, as every answer is — and, by proof, the files its body stores,
 * in their order; a proof it does not name stores none. A connector joins
 * `SCENARIO_CONNECTORS` with its proofs, or this does not type-check.
 */
const SCENARIO_PROOFS: Record<
  ScenarioConnector,
  {
    secrets?: Record<string, string>;
    proofs: Record<string, ProofAnswers>;
    stored?: Record<string, StoredFile[]>;
  }
> = {
  gmail: { proofs: GMAIL_PROOFS, stored: GMAIL_STORED },
  jev: {
    secrets: { apiKey: 'example-openrouter-key' },
    proofs: JEV_PROOFS,
  },
  slack: { proofs: SLACK_PROOFS },
  tavily: {
    secrets: { apiKey: 'example-tavily-key' },
    proofs: TAVILY_PROOFS,
  },
  teams: { proofs: TEAMS_PROOFS },
  twilio: { secrets: { username: TWILIO_ACCOUNT }, proofs: TWILIO_PROOFS },
};

/** A file a live body handed `ctx.files.store`, as it handed it over. */
interface StoredFile {
  fileName: string;
  contentType: string;
  encoding: 'base64' | 'utf-8';
  data: string;
}

/**
 * The host a live body calls, answering each request from `answers` with the
 * response the live host builds — the status, the headers, `text()`, and a
 * `json()` that throws on a body that is not JSON — so a refusal comes as
 * data rather than a throw, and noting each request made. A secret reads as
 * the credential holds it, and one it lacks as empty, as on a live call.
 *
 * It keeps files as a live call does by default, in the organization's
 * store, and notes each file a body stores. The store answers as the
 * platform's does — a ref, the file's name, type and size, and no link —
 * with the n-th synthetic ref for the n-th file stored.
 */
function proofHost(
  answers: ProofAnswers,
  secrets: Record<string, string> = {},
): {
  ctx: Pick<
    ConnectorContext,
    'http' | 'secrets' | 'base64Encode' | 'base64Decode'
  > & { files: Pick<NonNullable<ConnectorContext['files']>, 'store'> };
  asked: string[];
  stored: StoredFile[];
} {
  const asked: string[] = [];
  const stored: StoredFile[] = [];
  const answer =
    (method: string) =>
    async (url: string): Promise<ConnectorHttpResponse> => {
      const request = `${method} ${url}`;
      asked.push(request);
      if (!Object.hasOwn(answers, request)) {
        throw new Error(`the proof gives no answer for ${request}`);
      }
      const { status, headers = {}, body } = answers[request];
      return toConnectorResponse(
        status,
        headers,
        typeof body === 'string' ? body : JSON.stringify(body),
      );
    };
  const ctx = {
    http: {
      get: answer('GET'),
      post: answer('POST'),
      put: answer('PUT'),
      patch: answer('PATCH'),
      delete: answer('DELETE'),
    },
    secrets: { get: (name: string) => secrets[name] ?? '' },
    files: {
      store: async (
        data: string,
        { encoding, contentType, fileName }: Omit<StoredFile, 'data'>,
      ) => {
        stored.push({ fileName, contentType, encoding, data });
        const n = String(stored.length).padStart(12, '0');
        return {
          id: `s3:example-org/00000000-0000-0000-0000-${n}`,
          fileName,
          contentType,
          size: Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8')
            .byteLength,
        };
      },
    },
    base64Encode,
    base64Decode,
  };
  return { ctx, asked, stored };
}

/** What a live body came to: the output it returned, or what it threw. */
type Outcome = { output: unknown } | { thrown: unknown };

async function outcomeOf(run: Promise<unknown>): Promise<Outcome> {
  try {
    return { output: await run };
  } catch (thrown) {
    return { thrown };
  }
}

describe('a connector scenario fits its action and answers as the live call would [CONN-R33]', () => {
  it.each([...EXPECTED_SLUGS])(
    '%s: a when names only properties the action input declares',
    (slug) => {
      const undeclared: string[] = [];
      for (const action of loadConnector(slug).actions) {
        const declared = isRecord(action.input.properties)
          ? action.input.properties
          : {};
        for (const scenario of action.scenarios ?? []) {
          for (const member of Object.keys(scenario.when ?? {})) {
            if (Object.hasOwn(declared, member)) continue;
            undeclared.push(`${action.name}/${scenario.name}: when.${member}`);
          }
        }
      }
      expect(undeclared, `${slug}: when members no input declares`).toEqual([]);
    },
  );

  it.each([...EXPECTED_SLUGS])(
    '%s: every scenario output fits the output the action declares',
    (slug) => {
      const misfits: string[] = [];
      for (const action of loadConnector(slug).actions) {
        const answering = (action.scenarios ?? []).filter(
          (scenario) => scenario.output !== undefined,
        );
        if (answering.length === 0) continue;
        const signature = parseSignature(action.output);
        if ('error' in signature) {
          misfits.push(
            `${action.name}: its output signature does not read (${signature.error.message})`,
          );
          continue;
        }
        for (const scenario of answering) {
          // The engine's own test of a value against a shape, which fails
          // only a definite misfit: a member of another type, a required one
          // missing. Members the signature leaves out pass, as the live
          // bodies hand a service's records on whole, and so does a list
          // whose elements differ in shape once one of them fits; the
          // proofs below hold every element of a listed connector's.
          const mismatch = assignable(
            shapeOfValue(scenario.output),
            signature.shape,
          );
          if (mismatch === null) continue;
          const at =
            mismatch.path.length > 0 ? mismatch.path.join('.') : 'the output';
          misfits.push(
            `${action.name}/${scenario.name}: ${at} is ${mismatch.actual} where the signature says ${mismatch.expected}`,
          );
        }
      }
      expect(misfits, `${slug}: scenario outputs that do not fit`).toEqual([]);
    },
  );

  it.each([...SCENARIO_CONNECTORS])(
    '%s: every action ships at least the scenario kinds its effect needs',
    (slug) => {
      const lacking = loadConnector(slug).actions.flatMap((action) => {
        const missing = missingScenarioKinds(action);
        return missing.length === 0
          ? []
          : [`${action.name} (${action.effects}) lacks ${missing.join(', ')}`];
      });
      expect(lacking, `${slug} is on SCENARIO_CONNECTORS`).toEqual([]);
    },
  );

  it('a connector whose every action ships the minimum kinds is on the list', () => {
    const listed = new Set<string>(SCENARIO_CONNECTORS);
    const complete = EXPECTED_SLUGS.filter(
      (slug) =>
        !listed.has(slug) &&
        loadConnector(slug).actions.every(
          (action) => missingScenarioKinds(action).length === 0,
        ),
    );
    expect(complete, 'add them to SCENARIO_CONNECTORS').toEqual([]);
  });

  it('every connector on the scenario list is a shipped one', () => {
    const shipped = new Set<string>(EXPECTED_SLUGS);
    expect(SCENARIO_CONNECTORS.filter((slug) => !shipped.has(slug))).toEqual(
      [],
    );
  });

  it.each([...SCENARIO_CONNECTORS])(
    '%s: every scenario has a proof, and every proof names a scenario',
    (slug) => {
      const scenarios = loadConnector(slug).actions.flatMap((action) =>
        (action.scenarios ?? []).map(
          (scenario) => `${action.name}/${scenario.name}`,
        ),
      );
      const proofs = Object.keys(SCENARIO_PROOFS[slug].proofs);
      const storing = Object.keys(SCENARIO_PROOFS[slug].stored ?? {});
      const shipped = new Set(scenarios);
      const proven = new Set(proofs);
      expect({
        unproven: scenarios.filter((key) => !proven.has(key)),
        stale: [...proofs, ...storing].filter((key) => !shipped.has(key)),
      }).toEqual({ unproven: [], stale: [] });
    },
  );

  // A live body throws with the vendor's status when the answer's HTTP
  // status fails the call (OpenRouter's 401 and 402, a rate limit's 429), and
  // with none for an answer the vendor refuses in its body (Slack's
  // `ok: false`), so a run classifies a live 429 as unavailable; the scenario
  // that stands for either names the same status.
  it.each(
    SCENARIO_CONNECTORS.flatMap((slug) =>
      Object.keys(SCENARIO_PROOFS[slug].proofs).map(
        (key): [ScenarioConnector, string] => [slug, key],
      ),
    ),
  )(
    '%s %s: the live body, given the answer the scenario stands for, returns its output or throws its error',
    async (slug, key) => {
      const [actionName, scenarioName] = key.split('/');
      const connector = loadConnector(slug);
      const action = connector.actions.find((a) => a.name === actionName);
      const scenario = action?.scenarios?.find((s) => s.name === scenarioName);
      if (action?.backend?.kind !== 'yaml-js' || scenario === undefined) {
        throw new Error(
          `${slug}.${actionName} has no live body or no ${scenarioName} scenario`,
        );
      }
      const { secrets, proofs, stored: storing } = SCENARIO_PROOFS[slug];
      const answers = proofs[key];
      const { ctx, asked, stored } = proofHost(answers, secrets);
      const outcome = await outcomeOf(
        inProcessLiveRunner().runBody(
          connectorLiveBody(connector, action.backend.live),
          { input: { ...action.exampleInput, ...scenario.when }, ctx },
          LIMITS,
          { async: true },
        ),
      );

      // The body made every request the proof answers, in its order, and
      // stored the files the proof names, as it handed them over.
      expect(asked).toEqual(Object.keys(answers));
      expect(stored).toEqual(storing?.[key] ?? []);
      if (scenario.error === undefined) {
        expect(outcome).toEqual({ output: scenario.output });
        return;
      }
      if (!('thrown' in outcome)) {
        throw new Error(
          `${slug}.${key} returned ${JSON.stringify(outcome.output)} where the scenario throws`,
        );
      }
      const { thrown } = outcome;
      const { message, status } = scenario.error;
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : thrown).toBe(message);
      expect(
        isRecord(thrown) && typeof thrown.status === 'number'
          ? thrown.status
          : undefined,
      ).toBe(status);
      // A run classifies the scenario's error exactly as the live body's:
      // the same reason, status and error class.
      const simulated = Object.assign(
        new Error(message),
        status !== undefined ? { status } : {},
      );
      expect(
        connectorFailureOf(thrown, slug, `${slug}.${actionName}`),
      ).toStrictEqual(
        connectorFailureOf(simulated, slug, `${slug}.${actionName}`),
      );
    },
  );
});
