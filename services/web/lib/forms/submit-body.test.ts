// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { submitRequest } from './schemas';
import { MAX_SUBMIT_BODY_BYTES, readSubmitBody } from './submit-body';

// Each of these characters is one UTF-16 unit, the unit the schema's `max()`
// counts, and three bytes in UTF-8: the most a typed character takes per unit.
const contact = {
  form: 'contact',
  payload: {
    name: '山'.repeat(2000),
    email: `${'a'.repeat(1988)}@example.com`,
    company: '社'.repeat(2000),
    message: '語'.repeat(2000),
    privacy: true,
    startedAt: 0,
    website: '',
  },
};

const demo = {
  form: 'request-demo',
  payload: {
    ...contact.payload,
    phone: '1'.repeat(32),
    interests: ['enterprise', 'professional_services', 'custom_ai_training'],
  },
};

function post(body: string, declareLength: boolean): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (declareLength) {
    headers.set(
      'content-length',
      String(new TextEncoder().encode(body).byteLength),
    );
  }
  return new Request('http://localhost/api/forms/submit', {
    method: 'POST',
    headers,
    body,
  });
}

describe('readSubmitBody', () => {
  it.each([
    ['contact', contact],
    ['request-demo', demo],
  ])(
    'reads the largest %s submission the schema allows, in a three-byte script',
    async (_form, request) => {
      expect(submitRequest.safeParse(request).success).toBe(true);
      const body = JSON.stringify(request);
      for (const declareLength of [true, false]) {
        const read = await readSubmitBody(post(body, declareLength));
        expect(read, `declared length: ${declareLength}`).not.toBeNull();
        expect(read).toBe(body);
      }
    },
  );

  it.each([true, false])(
    'refuses a body over the cap in bytes, though under it in UTF-16 units (declared length: %s)',
    async (declareLength) => {
      const body = '語'.repeat(MAX_SUBMIT_BODY_BYTES / 2);
      expect(await readSubmitBody(post(body, declareLength))).toBeNull();
    },
  );
});
