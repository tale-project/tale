/**
 * Execute HTTP requests collected during integration execution
 */

import type { HttpRequest, HttpResponse } from '../types';

import { base64ToBytes } from '../../../lib/crypto/base64_to_bytes';
import { validateHost } from './validate_host';

export async function executeHttpRequest(
  req: HttpRequest,
  allowedHosts?: string[],
): Promise<HttpResponse> {
  if (allowedHosts && allowedHosts.length > 0) {
    validateHost(req.url, allowedHosts);
  }

  let fetchOptions = req.options;

  if (req.binaryBody) {
    const bytes = base64ToBytes(req.binaryBody);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SharedArrayBuffer TS compat
    const body = new Blob([bytes as unknown as ArrayBuffer]);
    fetchOptions = { ...req.options, body };
  }

  const response = await globalThis.fetch(req.url, {
    ...fetchOptions,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? 'unknown';
    throw new Error(
      `HTTP request redirected to "${location}" for "${req.url}". Add the redirect host to allowedHosts.`,
    );
  }
  const contentType = response.headers.get('content-type') || '';

  let body: unknown;

  if (req.responseType === 'base64') {
    const arrayBuffer = await response.arrayBuffer();
    body = Buffer.from(arrayBuffer).toString('base64');
  } else {
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
