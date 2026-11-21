import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { buildS3ObjectStore, type S3ObjectStore } from './object_store';

/** One full collection, now: for a test that asks in the middle of a
 * transfer what is held of it. */
export function collectGarbageNow(): void {
  setFlagsFromString('--expose_gc');
  const gc: unknown = runInNewContext('gc');
  if (typeof gc !== 'function') throw new Error('V8 exposes no gc()');
  Reflect.apply(gc, undefined, []);
}

/**
 * Two full collections a macrotask apart, so that a test can say of an
 * object that nothing holds it any more: what is still reachable after
 * these is held by something.
 */
export async function collectGarbage(): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    collectGarbageNow();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * An S3 store for tests that answers on a real socket, so that what a test
 * observes is what the runtime's HTTP client does with a body: the length it
 * frames, the moment it stops sending, the connection it drops. It keeps
 * what it is sent and does as it is told below; it checks no signature.
 *
 * A PUT is kept only when the whole body it declared arrived, as a store
 * keeps it. The bucket is `tale-blobs`, addressed in the path.
 */
export interface TestStore {
  readonly store: S3ObjectStore;
  /** What the store holds, by key. */
  readonly objects: Map<string, { bytes: Buffer; contentType: string | null }>;
  /** Every PUT that reached the store, in order, whatever became of it. */
  readonly puts: TestStorePut[];
  /** Every key the store was asked about with a HEAD, in order. */
  readonly heads: string[];
  /** How the PUTs from now on are met. */
  behave: TestStoreBehaviour;
  close(): Promise<void>;
}

export interface TestStorePut {
  readonly key: string;
  readonly headers: IncomingHttpHeaders;
  /** How many bytes of the body have arrived so far. */
  received: number;
  /** Whether the object was kept. */
  stored: boolean;
  /** Whether the sender dropped the connection before the body was whole. */
  dropped: boolean;
}

export interface TestStoreBehaviour {
  /** Answer every PUT with this refusal, before reading its body. */
  refuse?: { status: number; code: string; message: string };
  /** Take the whole body and then say nothing. */
  neverAnswer?: boolean;
  /** Read nothing of a body until this settles. */
  readAfter?: Promise<void>;
  /** Count a body's bytes without keeping them: for a body of a size no
   * test should hold. */
  countOnly?: boolean;
  /** How a create-only PUT (`If-None-Match: *`) of a key that holds an
   * object is refused. Each leaves the object as it is. `'answer'`, the
   * default, is the 412 MinIO sends without waiting for the body.
   * `'drop'` is what versitygw does to a sender that is still sending: the
   * connection is gone under the body, and no answer is ever read.
   * `'late'` takes the whole body first and answers 412 then. */
  taken?: 'answer' | 'drop' | 'late';
}

const BUCKET = 'tale-blobs';

function keyOf(req: IncomingMessage): string {
  const pathname = new URL(req.url ?? '/', 'http://store').pathname;
  return decodeURIComponent(pathname.slice(`/${BUCKET}/`.length));
}

function refuse(
  res: ServerResponse,
  refusal: { status: number; code: string; message: string },
): void {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${refusal.code}</Code><Message>${refusal.message}</Message></Error>`;
  res.writeHead(refusal.status, {
    'content-type': 'application/xml',
    'content-length': Buffer.byteLength(body),
    connection: 'close',
  });
  res.end(body);
}

export async function startTestStore(): Promise<TestStore> {
  const objects: TestStore['objects'] = new Map();
  const puts: TestStorePut[] = [];
  const heads: string[] = [];
  const held: { behave: TestStoreBehaviour } = { behave: {} };

  const onPut = (req: IncomingMessage, res: ServerResponse): void => {
    const behave = held.behave;
    const put: TestStorePut = {
      key: keyOf(req),
      headers: req.headers,
      received: 0,
      stored: false,
      dropped: false,
    };
    puts.push(put);
    if (behave.refuse !== undefined) {
      refuse(res, behave.refuse);
      return;
    }
    if (req.headers['content-length'] === undefined) {
      refuse(res, {
        status: 411,
        code: 'MissingContentLength',
        message: 'You must provide the Content-Length HTTP header.',
      });
      return;
    }
    if (req.headers['if-none-match'] === '*' && objects.has(put.key)) {
      if (behave.taken === 'drop') {
        // With the first of the body here, the sender is in the middle of
        // sending it.
        const drop = (): void => {
          put.dropped = true;
          req.socket.resetAndDestroy();
        };
        req.once('data', drop);
        req.once('end', drop);
        return;
      }
      const refuseTaken = (): void =>
        refuse(res, {
          status: 412,
          code: 'PreconditionFailed',
          message:
            'At least one of the pre-conditions you specified did not hold',
        });
      if (behave.taken === 'late') {
        const readThenRefuse = (): void => {
          req.on('data', (chunk: Buffer) => {
            put.received += chunk.byteLength;
          });
          req.on('end', refuseTaken);
        };
        req.on('close', () => {
          put.dropped = true;
        });
        if (behave.readAfter === undefined) readThenRefuse();
        else void behave.readAfter.then(readThenRefuse);
        return;
      }
      refuseTaken();
      return;
    }
    const chunks: Buffer[] = [];
    const read = (): void => {
      req.on('data', (chunk: Buffer) => {
        put.received += chunk.byteLength;
        if (behave.countOnly !== true) chunks.push(chunk);
      });
      req.on('end', () => {
        objects.set(put.key, {
          bytes: Buffer.concat(chunks),
          contentType: req.headers['content-type'] ?? null,
        });
        put.stored = true;
        if (behave.neverAnswer === true) return;
        res.writeHead(200, { etag: '"test"', 'content-length': 0 });
        res.end();
      });
    };
    req.on('close', () => {
      if (!put.stored) put.dropped = true;
    });
    if (behave.readAfter === undefined) read();
    else void behave.readAfter.then(read);
  };

  const server: Server = createServer((req, res) => {
    if (req.method === 'PUT') {
      onPut(req, res);
      return;
    }
    const object = objects.get(keyOf(req));
    if (req.method === 'HEAD') heads.push(keyOf(req));
    if (req.method === 'DELETE') {
      objects.delete(keyOf(req));
      res.writeHead(204).end();
      return;
    }
    if (object === undefined) {
      refuse(res, {
        status: 404,
        code: 'NoSuchKey',
        message: 'The specified key does not exist.',
      });
      return;
    }
    res.writeHead(200, {
      'content-length': object.bytes.byteLength,
      ...(object.contentType !== null && {
        'content-type': object.contentType,
      }),
      etag: '"test"',
    });
    res.end(req.method === 'HEAD' ? undefined : object.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a server listening on a TCP port answers its address as one
  const { port } = server.address() as AddressInfo;

  return {
    store: buildS3ObjectStore(
      {
        endpoint: `http://127.0.0.1:${port}`,
        bucket: BUCKET,
        region: 'us-east-1',
        forcePathStyle: true,
      },
      { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
    ),
    objects,
    puts,
    heads,
    get behave() {
      return held.behave;
    },
    set behave(next: TestStoreBehaviour) {
      held.behave = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
