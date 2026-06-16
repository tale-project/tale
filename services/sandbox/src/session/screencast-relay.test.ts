// Unit tests for the screencast WS↔raw-tunnel bridge's pure pieces.
//
// The full duplex relay needs a live runnerd (Bun.connect to a real upgrade
// endpoint), which is the container e2e's job. Here we cover what's cheaply
// testable in isolation:
//   - parseUpgradeResponse: the 101-response framing (partial / complete /
//     non-101 / trailing RFB bytes).
//   - the handler's open() resolver gate: a null target closes the WS 1011
//     without ever dialing a tunnel.

import { describe, expect, test } from 'bun:test';

import {
  type ScreencastTarget,
  type ScreencastWsData,
  createScreencastWebSocketHandler,
  parseUpgradeResponse,
} from './screencast-relay.ts';

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('parseUpgradeResponse', () => {
  test('returns null while the header block is incomplete', () => {
    // No CRLFCRLF terminator yet → keep accumulating.
    expect(parseUpgradeResponse(bytes('HTTP/1.1 101 Switching'))).toBeNull();
    expect(
      parseUpgradeResponse(
        bytes('HTTP/1.1 101 Switching Protocols\r\nUpgrade: tale-vnc\r\n'),
      ),
    ).toBeNull();
  });

  test('parses a complete 101 with no trailing bytes', () => {
    const buf = bytes(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: tale-vnc\r\nConnection: Upgrade\r\n\r\n',
    );
    const r = parseUpgradeResponse(buf);
    expect(r).not.toBeNull();
    expect(r?.status).toBe(101);
    expect(r?.rest.length).toBe(0);
  });

  test('parses a 101 + trailing RFB bytes (forwarded verbatim)', () => {
    // The RFB server speaks first ("RFB 003.008\n" ProtocolVersion). Those
    // bytes can ride in the same TCP chunk as the 101 headers.
    const rfb = 'RFB 003.008\n';
    const buf = bytes(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: tale-vnc\r\nConnection: Upgrade\r\n\r\n${rfb}`,
    );
    const r = parseUpgradeResponse(buf);
    expect(r?.status).toBe(101);
    expect(new TextDecoder().decode(r?.rest)).toBe(rfb);
  });

  test('preserves binary (non-utf8) trailing bytes byte-for-byte', () => {
    const header = bytes(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: tale-vnc\r\n\r\n',
    );
    const raw = new Uint8Array([0x00, 0xff, 0x80, 0x0d, 0x0a, 0x1b]);
    const buf = new Uint8Array(header.length + raw.length);
    buf.set(header, 0);
    buf.set(raw, header.length);
    const r = parseUpgradeResponse(buf);
    expect(r?.status).toBe(101);
    expect(Array.from(r?.rest ?? [])).toEqual(Array.from(raw));
  });

  test('reports a non-101 status (e.g. 401 / 502) so the relay can refuse', () => {
    expect(
      parseUpgradeResponse(
        bytes('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'),
      )?.status,
    ).toBe(401);
    expect(
      parseUpgradeResponse(
        bytes('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'),
      )?.status,
    ).toBe(502);
  });

  test('a malformed status line decodes to status 0 (treated as non-101)', () => {
    const r = parseUpgradeResponse(bytes('GARBAGE LINE\r\n\r\n'));
    expect(r).not.toBeNull();
    expect(r?.status).toBe(0);
  });
});

describe('screencast handler open() resolver gate', () => {
  test('a null target closes the WS 1011 and never dials a tunnel', () => {
    const closes: Array<{ code?: number; reason?: string }> = [];
    const handler = createScreencastWebSocketHandler(() => null);
    // Minimal ServerWebSocket stand-in: only the surface open() touches.
    const ws = {
      data: { sessionId: 'sess_x', control: false } satisfies ScreencastWsData,
      close: (code?: number, reason?: string) => closes.push({ code, reason }),
      sendBinary: () => 0,
      getBufferedAmount: () => 0,
    };
    // open() is synchronous here (it returns before the async Bun.connect
    // resolves), so void-ignore its void|Promise<void> return.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    void handler.open?.(ws as unknown as Parameters<typeof handler.open>[0]);
    expect(closes).toEqual([{ code: 1011, reason: 'no session' }]);
  });

  test('a resolvable target is consulted exactly once on open', () => {
    let calls = 0;
    const target: ScreencastTarget = {
      hostname: '127.0.0.1',
      // Port 1 will fail to connect in CI, but open() resolves the target
      // synchronously and the dial is async — we only assert the resolver ran.
      port: 1,
      token: 'tok',
    };
    const handler = createScreencastWebSocketHandler((id) => {
      calls += 1;
      expect(id).toBe('sess_live');
      return target;
    });
    const ws = {
      data: {
        sessionId: 'sess_live',
        control: false,
      } satisfies ScreencastWsData,
      close: () => {},
      sendBinary: () => 0,
      getBufferedAmount: () => 0,
    };
    // open() is synchronous here (it returns before the async Bun.connect
    // resolves), so void-ignore its void|Promise<void> return.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    void handler.open?.(ws as unknown as Parameters<typeof handler.open>[0]);
    expect(calls).toBe(1);
  });

  test('handler disables compression (raw RFB must not be re-encoded)', () => {
    const handler = createScreencastWebSocketHandler(() => null);
    expect(handler.perMessageDeflate).toBe(false);
  });
});
