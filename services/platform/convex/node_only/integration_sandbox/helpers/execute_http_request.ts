/**
 * Execute HTTP requests collected during integration execution
 */

import { base64ToBytes } from '../../../lib/crypto/base64_to_bytes';
import type { FormField, HttpRequest, HttpResponse } from '../types';
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
    const existingHeaders = effectiveReq.options.headers;
    const headers: Record<string, string> = {};
    if (
      existingHeaders &&
      typeof existingHeaders === 'object' &&
      !Array.isArray(existingHeaders)
    ) {
      for (const [k, v] of Object.entries(existingHeaders)) {
        if (typeof v === 'string') headers[k] = v;
      }
    }
    headers['Content-Type'] = contentType;
    fetchOptions = { ...effectiveReq.options, headers, body };
  } else if (effectiveReq.binaryBody) {
    const bytes = base64ToBytes(effectiveReq.binaryBody);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SharedArrayBuffer TS compat
    const body = new Blob([bytes as unknown as ArrayBuffer]);
    fetchOptions = { ...effectiveReq.options, body };
  }

  let response: Response;
  try {
    response = await globalThis.fetch(effectiveReq.url, {
      ...fetchOptions,
      redirect: 'manual',
    });
  } catch (e) {
    // Node undici throws `TypeError: fetch failed` with the real reason
    // attached on `.cause` (ENOTFOUND, ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT,
    // CERT_HAS_EXPIRED, socket hang up, etc). Surface that chain so callers
    // can diagnose network-layer failures instead of seeing a bare
    // "fetch failed".
    const msg = e instanceof Error ? e.message : String(e);
    const cause: unknown =
      e && typeof e === 'object' && 'cause' in e ? e.cause : undefined;
    let causeMsg = '';
    if (cause instanceof Error) {
      const rawCode = 'code' in cause ? cause.code : undefined;
      const code = typeof rawCode === 'string' ? rawCode : undefined;
      causeMsg = `${cause.name}: ${cause.message}${code ? ` [${code}]` : ''}`;
    } else if (typeof cause === 'string' && cause.length > 0) {
      causeMsg = cause;
    } else if (typeof cause === 'number' || typeof cause === 'boolean') {
      causeMsg = String(cause);
    }
    throw new Error(
      causeMsg
        ? `${msg} — ${causeMsg} (url=${effectiveReq.url})`
        : `${msg} (url=${effectiveReq.url})`,
      { cause: e },
    );
  }
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
