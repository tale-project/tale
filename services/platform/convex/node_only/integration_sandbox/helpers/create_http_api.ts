/**
 * Create synchronous HTTP API for integration connectors
 */

import type { HttpRequest, HttpResponse, PendingHttpRequest } from '../types';

export interface HttpApiState {
  pendingHttpCount: number;
  httpResults: Map<number, HttpResponse>;
  httpRequests: PendingHttpRequest[];
}

export interface HttpApi {
  get: (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => HttpResponse;
  post: (
    url: string,
    body: unknown,
    options?: { headers?: Record<string, string> },
  ) => HttpResponse;
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

      // Check if we already have the result
      const cachedResult = state.httpResults.get(requestId);
      if (cachedResult) {
        return cachedResult;
      }

      // Store request for later execution
      state.httpRequests.push({
        request,
        callback: (response) => state.httpResults.set(requestId, response),
        errorCallback: (error) => {
          throw error;
        },
      });

      // Return placeholder - will be filled on re-run
      return {
        status: 0,
        statusText: 'pending',
        headers: {},
        body: null,
        text: () => '',
        json: () => null,
      };
    },
    post: (
      url: string,
      body: unknown,
      options: { headers?: Record<string, string> } = {},
    ): HttpResponse => {
      const requestId = state.pendingHttpCount++;
      const request: HttpRequest = {
        url,
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
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

      return {
        status: 0,
        statusText: 'pending',
        headers: {},
        body: null,
        text: () => '',
        json: () => null,
      };
    },
  };
}
