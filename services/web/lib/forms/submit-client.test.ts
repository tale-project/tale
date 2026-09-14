import { trackAnalyticsEvent } from '@tale/ui/analytics/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SubmitRequest } from './schemas';
import { submitForm } from './submit-client';

vi.mock('@tale/ui/analytics/browser', () => ({ trackAnalyticsEvent: vi.fn() }));
const contact: SubmitRequest = {
  form: 'contact',
  payload: {
    name: 'Private Person',
    email: 'private@example.com',
    company: 'Private Company',
    message: 'Private contact message',
    privacy: true,
    website: '',
    startedAt: 0,
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('marketing conversion analytics', () => {
  it('reports the completed form type without contact data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ok: true })),
    );
    expect(await submitForm(contact)).toEqual({ ok: true });
    expect(trackAnalyticsEvent).toHaveBeenCalledExactlyOnceWith(
      'contact-submitted',
    );
  });
  it('does not report a rejected or failed submission', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'not_configured' }, { status: 503 }),
        ),
    );
    expect((await submitForm(contact)).ok).toBe(false);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
