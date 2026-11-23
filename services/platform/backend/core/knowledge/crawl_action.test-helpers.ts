import { writeFile } from 'node:fs/promises';

import type {
  SafeFetchFileResponse,
  SafeFetchOptions,
} from '../../../lib/net/safe-fetch';

/** What a site answers a page's fetch with, in a test. */
export interface FetchedPage {
  status: number;
  statusText: string;
  headers: Headers;
  body: string | Uint8Array;
  finalUrl: string;
}

/**
 * `safeFetchToFile` as a test has it answer: the page's body is written to
 * the file the crawler names, the way the real fetch writes it, and what
 * comes back says how long it was. An answer may be the same for every
 * fetch, or worked out from the request.
 */
export function fetchingToFile(
  answer:
    | FetchedPage
    | ((url: string, options: SafeFetchOptions | undefined) => FetchedPage),
) {
  return async (
    url: string,
    filePath: string,
    options?: SafeFetchOptions,
  ): Promise<SafeFetchFileResponse> => {
    const page = typeof answer === 'function' ? answer(url, options) : answer;
    const bytes =
      typeof page.body === 'string'
        ? new TextEncoder().encode(page.body)
        : page.body;
    // `wx`, as the real fetch: the file is the visit's own and new.
    await writeFile(filePath, bytes, { flag: 'wx' });
    return {
      status: page.status,
      statusText: page.statusText,
      headers: page.headers,
      size: bytes.byteLength,
      finalUrl: page.finalUrl,
    };
  };
}
