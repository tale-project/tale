/**
 * Create synchronous HTTP API for integration connectors
 */

import type { HttpRequest, HttpResponse, PendingHttpRequest } from '../types';

export interface HttpApiState {
  pendingHttpCount: number;
  httpResults: Map<number, HttpResponse>;
  httpRequests: PendingHttpRequest[];
}

type BodyMethodOptions = { headers?: Record<string, string>; body?: string };

export interface HttpApi {
  get: (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => HttpResponse;
  post: (url: string, options?: BodyMethodOptions) => HttpResponse;
  patch: (url: string, options?: BodyMethodOptions) => HttpResponse;
}

const PENDING_RESPONSE: HttpResponse = {
  status: 0,
  statusText: 'pending',
  headers: {},
  body: null,
  text: () => '',
  json: () => null,
};

function createBodyMethod(state: HttpApiState, method: string) {
  return (url: string, options: BodyMethodOptions = {}): HttpResponse => {
    const requestId = state.pendingHttpCount++;
    const request: HttpRequest = {
      url,
      options: {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body,
      },
    };

    const cachedResult = state.httpResults.get(requestId);
    if (cachedResult) {
      return cachedResult;
    }

    state.httpRequests.push({
      request,
      callback: (response) => state.httpResults.set(requestId, response),
      errorCallback: (error) => {
        throw error;
      },
    });

    return PENDING_RESPONSE;
  };
}

export function createHttpApi(state: HttpApiState): HttpApi {
  return {
    get: (
      url: string,
      options: { headers?: Record<string, string> } = {},
    ): HttpResponse => {
      const requestId = state.pendingHttpCount++;
      const request: HttpRequest = {
        url,
        options: {
          method: 'GET',
          headers: options.headers,
        },
      };

      const cachedResult = state.httpResults.get(requestId);
      if (cachedResult) {
        return cachedResult;
      }

      state.httpRequests.push({
        request,
        callback: (response) => state.httpResults.set(requestId, response),
        errorCallback: (error) => {
          throw error;
        },
      });

      return PENDING_RESPONSE;
    },
    post: createBodyMethod(state, 'POST'),
    patch: createBodyMethod(state, 'PATCH'),
  };
}
