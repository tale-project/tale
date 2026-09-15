import { describe, expect, it } from 'vitest';

import {
  dataNoticePolicyArgs,
  readDataNoticeSettings,
  resolveDataNoticeMessage,
} from './data-notice';

describe('readDataNoticeSettings', () => {
  it('reads off for an org with no policy file', () => {
    expect(readDataNoticeSettings(undefined)).toEqual({
      enabled: false,
      messages: {},
    });
  });

  it('reads off unless the config says enabled: true', () => {
    expect(readDataNoticeSettings({ version: 1 }).enabled).toBe(false);
    expect(readDataNoticeSettings({ enabled: 'yes' }).enabled).toBe(false);
    expect(readDataNoticeSettings({ enabled: true }).enabled).toBe(true);
  });

  it('keeps only string messages', () => {
    expect(
      readDataNoticeSettings({
        enabled: true,
        messages: { en: 'Mind the data.', de: 42 },
      }).messages,
    ).toEqual({ en: 'Mind the data.' });
  });
});

describe('resolveDataNoticeMessage', () => {
  const messages = {
    en: 'English text',
    de: 'Deutscher Text',
    'de-CH': 'Schweizer Text',
  };

  it('prefers the text written for the exact locale', () => {
    expect(resolveDataNoticeMessage(messages, 'de-CH', 'Default')).toBe(
      'Schweizer Text',
    );
  });

  it('falls back to the base language, then to English', () => {
    expect(resolveDataNoticeMessage(messages, 'de-AT', 'Default')).toBe(
      'Deutscher Text',
    );
    expect(resolveDataNoticeMessage(messages, 'fr', 'Défaut')).toBe(
      'English text',
    );
  });

  it('uses the platform default when no text applies', () => {
    expect(resolveDataNoticeMessage({}, 'fr', 'Défaut')).toBe('Défaut');
  });
});

describe('dataNoticePolicyArgs', () => {
  it('addresses the org notice policy', () => {
    expect(dataNoticePolicyArgs('org-1')).toEqual({
      organizationId: 'org-1',
      policyType: 'data_classification_notice',
    });
  });
});
