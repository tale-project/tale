/**
 * Unit test — the S3 error-body summarizer. S3-compatible stores answer a
 * failure with an XML `<Error><Code>…</Code><Message>…</Message></Error>`
 * document; the S3 verbs surface the parsed `Code`/`Message` as a legible
 * `Code: Message` one-liner instead of a raw XML blob the admin form would
 * truncate mid-tag. `safeErrorBody` is not exported, so this exercises it
 * THROUGH the public `s3PutObject`/`s3GetObjectBytes` verbs with a mocked
 * `store.client.fetch` — no live MinIO needed. Covers every summarizer branch:
 * Code+Message, Code-only, Message-only, non-XML raw slice (+ 300-char cap),
 * empty body, and an unreadable body.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  s3GetObjectBytes,
  s3PutObject,
  type S3ObjectStore,
} from './object_store';

/** A minimal `fetch` Response stand-in — the verbs read only these members. */
interface FakeResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/** Build a store whose signed `fetch` resolves to a single canned response. */
function makeStore(response: FakeResponse): S3ObjectStore {
  return {
    backend: 's3',
    client: {
      fetch: vi.fn().mockResolvedValue(response),
    } as unknown as S3ObjectStore['client'],
    config: {
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:9100',
      forcePathStyle: true,
      bucket: 'org-blobs',
    },
  };
}

function mockedFetch(store: S3ObjectStore): ReturnType<typeof vi.fn> {
  return Reflect.get(store.client, 'fetch') as ReturnType<typeof vi.fn>;
}

function errorResponse(status: number, body: string): FakeResponse {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

/** Capture the message of the error a rejecting call throws. */
async function rejectionMessage(fn: () => Promise<unknown>): Promise<string> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  expect(threw).toBe(true);
  return caught instanceof Error ? caught.message : String(caught);
}

const KEY = 'org-blobs/acme/6f9619ff';
const BODY = new TextEncoder().encode('x');

describe('S3 error summarizer via s3PutObject', () => {
  it('renders XML Code+Message as "Code: Message" (not a raw XML blob)', async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Error><Code>SignatureDoesNotMatch</Code>' +
      '<Message>The request signature we calculated does not match the signature you provided.</Message>' +
      '<RequestId>ABC123</RequestId></Error>';
    const store = makeStore(errorResponse(403, xml));

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    expect(message).toContain(
      'SignatureDoesNotMatch: The request signature we calculated does not match the signature you provided.',
    );
    // The raw XML must NOT leak through — that is the whole point of parsing it.
    expect(message).not.toContain('<Code>');
    expect(message).not.toContain('<Error>');
    expect(message).not.toContain('RequestId');
    // Still carries the verb + status context.
    expect(message).toContain('S3 PUT');
    expect(message).toContain('403');
  });

  it('falls back to the bare Code when the body has no Message', async () => {
    const store = makeStore(
      errorResponse(403, '<Error><Code>AccessDenied</Code></Error>'),
    );

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    expect(message).toContain('403 AccessDenied');
    expect(message).not.toContain('<Code>');
  });

  it('falls back to the bare Message when the body has no Code', async () => {
    const store = makeStore(
      errorResponse(
        403,
        '<Error><Message>Something went wrong</Message></Error>',
      ),
    );

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    expect(message).toContain('403 Something went wrong');
    expect(message).not.toContain('<Message>');
  });

  it('surfaces a trimmed raw slice when the body is not the expected XML', async () => {
    const store = makeStore(
      errorResponse(500, '  Internal proxy error, not S3 XML  '),
    );

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    // Trimmed (no leading/trailing spaces from the body) and surfaced verbatim.
    expect(message).toContain('500 Internal proxy error, not S3 XML');
    expect(message).not.toContain('  Internal proxy error');
  });

  it('caps a long non-XML body at 300 chars', async () => {
    const store = makeStore(errorResponse(502, 'A'.repeat(400)));

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    expect(message).toContain('A'.repeat(300));
    expect(message).not.toContain('A'.repeat(301));
  });

  it('adds no junk after the status when the body is empty', async () => {
    const store = makeStore(errorResponse(403, ''));

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    // Ends at the status (with at most trailing whitespace) — never `undefined`
    // or a stray tag.
    expect(message).toMatch(/S3 PUT .* failed: 403\s*$/);
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('<');
  });

  it('reports an unreadable body instead of throwing while summarizing', async () => {
    const store = makeStore({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream aborted')),
    });

    const message = await rejectionMessage(() =>
      s3PutObject(store, KEY, BODY, 'text/plain'),
    );

    expect(message).toContain('(unreadable body)');
    expect(message).toContain('500');
  });

  it('treats a create-only precondition failure as an existing object', async () => {
    const store = makeStore(errorResponse(412, ''));

    await expect(
      s3PutObject(store, KEY, BODY, 'text/plain', { createOnly: true }),
    ).resolves.toBe('exists');
    expect(mockedFetch(store)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'content-type': 'text/plain',
          'if-none-match': '*',
        },
      }),
    );
  });
});

describe('S3 error summarizer via s3GetObjectBytes (same helper across verbs)', () => {
  it('renders XML Code+Message as "Code: Message" on the GET path too', async () => {
    const store = makeStore(
      errorResponse(
        404,
        '<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
      ),
    );

    const message = await rejectionMessage(() => s3GetObjectBytes(store, KEY));

    expect(message).toContain('S3 GET');
    expect(message).toContain('NoSuchKey: The specified key does not exist.');
    expect(message).not.toContain('<Code>');
  });
});
