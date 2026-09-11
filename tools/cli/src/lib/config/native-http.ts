import { z } from 'zod';

import { insist, NativeRequestError } from './releases/model';

export type NativeFetch = (url: URL, init: RequestInit) => Promise<Response>;
export interface NativeHttpOptions {
  url: string;
  origin?: string;
  orgId: string;
  cookie: string;
  fetchImpl?: NativeFetch;
}

/** One transport for configuration releases and platform settings. Credentials
 * stay in headers; only same-origin API paths are accepted, without redirects. */
export function createNativeHttp(options: NativeHttpOptions) {
  let base: URL;
  let origin: URL;
  try {
    base = new URL(options.url);
    origin = new URL(options.origin ?? options.url);
  } catch {
    throw new NativeRequestError('Tale URL must be an origin');
  }
  insist(
    base.pathname === '/' &&
      !base.search &&
      !base.hash &&
      !base.username &&
      !base.password,
    'Tale URL must be an origin',
  );
  insist(
    base.protocol === 'https:' ||
      (base.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)),
    'Tale URL must use HTTPS or loopback HTTP',
  );
  insist(
    origin.protocol === 'https:' &&
      origin.origin === (options.origin ?? options.url).replace(/\/$/, ''),
    'request origin must be the public HTTPS origin',
  );
  insist(
    typeof options.cookie === 'string' &&
      options.cookie.length > 0 &&
      options.cookie.length <= 16_384 &&
      !/[\x00-\x1f\x7f]/.test(options.cookie),
    'native session cookie is required',
  );
  insist(
    z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
      .safeParse(options.orgId).success,
    'native org ID is required',
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  async function request(
    endpoint: string,
    args: {
      method?: string;
      body?: unknown;
      raw?: boolean;
      allowNotFound?: boolean;
      limit?: number;
    } = {},
  ): Promise<unknown> {
    const target = new URL(endpoint, base);
    insist(
      endpoint.startsWith('/api/') &&
        target.origin === base.origin &&
        target.pathname.startsWith('/api/') &&
        !target.hash,
      'native request must stay inside the Tale API',
    );
    target.searchParams.set('orgId', options.orgId);
    const method = args.method ?? 'GET';
    const response = await fetchImpl(target, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: {
        cookie: options.cookie,
        origin: origin.origin,
        ...(args.body === undefined
          ? {}
          : {
              'content-type': args.raw ? 'application/zip' : 'application/json',
            }),
      },
      ...(args.body === undefined
        ? {}
        : {
            body: args.raw
              ? z.instanceof(Buffer).parse(args.body)
              : JSON.stringify(args.body),
          }),
    }).catch(() => {
      throw new NativeRequestError(
        `Tale ${method} ${target.pathname} transport failed; the response may have been lost`,
      );
    });
    if (args.allowNotFound && response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new NativeRequestError(
        `Tale ${method} ${target.pathname} failed (HTTP ${response.status})`,
      );
    }
    return boundedNativeJson(response, args.limit ?? 1_048_576);
  }
  return { url: base.origin, origin: origin.origin, request };
}

/** Bound bytes before decoding. Parser errors and native bodies never become
 * diagnostics: either can contain private configuration or credential data. */
export async function boundedNativeJson(
  response: Response,
  limit = 1_048_576,
): Promise<unknown> {
  try {
    if (!response.body) throw new Error('Missing response body');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > limit) throw new Error('Oversized response');
      chunks.push(chunk);
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new NativeRequestError('Tale returned invalid or oversized JSON');
  }
}
