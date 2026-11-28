import { describe, expect, it } from 'bun:test';

import {
  parseSessionView,
  SESSION_VIEW_ENV,
  SessionView,
  SessionViewError,
  loadSessionView,
} from './session-view.ts';

const REAL = '/var/lib/tale-sandbox/sessions/ses_abc';
const GATEWAY = 'http://sandbox-llm-gateway:8080';
const LOCAL_GATEWAY = 'http://127.0.0.1:41080';
const API = 'http://backend-api:3005';
const LOCAL_API = 'http://127.0.0.1:41005';

function view(): SessionView {
  return new SessionView({
    root: '/agent',
    real: REAL,
    origins: [
      [GATEWAY, LOCAL_GATEWAY],
      [API, LOCAL_API],
    ],
  });
}

describe('parseSessionView', () => {
  it('reads no view where none is set (a container)', () => {
    expect(parseSessionView(undefined)).toBeNull();
    expect(parseSessionView('')).toBeNull();
    expect(loadSessionView({}).active).toBe(false);
  });

  it('reads a raw session view', () => {
    const spec = parseSessionView(
      JSON.stringify({
        root: '/agent',
        real: REAL,
        origins: [[API, LOCAL_API]],
      }),
    );
    expect(spec).toEqual({
      root: '/agent',
      real: REAL,
      origins: [[API, LOCAL_API]],
    });
    expect(
      loadSessionView({ [SESSION_VIEW_ENV]: JSON.stringify(spec) }).active,
    ).toBe(true);
  });

  it.each([
    ['not JSON', '{'],
    ['a list', '[]'],
    ['a relative root', JSON.stringify({ root: 'agent', real: REAL })],
    ['a trailing slash', JSON.stringify({ root: '/agent', real: `${REAL}/` })],
    [
      'a space',
      JSON.stringify({ root: '/agent', real: '/var/lib/my sessions/a' }),
    ],
    ['a quote', JSON.stringify({ root: '/agent', real: '/var/"x"' })],
    [
      'a real root inside the contract root',
      JSON.stringify({ root: '/agent', real: '/agent/x' }),
    ],
    ['the same root', JSON.stringify({ root: '/agent', real: '/agent' })],
    [
      'an origin with a path',
      JSON.stringify({
        root: '/agent',
        real: REAL,
        origins: [[`${API}/api`, LOCAL_API]],
      }),
    ],
    [
      'an origin that is no pair',
      JSON.stringify({ root: '/agent', real: REAL, origins: [[API]] }),
    ],
  ])('refuses %s, so a raw session never starts untranslated', (_what, raw) => {
    expect(() => parseSessionView(raw)).toThrow(SessionViewError);
  });
});

describe('SessionView inbound', () => {
  const v = view();

  it('maps the contract root onto the real directory', () => {
    expect(v.inbound('/agent/workspace')).toBe(`${REAL}/workspace`);
    expect(v.inbound('/agent')).toBe(REAL);
    expect(v.inbound('/agent/')).toBe(`${REAL}/`);
    expect(v.inbound('cd /agent/workspace && ls /agent/uploads')).toBe(
      `cd ${REAL}/workspace && ls ${REAL}/uploads`,
    );
    expect(v.inbound('PATH=/usr/bin:/agent/.runtime/bin')).toBe(
      `PATH=/usr/bin:${REAL}/.runtime/bin`,
    );
    expect(
      v.inbound('{"cwd":"/agent/workspace","add":["/agent/uploads"]}'),
    ).toBe(`{"cwd":"${REAL}/workspace","add":["${REAL}/uploads"]}`);
  });

  it('leaves names that only begin like the root alone', () => {
    for (const text of [
      '/agents/skills',
      '/agent-adapters/x',
      '/agent_x',
      '/agent.d',
      'https://example.com/agent/workspace',
      'file:///agent/x',
      '//agent/x',
      'my/agent/x',
    ]) {
      expect(v.inbound(text)).toBe(text);
    }
  });

  it('maps the platform doors onto the device relays', () => {
    expect(v.inbound(`${GATEWAY}/anthropic`)).toBe(
      `${LOCAL_GATEWAY}/anthropic`,
    );
    expect(v.inbound(GATEWAY)).toBe(LOCAL_GATEWAY);
    expect(v.inbound(`${API}?x=1`)).toBe(`${LOCAL_API}?x=1`);
    expect(v.inbound(`"${API}"`)).toBe(`"${LOCAL_API}"`);
  });

  it('leaves an origin that continues as another host or port alone', () => {
    for (const text of [
      `${GATEWAY}1/anthropic`,
      'http://sandbox-llm-gateway:8080.evil.example/x',
      'http://sandbox-llm-gateway:8080:1',
      'https://sandbox-llm-gateway:8080/x',
    ]) {
      expect(v.inbound(text)).toBe(text);
    }
  });

  it('translates the values of an environment, not its names', () => {
    expect(
      v.inboundEnv({
        HOME: '/agent/.runtime/home',
        ANTHROPIC_BASE_URL: `${GATEWAY}/anthropic`,
        AGENT_NAME: 'agent',
      }),
    ).toEqual({
      HOME: `${REAL}/.runtime/home`,
      ANTHROPIC_BASE_URL: `${LOCAL_GATEWAY}/anthropic`,
      AGENT_NAME: 'agent',
    });
  });

  it('passes bytes that are not UTF-8 as they are', () => {
    const binary = Buffer.from([
      0x2f, 0x61, 0x67, 0x65, 0x6e, 0x74, 0xff, 0xfe,
    ]);
    expect(v.inboundBytes(binary).equals(binary)).toBe(true);
    const line = Buffer.from(
      '{"type":"user","text":"read /agent/uploads/a.pdf"}\n',
    );
    expect(v.inboundBytes(line).toString()).toBe(
      `{"type":"user","text":"read ${REAL}/uploads/a.pdf"}\n`,
    );
  });

  it('translates nothing without a view', () => {
    const none = new SessionView(null);
    expect(none.inbound('/agent/workspace')).toBe('/agent/workspace');
    expect(none.outbound(`${REAL}/x`)).toBe(`${REAL}/x`);
    const stream = none.outboundStream();
    expect(stream.push(Buffer.from(`${REAL}/x`)).toString()).toBe(`${REAL}/x`);
    expect(stream.flush().length).toBe(0);
  });
});

