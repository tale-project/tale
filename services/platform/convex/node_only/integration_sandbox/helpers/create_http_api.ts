/**
 * Create synchronous HTTP API for integration connectors
 */

import type { HttpRequest, HttpResponse, PendingHttpRequest } from '../types';

import { PendingOperationError } from '../types';

export interface HttpApiState {
  pendingHttpCount: number;
  httpResults: Map<number, HttpResponse>;
  httpRequests: PendingHttpRequest[];
}

type BodyMethodOptions = {
  headers?: Record<string, string>;
  body?: string;
  binaryBody?: string;
};

export interface HttpApi {
  get: (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => HttpResponse;
  post: (url: string, options?: BodyMethodOptions) => HttpResponse;
  put: (url: string, options?: BodyMethodOptions) => HttpResponse;
  patch: (url: string, options?: BodyMethodOptions) => HttpResponse;
  delete: (url: string, options?: BodyMethodOptions) => HttpResponse;
}

function createBodyMethod(state: HttpApiState, method: string) {
  return (url: string, options: BodyMethodOptions = {}): HttpResponse => {
    const requestId = state.pendingHttpCount++;
    const request: HttpRequest = {
      url,
      options: {
        method,
        headers: options.binaryBody
          ? { ...options.headers }
          : { 'Content-Type': 'application/json', ...options.headers },
        body: options.binaryBody ? undefined : options.body,
      },
      binaryBody: options.binaryBody,
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

    throw new PendingOperationError();
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

      throw new PendingOperationError();
    },
    post: createBodyMethod(state, 'POST'),
    put: createBodyMethod(state, 'PUT'),
    patch: createBodyMethod(state, 'PATCH'),
    delete: createBodyMethod(state, 'DELETE'),
  };
}
