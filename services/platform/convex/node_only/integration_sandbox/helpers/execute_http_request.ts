/**
 * Execute HTTP requests collected during integration execution
 */

import type { FormField, HttpRequest, HttpResponse } from '../types';

import { base64ToBytes } from '../../../lib/crypto/base64_to_bytes';
import { resolveAndValidateUrl } from './url_rewrite';

/**
 * Build a multipart/form-data body from structured form fields.
 * Returns the body as a Blob and the Content-Type header (with boundary).
 */
function buildFormData(fields: FormField[]): {
  body: Blob;
  contentType: string;
} {
  const boundary =
    '----SandboxFormBoundary' +
    Date.now() +
    Math.random().toString(36).slice(2);
  const parts: BlobPart[] = [];
  const encoder = new TextEncoder();

  for (const field of fields) {
    let header = `--${boundary}\r\n`;
    const safeName = field.name.replace(/"/g, '\\"');

    if (field.fileName) {
      const safeFileName = field.fileName.replace(/"/g, '\\"');
      header +=
        `Content-Disposition: form-data; name="${safeName}"; filename="${safeFileName}"\r\n` +
        `Content-Type: ${field.contentType || 'application/octet-stream'}\r\n\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${safeName}"\r\n\r\n`;
    }

    parts.push(new Blob([encoder.encode(header)]));

    if (field.isBase64) {
      const raw = base64ToBytes(field.value);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SharedArrayBuffer TS compat
      parts.push(new Blob([raw as unknown as ArrayBuffer]));
    } else {
      parts.push(new Blob([encoder.encode(field.value)]));
    }

    parts.push(new Blob([encoder.encode('\r\n')]));
  }

  parts.push(new Blob([encoder.encode(`--${boundary}--\r\n`)]));

  return {
    body: new Blob(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export async function executeHttpRequest(
  req: HttpRequest,
  allowedHosts?: string[],
): Promise<HttpResponse> {
  const resolvedUrl = resolveAndValidateUrl(req.url, allowedHosts);
  const effectiveReq =
    resolvedUrl !== req.url ? { ...req, url: resolvedUrl } : req;

  let fetchOptions = effectiveReq.options;

  if (effectiveReq.formFields && effectiveReq.formFields.length > 0) {
    const { body, contentType } = buildFormData(effectiveReq.formFields);
    const headers = { ...effectiveReq.options.headers } as Record<
      string,
      string
    >;
    headers['Content-Type'] = contentType;
    fetchOptions = { ...effectiveReq.options, headers, body };
  } else if (effectiveReq.binaryBody) {
    const bytes = base64ToBytes(effectiveReq.binaryBody);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SharedArrayBuffer TS compat
    const body = new Blob([bytes as unknown as ArrayBuffer]);
    fetchOptions = { ...effectiveReq.options, body };
  }

  const response = await globalThis.fetch(effectiveReq.url, {
    ...fetchOptions,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? 'unknown';
    throw new Error(
      `HTTP request redirected to "${location}" for "${effectiveReq.url}". Add the redirect host to allowedHosts.`,
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
