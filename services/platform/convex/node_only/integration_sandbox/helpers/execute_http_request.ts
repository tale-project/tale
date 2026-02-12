/**
 * Execute HTTP requests collected during integration execution
 */

import type { HttpRequest, HttpResponse } from '../types';

function validateHost(url: string, allowedHosts: string[]): void {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  const isAllowed = allowedHosts.some((allowed) => {
    return hostname === allowed || hostname.endsWith('.' + allowed);
  });

  if (!isAllowed) {
    throw new Error(
      `HTTP request to "${hostname}" blocked: host not in allowedHosts [${allowedHosts.join(', ')}]`,
    );
  }
}

export async function executeHttpRequest(
  req: HttpRequest,
  allowedHosts?: string[],
): Promise<HttpResponse> {
  if (allowedHosts && allowedHosts.length > 0) {
    validateHost(req.url, allowedHosts);
  }

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
