/**
 * How one request is told to be modern (2026-07-28) or legacy, and how a
 * modern one is judged before anything runs: the order of the refusals is
 * what a client speaking both eras reads to decide whether to correct the
 * request or fall back to `initialize`.
 */

import { describe, expect, it } from 'vitest';

import {
  claimsModernEnvelope,
  decodeMirroredHeader,
  type EraHeaders,
  isModernMessage,
  judgeModernRequest,
  unsupportedVersion,
} from './eras';

const MODERN = '2026-07-28';

function meta(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN,
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'codex', version: '0.161.0' },
    ...overrides,
  };
}

function headers(overrides: Partial<EraHeaders> = {}): EraHeaders {
  return {
    protocolVersion: MODERN,
    method: 'tools/call',
    name: 'get_run',
    ...overrides,
  };
}

const getRun = (m: Record<string, unknown> = meta()) => ({
  name: 'get_run',
  arguments: { runId: 'r1' },
  _meta: m,
});

describe('which era a message is served on [MCP-R26]', () => {
  it('is modern when its _meta names a revision, or its header names a modern one', () => {
    const legacyHeaders: EraHeaders = {
      protocolVersion: '2025-11-25',
      method: null,
      name: null,
    };
    const none: EraHeaders = {
      protocolVersion: null,
      method: null,
      name: null,
    };
    const envelope = { params: { _meta: meta() } };
    expect(isModernMessage(envelope, none)).toBe(true);
    expect(isModernMessage({ params: {} }, headers())).toBe(true);
    expect(isModernMessage({ params: {} }, legacyHeaders)).toBe(false);
    expect(isModernMessage({ params: {} }, none)).toBe(false);
    // A legacy client's _meta carries a progress token, never a revision.
    expect(
      claimsModernEnvelope({ params: { _meta: { progressToken: 1 } } }),
    ).toBe(false);
    expect(claimsModernEnvelope('not a message')).toBe(false);
  });
});

describe('judging a modern request before it runs [MCP-R26]', () => {
  it('serves a request whose headers say what its body says, as the client it names', () => {
    expect(judgeModernRequest('tools/call', getRun(), headers())).toEqual({
      kind: 'served',
      version: MODERN,
      clientName: 'codex',
    });
    // A method that names nothing needs no Mcp-Name, and a client that gives
    // no name is served without one.
    expect(
      judgeModernRequest(
        'tools/list',
        {
          _meta: meta({ 'io.modelcontextprotocol/clientInfo': undefined }),
        },
        headers({ method: 'tools/list', name: null }),
      ),
    ).toEqual({ kind: 'served', version: MODERN, clientName: null });
  });

  it('refuses a header and a body that name two revisions first, as -32020', () => {
    const verdict = judgeModernRequest(
      'tools/call',
      getRun(meta({ 'io.modelcontextprotocol/protocolVersion': '2027-01-01' })),
      headers(),
    );
    expect(verdict).toMatchObject({ kind: 'refused', code: -32020 });
  });

  it('refuses a missing or malformed envelope as -32602, naming each key', () => {
    expect(
      judgeModernRequest('tools/list', {}, headers({ method: 'tools/list' })),
    ).toMatchObject({
      kind: 'refused',
      code: -32602,
      data: {
        missing: [
          'io.modelcontextprotocol/protocolVersion',
          'io.modelcontextprotocol/clientCapabilities',
        ],
      },
    });
    expect(
      judgeModernRequest(
        'tools/call',
        getRun(
          meta({
            'io.modelcontextprotocol/clientCapabilities': [],
            'io.modelcontextprotocol/clientInfo': 'codex',
          }),
        ),
        headers(),
      ),
    ).toMatchObject({
      kind: 'refused',
      code: -32602,
      data: {
        malformed: [
          'io.modelcontextprotocol/clientCapabilities',
          'io.modelcontextprotocol/clientInfo',
        ],
      },
    });
  });

  it('refuses a revision it does not speak as -32022, and says a legacy one is opened with initialize [MCP-R16]', () => {
    const unknown = judgeModernRequest(
      'tools/call',
      getRun(meta({ 'io.modelcontextprotocol/protocolVersion': '2027-01-01' })),
      headers({ protocolVersion: '2027-01-01' }),
    );
    expect(unknown).toMatchObject({
      kind: 'refused',
      code: -32022,
      data: {
        supported: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
        requested: '2027-01-01',
      },
    });
    const legacy = judgeModernRequest(
      'tools/call',
      getRun(meta({ 'io.modelcontextprotocol/protocolVersion': '2025-11-25' })),
      headers({ protocolVersion: '2025-11-25' }),
    );
    expect(legacy).toMatchObject({ kind: 'refused', code: -32022 });
    expect(legacy.kind === 'refused' ? legacy.message : '').toContain(
      'initialize',
    );
  });

  it('bounds what it repeats of a revision', () => {
    const long = 'x'.repeat(5000);
    expect(unsupportedVersion(long).data.requested).toHaveLength(128);
    expect(unsupportedVersion(long).message.length).toBeLessThan(200);
  });

  it('refuses a missing or contradicting standard header as -32020, after the revision', () => {
    for (const [label, sent] of [
      ['no revision header', headers({ protocolVersion: null })],
      ['no method header', headers({ method: null })],
      ['another method', headers({ method: 'tools/list' })],
      ['no name header', headers({ name: null })],
      ['another name', headers({ name: 'cancel_run' })],
    ] as const) {
      expect(
        judgeModernRequest('tools/call', getRun(), sent),
        label,
      ).toMatchObject({ kind: 'refused', code: -32020 });
    }
    // The address of a read is its name.
    expect(
      judgeModernRequest(
        'resources/read',
        { uri: 'tale://runs/r1', _meta: meta() },
        headers({ method: 'resources/read', name: 'tale://runs/r2' }),
      ),
    ).toMatchObject({ kind: 'refused', code: -32020 });
    expect(
      judgeModernRequest(
        'prompts/get',
        { name: 'add_trigger', _meta: meta() },
        headers({ method: 'prompts/get', name: 'add_trigger' }),
      ),
    ).toMatchObject({ kind: 'served' });
  });
});

describe('a mirrored header value', () => {
  it('reads a plain value as sent', () => {
    expect(decodeMirroredHeader('tools/call')).toBe('tools/call');
    expect(decodeMirroredHeader('tale://automations/billing%2Fdunning')).toBe(
      'tale://automations/billing%2Fdunning',
    );
  });

  it('decodes MCP’s Base64 form as UTF-8, a sentinel-shaped literal included', () => {
    const encode = (text: string) =>
      `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`;
    expect(decodeMirroredHeader(encode('tale://automations/préavis'))).toBe(
      'tale://automations/préavis',
    );
    expect(decodeMirroredHeader(encode('=?base64?literal?='))).toBe(
      '=?base64?literal?=',
    );
    expect(decodeMirroredHeader('=?base64??=')).toBe('');
  });

  it('refuses a value a header cannot carry plainly, Base64 that is not, and bytes that are not UTF-8', () => {
    expect(decodeMirroredHeader('préavis')).toBeNull();
    expect(decodeMirroredHeader('line\nbreak')).toBeNull();
    expect(decodeMirroredHeader('=?base64?not base64?=')).toBeNull();
    expect(decodeMirroredHeader('=?base64?abc?=')).toBeNull();
    expect(
      decodeMirroredHeader(
        `=?base64?${Buffer.from([0xff, 0xfe]).toString('base64')}?=`,
      ),
    ).toBeNull();
  });
});
