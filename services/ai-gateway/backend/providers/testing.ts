/**
 * The fetch stub the provider suites share.
 *
 * A provider module is mostly a shape contract with a vendor: which URL, which
 * body, which headers, and what its answer means. Recording the call and
 * replaying a canned response is what lets those be asserted without a
 * network — and both provider suites need exactly the same recorder.
 */

import type { FetchLike } from './types';

/** One recorded call, with the body already flattened to what was sent. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

export interface FetchStub {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export function stubFetch(answer: (call: RecordedCall) => Response): FetchStub {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    const call: RecordedCall = {
      url: urlOf(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  return { fetchImpl, calls };
}

/** A canned JSON answer, in the shape a vendor endpoint would send one. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
