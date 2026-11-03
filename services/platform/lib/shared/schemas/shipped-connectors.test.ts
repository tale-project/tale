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
  createLiveHost,
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
  'jev',
  'shopify',
  'slack',
  'tavily',
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

/** The store a Shopify credential points at, which the live host hands the
 * bodies as `ctx.endpoint`, and the Admin API version they call there. */
const SHOPIFY_STORE = 'https://example-store.myshopify.com';
const SHOPIFY_API = `${SHOPIFY_STORE}/admin/api/2026-01`;

/** The one GET each Shopify action makes for its example input. */
const SHOPIFY_REQUESTS = {
  list_products: `GET ${SHOPIFY_API}/products.json?limit=50&status=active`,
  get_product: `GET ${SHOPIFY_API}/products/8123456789012.json`,
  list_customers: `GET ${SHOPIFY_API}/customers.json?limit=50`,
  get_customer: `GET ${SHOPIFY_API}/customers/7123456789012.json`,
  list_orders: `GET ${SHOPIFY_API}/orders.json?limit=50&status=any`,
  get_order: `GET ${SHOPIFY_API}/orders/5123456789012.json`,
  count_products: `GET ${SHOPIFY_API}/products/count.json`,
  count_customers: `GET ${SHOPIFY_API}/customers/count.json`,
  count_orders: `GET ${SHOPIFY_API}/orders/count.json`,
} as const;

/** A call Shopify carried out: HTTP 200 and what was asked for, under the
 * resource's name. */
function shopifyOk(body: Record<string, unknown>): ServiceAnswer {
  return { status: 200, body };
}

/** A list page with a further one, which Shopify names in the Link header:
 * the URL of the same list, with the next page's cursor as `page_info`. */
function shopifyPage(
  resource: string,
  records: Record<string, unknown>[],
  pageInfo: string,
): ServiceAnswer {
  return {
    status: 200,
    headers: {
      link: `<${SHOPIFY_API}/${resource}.json?page_info=${pageInfo}&limit=50>; rel="next"`,
    },
    body: { [resource]: records },
  };
}

/** A call Shopify refused: the status, and its errors in the body, which the
 * live bodies hand on only for a status they do not name. */
function shopifyError(status: number, errors: string): ServiceAnswer {
  return { status, body: { errors } };
}

/** What Shopify answers an access token it does not accept. */
const SHOPIFY_INVALID_TOKEN = shopifyError(
  401,
  '[API] Invalid API key or access token (unrecognized login or wrong password)',
);

/** A rate limit: 429, and the seconds to wait in Retry-After. */
const SHOPIFY_RATE_LIMITED: ServiceAnswer = {
  ...shopifyError(
    429,
    'Exceeded 2 calls per second for api client. Reduce request rates to resume uninterrupted service.',
  ),
  headers: { 'retry-after': '2.0' },
};

/** The proofs of the two refusals every Shopify action ships under the same
 * names, `invalid_token` and `rate_limited`: Shopify's answer to the one
 * request the action makes. */
function shopifyRefusals(
  action: keyof typeof SHOPIFY_REQUESTS,
): Record<string, ProofAnswers> {
  const request = SHOPIFY_REQUESTS[action];
  return {
    [`${action}/invalid_token`]: { [request]: SHOPIFY_INVALID_TOKEN },
    [`${action}/rate_limited`]: { [request]: SHOPIFY_RATE_LIMITED },
  };
}

/**
 * The proof of every Shopify scenario, keyed as Slack's are: Shopify's answer
 * to the one GET the live body makes, at the store the credential points at.
 * An answer carries the members the action's output names; the bodies hand
 * Shopify's records on as they come, so the further members a real answer
 * holds would ride along.
 */
