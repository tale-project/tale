/**
 * Create synchronous HTTP API for integration connectors
 */

import type {
  FormField,
  HttpRequest,
  HttpResponse,
  PendingHttpRequest,
} from '../types';

import { PendingOperationError } from '../types';

export interface HttpApiState {
  pendingHttpCount: number;
  httpResults: Map<number, HttpResponse>;
  httpRequests: PendingHttpRequest[];
}

type HttpMethodOptions = {
  headers?: Record<string, string>;
  responseType?: 'base64';
};

type BodyMethodOptions = HttpMethodOptions & {
  body?: string;
  binaryBody?: string;
  /** Send as multipart/form-data */
  formFields?: FormField[];
};

export interface HttpApi {
  get: (url: string, options?: HttpMethodOptions) => HttpResponse;
  post: (url: string, options?: BodyMethodOptions) => HttpResponse;
  put: (url: string, options?: BodyMethodOptions) => HttpResponse;
  patch: (url: string, options?: BodyMethodOptions) => HttpResponse;
  delete: (url: string, options?: BodyMethodOptions) => HttpResponse;
}

function createBodyMethod(state: HttpApiState, method: string) {
  return (url: string, options: BodyMethodOptions = {}): HttpResponse => {
    const requestId = state.pendingHttpCount++;

    const isForm = options.formFields && options.formFields.length > 0;

    const request: HttpRequest = {
      url,
      options: {
        method,
        // For formFields: Content-Type is set by execute_http_request (needs boundary)
        // For binaryBody: use caller-provided headers
        // For regular body: default to application/json
        headers:
          isForm || options.binaryBody
            ? { ...options.headers }
            : { 'Content-Type': 'application/json', ...options.headers },
        body: isForm || options.binaryBody ? undefined : options.body,
      },
      binaryBody: options.binaryBody,
      formFields: isForm ? options.formFields : undefined,
      responseType: options.responseType,
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
    get: (url: string, options: HttpMethodOptions = {}): HttpResponse => {
      const requestId = state.pendingHttpCount++;
      const request: HttpRequest = {
        url,
        options: {
          method: 'GET',
          headers: options.headers,
        },
        responseType: options.responseType,
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
