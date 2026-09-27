import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseContactSupportUrl } from './contact-support-url';

describe('parseContactSupportUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('is undefined when unset or blank', () => {
    expect(parseContactSupportUrl(undefined)).toBeUndefined();
    expect(parseContactSupportUrl('')).toBeUndefined();
    expect(parseContactSupportUrl('   ')).toBeUndefined();
  });

  it('keeps an http or https URL', () => {
    expect(
      parseContactSupportUrl('https://support.example.com/help?source=tale'),
    ).toBe('https://support.example.com/help?source=tale');
    expect(parseContactSupportUrl('  http://intranet.example/support ')).toBe(
      'http://intranet.example/support',
    );
  });

  it.each([
    'support.example.com/help',
    'mailto:support@example.com',
    'javascript:alert(1)',
    'ftp://support.example.com/',
    '/contact',
  ])('ignores %s with a warning', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseContactSupportUrl(raw)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('TALE_CONTACT_SUPPORT_URL'),
    );
  });

  it('answers a value that cannot close the inline __ENV__ script', () => {
    const url = parseContactSupportUrl(
      'https://support.example.com/</script><script>alert(1)</script>',
    );
    expect(url).toBeDefined();
    expect(url).not.toMatch(/[<>"]/);
  });

  it('reads TALE_CONTACT_SUPPORT_URL by default', () => {
    vi.stubEnv('TALE_CONTACT_SUPPORT_URL', 'https://support.example.com/');
    expect(parseContactSupportUrl()).toBe('https://support.example.com/');
  });
});