const SHOPIFY_PROOFS: Record<string, ProofAnswers> = {
  'list_products/two_products': {
    [SHOPIFY_REQUESTS.list_products]: shopifyOk({
      products: [
        {
          id: 8123456789013,
          title: 'Stoneware mug',
          handle: 'stoneware-mug',
          status: 'active',
          created_at: '2026-03-02T10:15:00-05:00',
        },
        {
          id: 8123456789012,
          title: 'Linen apron',
          handle: 'linen-apron',
          status: 'active',
          created_at: '2026-02-27T16:40:00-05:00',
        },
      ],
    }),
  },
  'list_products/more_pages': {
    [SHOPIFY_REQUESTS.list_products]: shopifyPage(
      'products',
      [
        {
          id: 8123456789015,
          title: 'Wool throw',
          handle: 'wool-throw',
          status: 'active',
          created_at: '2026-03-09T11:00:00-05:00',
        },
        {
          id: 8123456789014,
          title: 'Oak serving board',
          handle: 'oak-serving-board',
          status: 'active',
          created_at: '2026-03-06T08:45:00-05:00',
        },
      ],
      'eyJkaXJlY3Rpb24iOiJuZXh0IiwibGFzdF9pZCI6ODEyMzQ1Njc4OTAxNH0',
    ),
  },
  'list_products/no_products': {
    [SHOPIFY_REQUESTS.list_products]: shopifyOk({ products: [] }),
  },
  ...shopifyRefusals('list_products'),
  'get_product/one_product': {
    [SHOPIFY_REQUESTS.get_product]: shopifyOk({
      product: {
        id: 8123456789012,
        title: 'Linen apron',
        handle: 'linen-apron',
        status: 'active',
        variants: [
          {
            id: 45123456789012,
            title: 'Natural',
            price: '34.00',
            sku: 'APRON-NAT',
          },
          {
            id: 45123456789013,
            title: 'Charcoal',
            price: '34.00',
            sku: 'APRON-CHA',
          },
        ],
      },
    }),
  },
  'get_product/no_sku': {
    [SHOPIFY_REQUESTS.get_product]: shopifyOk({
      product: {
        id: 8123456789012,
        title: 'Linen apron',
        handle: 'linen-apron',
        status: 'draft',
        variants: [
          {
            id: 45123456789014,
            title: 'Default Title',
            price: '34.00',
            sku: '',
          },
        ],
      },
    }),
  },
  'get_product/product_not_found': {
    [`GET ${SHOPIFY_API}/products/8123456789099.json`]: shopifyError(
      404,
      'Not Found',
    ),
  },
  ...shopifyRefusals('get_product'),
  'list_customers/two_customers': {
    [SHOPIFY_REQUESTS.list_customers]: shopifyOk({
      customers: [
        {
          id: 7123456789013,
          email: 'sam@example.com',
          first_name: 'Sam',
          last_name: 'Example',
          orders_count: 1,
        },
        {
          id: 7123456789012,
          email: 'alex@example.com',
          first_name: 'Alex',
          last_name: 'Example',
          orders_count: 3,
        },
      ],
    }),
  },
  'list_customers/more_pages': {
    [SHOPIFY_REQUESTS.list_customers]: shopifyPage(
      'customers',
      [
        {
          id: 7123456789015,
          email: 'kim@example.com',
          first_name: 'Kim',
          last_name: 'Example',
          orders_count: 0,
        },
        {
          id: 7123456789014,
          email: 'lee@example.com',
          first_name: 'Lee',
          last_name: 'Example',
          orders_count: 2,
        },
      ],
      'eyJkaXJlY3Rpb24iOiJuZXh0IiwibGFzdF9pZCI6NzEyMzQ1Njc4OTAxNH0',
    ),
  },
  'list_customers/no_customers': {
    [SHOPIFY_REQUESTS.list_customers]: shopifyOk({ customers: [] }),
  },
  ...shopifyRefusals('list_customers'),
  'get_customer/one_customer': {
    [SHOPIFY_REQUESTS.get_customer]: shopifyOk({
      customer: {
        id: 7123456789012,
        email: 'alex@example.com',
        first_name: 'Alex',
        last_name: 'Example',
        orders_count: 3,
        total_spent: '102.00',
      },
    }),
  },
  'get_customer/no_orders': {
    [SHOPIFY_REQUESTS.get_customer]: shopifyOk({
      customer: {
        id: 7123456789012,
        email: 'alex@example.com',
        first_name: 'Alex',
        last_name: 'Example',
        orders_count: 0,
        total_spent: '0.00',
      },
    }),
  },
  'get_customer/customer_not_found': {
    [`GET ${SHOPIFY_API}/customers/7123456789099.json`]: shopifyError(
      404,
      'Not Found',
    ),
  },
  ...shopifyRefusals('get_customer'),
  'list_orders/two_orders': {
    [SHOPIFY_REQUESTS.list_orders]: shopifyOk({
      orders: [
        {
          id: 5123456789013,
          name: '#1002',
          total_price: '18.00',
          financial_status: 'paid',
          fulfillment_status: 'partial',
          created_at: '2026-03-03T09:30:00-05:00',
        },
        {
          id: 5123456789012,
          name: '#1001',
          total_price: '68.00',
          financial_status: 'paid',
          fulfillment_status: 'fulfilled',
          created_at: '2026-03-01T14:05:00-05:00',
        },
      ],
    }),
  },
  'list_orders/more_pages': {
    [SHOPIFY_REQUESTS.list_orders]: shopifyPage(
      'orders',
      [
        {
          id: 5123456789015,
          name: '#1004',
          total_price: '34.00',
          financial_status: 'paid',
          fulfillment_status: 'fulfilled',
          created_at: '2026-03-08T12:00:00-05:00',
        },
        {
          id: 5123456789014,
          name: '#1003',
          total_price: '24.00',
          financial_status: 'refunded',
          fulfillment_status: 'restocked',
          created_at: '2026-03-05T17:20:00-05:00',
        },
      ],
      'eyJkaXJlY3Rpb24iOiJuZXh0IiwibGFzdF9pZCI6NTEyMzQ1Njc4OTAxNH0',
    ),
  },
  'list_orders/no_orders': {
    [SHOPIFY_REQUESTS.list_orders]: shopifyOk({ orders: [] }),
  },
  ...shopifyRefusals('list_orders'),
  'get_order/one_order': {
    [SHOPIFY_REQUESTS.get_order]: shopifyOk({
      order: {
        id: 5123456789012,
        name: '#1001',
        total_price: '68.00',
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        line_items: [
          {
            id: 13123456789012,
            title: 'Linen apron',
            quantity: 2,
            price: '34.00',
          },
        ],
      },
    }),
  },
  'get_order/nothing_to_pay': {
    [SHOPIFY_REQUESTS.get_order]: shopifyOk({
      order: {
        id: 5123456789012,
        name: '#1001',
        total_price: '0.00',
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        line_items: [
          {
            id: 13123456789013,
            title: 'Fabric swatch',
            quantity: 1,
            price: '0.00',
          },
        ],
      },
    }),
  },
  'get_order/order_not_found': {
    [`GET ${SHOPIFY_API}/orders/5123456789099.json`]: shopifyError(
      404,
      'Not Found',
    ),
  },
  ...shopifyRefusals('get_order'),
  'count_products/four_products': {
    [SHOPIFY_REQUESTS.count_products]: shopifyOk({ count: 4 }),
  },
  'count_products/no_products': {
    [SHOPIFY_REQUESTS.count_products]: shopifyOk({ count: 0 }),
  },
  ...shopifyRefusals('count_products'),
  'count_customers/four_customers': {
    [SHOPIFY_REQUESTS.count_customers]: shopifyOk({ count: 4 }),
  },
  'count_customers/no_customers': {
    [SHOPIFY_REQUESTS.count_customers]: shopifyOk({ count: 0 }),
  },
  ...shopifyRefusals('count_customers'),
  'count_orders/four_orders': {
    [SHOPIFY_REQUESTS.count_orders]: shopifyOk({ count: 4 }),
  },
  'count_orders/no_orders': {
    [SHOPIFY_REQUESTS.count_orders]: shopifyOk({ count: 0 }),
  },
  ...shopifyRefusals('count_orders'),
};