describe('SessionView outbound', () => {
  const v = view();

  it('names the real directory and the relays as the contract does', () => {
    expect(v.outbound(`${REAL}/workspace/src/a.ts`)).toBe(
      '/agent/workspace/src/a.ts',
    );
    expect(v.outbound(`base ${LOCAL_GATEWAY}/anthropic`)).toBe(
      `base ${GATEWAY}/anthropic`,
    );
    // Another session's directory is no part of this one's.
    expect(v.outbound(`${REAL}x/workspace`)).toBe(`${REAL}x/workspace`);
  });

  it('replaces a name that a stream splits across two chunks', () => {
    const stream = v.outboundStream();
    const line = `{"cwd":"${REAL}/workspace"}\n`;
    const cut = line.indexOf('tale-sandbox') + 4;
    const first = stream.push(Buffer.from(line.slice(0, cut)));
    const second = stream.push(Buffer.from(line.slice(cut)));
    expect(Buffer.concat([first, second]).toString()).toBe(
      '{"cwd":"/agent/workspace"}\n',
    );
    expect(stream.flush().length).toBe(0);
  });

  it('never holds back a line that ends in a newline', () => {
    const stream = v.outboundStream();
    const out = stream.push(Buffer.from(`{"a":"${REAL}/x"}\n`));
    expect(out.toString()).toBe('{"a":"/agent/x"}\n');
  });

  it('holds a name that ends its chunk until the next byte decides it', () => {
    const stream = v.outboundStream();
    expect(stream.push(Buffer.from(`ls ${REAL}`)).toString()).toBe('ls ');
    expect(stream.push(Buffer.from('/x\n')).toString()).toBe('/agent/x\n');
    const other = v.outboundStream();
    expect(other.push(Buffer.from(`ls ${REAL}`)).toString()).toBe('ls ');
    expect(other.push(Buffer.from('y\n')).toString()).toBe(`${REAL}y\n`);
  });

  it('flushes what it holds when the stream ends', () => {
    const stream = v.outboundStream();
    expect(stream.push(Buffer.from(`done ${REAL}`)).toString()).toBe('done ');
    expect(stream.flush().toString()).toBe('/agent');
    const partial = v.outboundStream();
    expect(partial.push(Buffer.from('x /var/lib/tale-')).toString()).toBe('x ');
    expect(partial.flush().toString()).toBe('/var/lib/tale-');
  });

  it('judges a name that starts a chunk by the byte before it', () => {
    const stream = v.outboundStream();
    expect(stream.push(Buffer.from('x')).toString()).toBe('x');
    // `x/var/lib/…` does not start a path, wherever the chunks were cut.
    expect(stream.push(Buffer.from(`${REAL}/a\n`)).toString()).toBe(
      `${REAL}/a\n`,
    );
  });

  it('passes binary output byte for byte', () => {
    const stream = v.outboundStream();
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a]);
    expect(stream.push(bytes).equals(bytes)).toBe(true);
  });
});

describe('SessionView helper paths', () => {
  const v = new SessionView({
    root: '/agent',
    real: REAL,
    origins: [],
    paths: [
      [
        '/usr/local/bin/tale-git-credential',
        '/var/lib/tale-sandbox/lib/r1/bin/tale-git-credential',
      ],
    ],
  });

  it('maps an image path the platform names onto the device copy, and back', () => {
    expect(v.inbound('/usr/local/bin/tale-git-credential')).toBe(
      '/var/lib/tale-sandbox/lib/r1/bin/tale-git-credential',
    );
    expect(v.inbound('/usr/local/bin/tale-git-credential-x')).toBe(
      '/usr/local/bin/tale-git-credential-x',
    );
    expect(
      v.outbound('/var/lib/tale-sandbox/lib/r1/bin/tale-git-credential get'),
    ).toBe('/usr/local/bin/tale-git-credential get');
  });

  it('refuses a helper path under the contract root', () => {
    expect(() =>
      parseSessionView(
        JSON.stringify({
          root: '/agent',
          real: REAL,
          paths: [['/agent/x', '/tmp/x']],
        }),
      ),
    ).toThrow(SessionViewError);
  });
});
