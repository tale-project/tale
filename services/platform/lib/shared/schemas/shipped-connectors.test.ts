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
 * fits its action, a connector on the scenario list ships the kinds every
 * action needs, and Slack's — the reference — are proven against the live
 * body, so a scenario answers what a live call in that case does.
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
import { connectorFailureOf } from '../../engine/core/record/failure';
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
 * effect needs (`MINIMUM_SCENARIO_KINDS`). A connector is added once all its
 * actions do and is never removed: tests pick its scenarios by name, so the
 * list only grows. */
const SCENARIO_CONNECTORS = ['slack'] as const;

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

/** One answer Slack gives a POST: the HTTP status, the headers, and the body
 * — JSON, or the plain text files.slack.com answers an upload with. */
interface SlackAnswer {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

const SLACK_API = 'https://slack.com/api';
const UPLOAD_URL = 'https://files.slack.com/upload/v1/EXAMPLE0000000001';
const SECOND_UPLOAD_URL = 'https://files.slack.com/upload/v1/EXAMPLE0000000002';

/** A call Slack carried out: HTTP 200 and `ok: true`. */
function slackOk(body: Record<string, unknown>): SlackAnswer {
  return { status: 200, body: { ok: true, ...body } };
}

/** A call Slack refused: HTTP 200 as well, with `ok: false` and the error's
 * code — which is why every body checks `ok`, not only the status. */
function slackError(error: string): SlackAnswer {
  return { status: 200, body: { ok: false, error } };
}

/** A rate limit is the refusal with a status of its own: 429, and the
 * seconds to wait in Retry-After. */
const SLACK_RATE_LIMITED: SlackAnswer = {
  status: 429,
  headers: { 'retry-after': '30' },
  body: { ok: false, error: 'ratelimited' },
};

/** What an upload URL answers once it holds the bytes: their count, as text
 * (the example input's content is 48 characters). */
const SLACK_UPLOADED: SlackAnswer = { status: 200, body: 'OK - 48' };

/**
 * The proof of every Slack scenario, keyed `<action>/<scenario>`: the answer
 * Slack gives each POST the live body makes, by URL and in the order the body
 * makes them, when its input is the action's example input with the
 * scenario's `when` laid over it. An answer carries the members the action's
 * output names; the bodies hand Slack's records on as they come, so the
 * further members a real answer holds would ride along.
 */
const SLACK_PROOFS: Record<string, Record<string, SlackAnswer>> = {
  'list_channels/two_channels': {
    [`${SLACK_API}/conversations.list`]: slackOk({
      channels: [
        { id: 'C0000000001', name: 'general', is_private: false },
        { id: 'C0000000002', name: 'deploys', is_private: false },
      ],
      // The last page carries an empty cursor; the body answers null.
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_channels/no_channels': {
    [`${SLACK_API}/conversations.list`]: slackOk({
      channels: [],
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_channels/invalid_auth': {
    [`${SLACK_API}/conversations.list`]: slackError('invalid_auth'),
  },
  'get_channel/one_channel': {
    [`${SLACK_API}/conversations.info`]: slackOk({
      channel: {
        id: 'C0000000001',
        name: 'general',
        is_private: false,
        topic: { value: 'Company-wide announcements.' },
      },
    }),
  },
  'get_channel/no_topic': {
    [`${SLACK_API}/conversations.info`]: slackOk({
      channel: {
        id: 'C0000000002',
        name: 'random',
        is_private: false,
        topic: { value: '' },
      },
    }),
  },
  'get_channel/channel_not_found': {
    [`${SLACK_API}/conversations.info`]: slackError('channel_not_found'),
  },
  'get_channel/invalid_auth': {
    [`${SLACK_API}/conversations.info`]: slackError('invalid_auth'),
  },
  'list_messages/two_messages': {
    [`${SLACK_API}/conversations.history`]: slackOk({
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
    [`${SLACK_API}/conversations.history`]: slackOk({
      messages: [],
      has_more: false,
    }),
  },
  'list_messages/not_in_channel': {
    [`${SLACK_API}/conversations.history`]: slackError('not_in_channel'),
  },
  'send_message/posted': {
    [`${SLACK_API}/chat.postMessage`]: slackOk({
      channel: 'C0000000001',
      ts: '1700000000.000100',
    }),
  },
  'send_message/posted_again': {
    [`${SLACK_API}/chat.postMessage`]: slackOk({
      channel: 'C0000000001',
      ts: '1700000000.000200',
    }),
  },
  'send_message/not_in_channel': {
    [`${SLACK_API}/chat.postMessage`]: slackError('not_in_channel'),
  },
  'send_message/channel_not_found': {
    [`${SLACK_API}/chat.postMessage`]: slackError('channel_not_found'),
  },
  'send_message/rate_limited': {
    [`${SLACK_API}/chat.postMessage`]: SLACK_RATE_LIMITED,
  },
  'list_users/two_members': {
    [`${SLACK_API}/users.list`]: slackOk({
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
    [`${SLACK_API}/users.list`]: slackOk({
      members: [],
      response_metadata: { next_cursor: '' },
    }),
  },
  'list_users/rate_limited': {
    [`${SLACK_API}/users.list`]: SLACK_RATE_LIMITED,
  },
  'get_user/one_user': {
    [`${SLACK_API}/users.info`]: slackOk({
      user: {
        id: 'U0000000001',
        name: 'alex.example',
        real_name: 'Alex Example',
        is_bot: false,
      },
    }),
  },
  'get_user/no_real_name': {
    [`${SLACK_API}/users.info`]: slackOk({
      user: {
        id: 'U0000000003',
        name: 'sam.example',
        real_name: '',
        is_bot: false,
      },
    }),
  },
  'get_user/user_not_found': {
    [`${SLACK_API}/users.info`]: slackError('user_not_found'),
  },
  'get_user/invalid_auth': {
    [`${SLACK_API}/users.info`]: slackError('invalid_auth'),
  },
  // Slack's three-step upload: reserve an upload URL and a file id, send the
  // bytes there, then complete the upload, which shares the file.
  'upload_file/uploaded': {
    [`${SLACK_API}/files.getUploadURLExternal`]: slackOk({
      upload_url: UPLOAD_URL,
      file_id: 'F0000000001',
    }),
    [UPLOAD_URL]: SLACK_UPLOADED,
    [`${SLACK_API}/files.completeUploadExternal`]: slackOk({
      files: [{ id: 'F0000000001', title: 'report.txt' }],
    }),
  },
  'upload_file/uploaded_again': {
    [`${SLACK_API}/files.getUploadURLExternal`]: slackOk({
      upload_url: SECOND_UPLOAD_URL,
      file_id: 'F0000000002',
    }),
    [SECOND_UPLOAD_URL]: SLACK_UPLOADED,
    [`${SLACK_API}/files.completeUploadExternal`]: slackOk({
      files: [{ id: 'F0000000002', title: 'report.txt' }],
    }),
  },
  'upload_file/not_in_channel': {
    [`${SLACK_API}/files.getUploadURLExternal`]: slackOk({
      upload_url: UPLOAD_URL,
      file_id: 'F0000000001',
    }),
    [UPLOAD_URL]: SLACK_UPLOADED,
    [`${SLACK_API}/files.completeUploadExternal`]: slackError('not_in_channel'),
  },
};

/**
 * The host a live body calls, answering each POST from `answers` the way the
 * live host does — the status, lower-cased headers, `text()` and `json()`,
 * with a refusal as data rather than a throw — and noting each URL asked.
 */
function slackHost(answers: Record<string, SlackAnswer>): {
  ctx: unknown;
  asked: string[];
} {
  const asked: string[] = [];
  const ctx = {
    http: {
      post: async (url: string) => {
        asked.push(url);
        if (!Object.hasOwn(answers, url)) {
          throw new Error(`the proof gives no Slack answer for POST ${url}`);
        }
        const { status, headers = {}, body } = answers[url];
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return {
          status,
          headers,
          text: () => text,
          json: (): unknown => JSON.parse(text),
        };
      },
    },
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
          // proofs below hold every element of Slack's.
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

  it('slack: every scenario has a proof, and every proof names a scenario', () => {
    const scenarios = loadConnector('slack').actions.flatMap((action) =>
      (action.scenarios ?? []).map(
        (scenario) => `${action.name}/${scenario.name}`,
      ),
    );
    const proofs = Object.keys(SLACK_PROOFS);
    const shipped = new Set(scenarios);
    const proven = new Set(proofs);
    expect({
      unproven: scenarios.filter((key) => !proven.has(key)),
      stale: proofs.filter((key) => !shipped.has(key)),
    }).toEqual({ unproven: [], stale: [] });
  });

  // Slack's live bodies throw plain Errors, a rate limit's too: no status
  // rides along, so a run classifies a live 429 as it does any other
  // failure, and the scenario that stands for one names no status either.
  // A body that starts carrying a status fails here until its scenarios do.
  it.each(Object.keys(SLACK_PROOFS))(
    'slack %s: the live body, given the answer the scenario stands for, returns its output or throws its error',
    async (key) => {
      const [actionName, scenarioName] = key.split('/');
      const slack = loadConnector('slack');
      const action = slack.actions.find((a) => a.name === actionName);
      const scenario = action?.scenarios?.find((s) => s.name === scenarioName);
      if (action?.backend?.kind !== 'yaml-js' || scenario === undefined) {
        throw new Error(
          `slack.${actionName} has no live body or no ${scenarioName} scenario`,
        );
      }
      const answers = SLACK_PROOFS[key];
      const { ctx, asked } = slackHost(answers);
      const outcome = await outcomeOf(
        inProcessLiveRunner().runBody(
          connectorLiveBody(slack, action.backend.live),
          { input: { ...action.exampleInput, ...scenario.when }, ctx },
          LIMITS,
          { async: true },
        ),
      );

      // The body asked for every answer the proof gives, in its order.
      expect(asked).toEqual(Object.keys(answers));
      if (scenario.error === undefined) {
        expect(outcome).toEqual({ output: scenario.output });
        return;
      }
      if (!('thrown' in outcome)) {
        throw new Error(
          `slack.${key} returned ${JSON.stringify(outcome.output)} where the scenario throws`,
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
        connectorFailureOf(thrown, 'slack', `slack.${actionName}`),
      ).toStrictEqual(
        connectorFailureOf(simulated, 'slack', `slack.${actionName}`),
      );
    },
  );
});