/** What a listed connector's credential holds, as the proofs hand it to the
 * live body: the secrets it reads through `ctx.secrets` and, for a
 * per-credential connector, the endpoint it points at. */
interface ProofCredential {
  secrets?: Record<string, string>;
  endpoint?: string;
}

/**
 * Every listed connector's proofs, with what its credential holds —
 * synthetic, as every answer is. A connector joins `SCENARIO_CONNECTORS` with
 * its proofs, or this does not type-check.
 */
const SCENARIO_PROOFS: Record<
  ScenarioConnector,
  ProofCredential & { proofs: Record<string, ProofAnswers> }
> = {
  jev: {
    secrets: { apiKey: 'example-openrouter-key' },
    proofs: JEV_PROOFS,
  },
  shopify: {
    secrets: { accessToken: 'shpat_example' },
    endpoint: SHOPIFY_STORE,
    proofs: SHOPIFY_PROOFS,
  },
  slack: { proofs: SLACK_PROOFS },
  tavily: {
    secrets: { apiKey: 'example-tavily-key' },
    proofs: TAVILY_PROOFS,
  },
  twilio: { secrets: { username: TWILIO_ACCOUNT }, proofs: TWILIO_PROOFS },
};

/**
 * The host a live body calls, answering each request from `answers` with the
 * response the live host builds — the status, the headers, `text()`, and a
 * `json()` that throws on a body that is not JSON — so a refusal comes as
 * data rather than a throw, and noting each request made. A secret reads as
 * the credential holds it, and one it lacks as empty, as on a live call; the
 * endpoint is the one the live host derives from the credential's — checked
 * against the connector's allowed hosts and cut to its origin — and absent
 * when the credential names none.
 */
function proofHost(
  connector: Connector,
  answers: ProofAnswers,
  { secrets = {}, endpoint: credentialEndpoint }: ProofCredential = {},
): {
  ctx: Pick<ConnectorContext, 'endpoint' | 'http' | 'secrets'>;
  asked: string[];
} {
  const { endpoint } = createLiveHost({
    connector,
    endpoint: credentialEndpoint,
  });
  const asked: string[] = [];
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
    ...(endpoint !== undefined && { endpoint }),
    http: {
      get: answer('GET'),
      post: answer('POST'),
      put: answer('PUT'),
      patch: answer('PATCH'),
      delete: answer('DELETE'),
    },
    secrets: { get: (name: string) => secrets[name] ?? '' },
  };
  return { ctx, asked };
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
      const shipped = new Set(scenarios);
      const proven = new Set(proofs);
      expect({
        unproven: scenarios.filter((key) => !proven.has(key)),
        stale: proofs.filter((key) => !shipped.has(key)),
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
      const { proofs, ...credential } = SCENARIO_PROOFS[slug];
      const answers = proofs[key];
      const { ctx, asked } = proofHost(connector, answers, credential);
      const outcome = await outcomeOf(
        inProcessLiveRunner().runBody(
          connectorLiveBody(connector, action.backend.live),
          { input: { ...action.exampleInput, ...scenario.when }, ctx },
          LIMITS,
          { async: true },
        ),
      );

      // The body made every request the proof answers, in its order.
      expect(asked).toEqual(Object.keys(answers));
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
