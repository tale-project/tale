/**
 * Execute HTTP requests collected during integration execution
 */

import type { HttpRequest, HttpResponse } from '../types';

export async function executeHttpRequest(
  req: HttpRequest,
): Promise<HttpResponse> {
  const response = await globalThis.fetch(req.url, req.options);
  const contentType = response.headers.get('content-type') || '';

  let body: unknown;
  const text = await response.text();

  if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } else {
    body = text;
  }

  const headersObj: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers: headersObj,
    body,
    text: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => body,
  };
}
